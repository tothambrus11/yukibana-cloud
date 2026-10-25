package lsp

import (
	"go/ast"
	"go/token"
	"go/types"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// keywords are offered where a statement or declaration may start.
var keywords = []string{
	"break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func",
	"go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
}

// complete suggests what may be written at the position: an import path
// inside an import's quotes, a member after a dot (an imported package's
// exported names, or a value's fields and methods), otherwise every name
// in scope there and the keywords. The client filters by what has been
// typed; the edit replaces the identifier typed so far.
func (s *Server) complete(p textDocumentPositionParams) *CompletionList {
	a := s.at(p)
	if a == nil {
		return &CompletionList{Items: []CompletionItem{}}
	}
	f := a.file
	offset := f.lines.offset(p.Position)
	start := offset
	for start > 0 {
		r, size := utf8.DecodeLastRuneInString(f.text[:start])
		if r != '_' && !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			break
		}
		start -= size
	}
	replace := f.lines.rangeOf(start, offset)
	var items []CompletionItem
	switch {
	case a.inImport() != nil:
		items = s.completeImport(a, a.inImport(), offset)
	case start > 0 && f.text[start-1] == '.':
		items = a.completeMember(start - 1)
	default:
		if inComment(f.ast, a.pos) {
			break
		}
		items = a.completeScope()
	}
	for i := range items {
		if items[i].TextEdit == nil {
			items[i].TextEdit = &TextEdit{Range: replace, NewText: items[i].Label}
		}
	}
	if items == nil {
		items = []CompletionItem{}
	}
	return &CompletionList{Items: items}
}

func inComment(f *ast.File, pos token.Pos) bool {
	for _, g := range f.Comments {
		if g.Pos() <= pos && pos <= g.End() {
			return true
		}
	}
	return false
}

// inImport is the import path literal the position is inside, or nil.
func (a *at) inImport() *ast.BasicLit {
	for _, spec := range a.file.ast.Imports {
		if spec.Path != nil && spec.Path.Pos() < a.pos && a.pos <= spec.Path.End() {
			return spec.Path
		}
	}
	return nil
}

// completeImport offers the standard library's packages for the target
// and the module's own, replacing the whole path typed so far.
func (s *Server) completeImport(a *at, lit *ast.BasicLit, offset int) []CompletionItem {
	f := a.file
	from := f.offset(lit.Pos()) + 1
	to := max(from, f.offset(lit.End()))
	if f.text[to-1] == '"' && to-1 >= from {
		to--
	}
	to = max(to, offset)
	r := f.lines.rangeOf(from, min(to, len(f.text)))
	var items []CompletionItem
	for _, dir := range a.snap.Project.Dirs() {
		path := a.snap.Project.ImportPath(dir)
		items = append(items, CompletionItem{Label: path, Kind: kindModule, SortText: "0" + path, TextEdit: &TextEdit{Range: r, NewText: path}})
	}
	for path := range s.index[a.snap.Project.Target.String()] {
		if strings.Contains(path, "internal") || strings.HasPrefix(path, "vendor/") {
			continue
		}
		items = append(items, CompletionItem{Label: path, Kind: kindModule, SortText: "1" + path, TextEdit: &TextEdit{Range: r, NewText: path}})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].SortText < items[j].SortText })
	return items
}

// completeMember offers what may follow the dot at byte offset dot.
func (a *at) completeMember(dot int) []CompletionItem {
	if a.pkg == nil {
		return nil
	}
	var x ast.Expr
	ast.Inspect(a.file.ast, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok && a.file.offset(sel.X.End()) == dot {
			x = sel.X
		}
		return x == nil
	})
	if x == nil {
		return nil
	}
	q := a.qualifier()
	if id, ok := x.(*ast.Ident); ok {
		if pn, ok := a.pkg.Info.Uses[id].(*types.PkgName); ok {
			var items []CompletionItem
			scope := pn.Imported().Scope()
			for _, name := range scope.Names() {
				obj := scope.Lookup(name)
				if obj.Exported() || a.snap.isLocal(obj) && obj.Pkg() == a.pkg.Types {
					items = append(items, item(obj, q, "0"))
				}
			}
			return items
		}
	}
	tv, ok := a.pkg.Info.Types[x]
	if !ok {
		if id, isIdent := x.(*ast.Ident); isIdent && a.pkg.Info.Uses[id] != nil {
			tv = types.TypeAndValue{Type: a.pkg.Info.Uses[id].Type()}
		} else {
			return nil
		}
	}
	return members(tv.Type, a.pkg.Types, q)
}

// members are the fields and methods selectable on a value of type t, the
// shallow ones first, the unexported ones only from their own package.
func members(t types.Type, from *types.Package, q types.Qualifier) []CompletionItem {
	if t == nil {
		return nil
	}
	seen := map[string]bool{}
	var items []CompletionItem
	visible := func(obj types.Object) bool {
		return obj.Exported() || obj.Pkg() == from || (obj.Pkg() != nil && from != nil && obj.Pkg().Path() == from.Path())
	}
	ms := types.NewMethodSet(t)
	if _, isPtr := types.Unalias(t).(*types.Pointer); !isPtr && !types.IsInterface(t) {
		ms = types.NewMethodSet(types.NewPointer(t))
	}
	for i := range ms.Len() {
		sel := ms.At(i)
		obj := sel.Obj()
		if visible(obj) && !seen[obj.Name()] {
			seen[obj.Name()] = true
			items = append(items, item(obj, q, strconv.Itoa(len(sel.Index()))))
		}
	}
	// Fields, through embedded structs, breadth first so that a shallower
	// field shadows a deeper one of the same name.
	type level struct {
		t     types.Type
		depth int
	}
	queue := []level{{t, 0}}
	visited := map[types.Type]bool{}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		under := types.Unalias(cur.t)
		if ptr, ok := under.(*types.Pointer); ok {
			under = types.Unalias(ptr.Elem())
		}
		if visited[under] {
			continue
		}
		visited[under] = true
		st, ok := under.Underlying().(*types.Struct)
		if !ok {
			continue
		}
		for i := range st.NumFields() {
			field := st.Field(i)
			if visible(field) && !seen[field.Name()] {
				seen[field.Name()] = true
				items = append(items, item(field, q, strconv.Itoa(cur.depth+1)))
			}
			if field.Embedded() {
				queue = append(queue, level{field.Type(), cur.depth + 1})
			}
		}
	}
	return items
}

// completeScope offers every name visible at the position, innermost
// first, then the keywords.
func (a *at) completeScope() []CompletionItem {
	if a.pkg == nil {
		return nil
	}
	q := a.qualifier()
	scope := a.pkg.Types.Scope().Innermost(a.pos)
	if scope == nil {
		// Between declarations: the file's scope (its imports), then the
		// package's.
		scope = a.pkg.Info.Scopes[a.file.ast]
		if scope == nil {
			scope = a.pkg.Types.Scope()
		}
	}
	seen := map[string]bool{}
	var items []CompletionItem
	rank := 0
	for sc := scope; sc != nil; sc = sc.Parent() {
		local := sc != a.pkg.Types.Scope() && sc != types.Universe && sc.Parent() != types.Universe
		for _, name := range sc.Names() {
			obj := sc.Lookup(name)
			if name == "_" || seen[name] {
				continue
			}
			if local && obj.Pos().IsValid() && obj.Pos() > a.pos {
				continue // declared later in the function
			}
			seen[name] = true
			items = append(items, item(obj, q, strconv.Itoa(rank)))
		}
		rank++
	}
	for _, kw := range keywords {
		if !seen[kw] {
			items = append(items, CompletionItem{Label: kw, Kind: kindKeyword, SortText: strconv.Itoa(rank) + kw})
		}
	}
	return items
}

// item is one suggestion for obj; sortText ranks it before the label.
func item(obj types.Object, q types.Qualifier, rank string) CompletionItem {
	it := CompletionItem{Label: obj.Name(), SortText: rank + obj.Name()}
	switch o := obj.(type) {
	case *types.Func:
		it.Kind = kindFunction
		if o.Type().(*types.Signature).Recv() != nil {
			it.Kind = kindMethod
		}
		it.Detail = strings.TrimPrefix(types.TypeString(o.Type(), q), "func")
	case *types.Var:
		it.Kind = kindVariable
		if o.IsField() {
			it.Kind = kindField
		}
		it.Detail = types.TypeString(o.Type(), q)
	case *types.Const:
		it.Kind = kindConstant
		it.Detail = types.TypeString(o.Type(), q)
	case *types.TypeName:
		it.Kind = kindClass
		switch {
		case types.IsInterface(o.Type()):
			it.Kind = kindInterface
		case isStruct(o.Type()):
			it.Kind = kindStruct
		}
		if _, ok := o.Type().(*types.TypeParam); ok {
			it.Kind = kindTypeParam
		}
	case *types.PkgName:
		it.Kind = kindModule
		it.Detail = strconv.Quote(o.Imported().Path())
	case *types.Builtin:
		it.Kind = kindFunction
	case *types.Nil:
		it.Kind = kindConstant
	default:
		it.Kind = kindText
	}
	return it
}

func isStruct(t types.Type) bool {
	_, ok := t.Underlying().(*types.Struct)
	return ok
}
