package lsp

import (
	"fmt"
	"go/ast"
	"go/doc/comment"
	"go/types"
	"strings"
)

// hover shows the declaration of the name at the position, as Go would
// write it, its documentation when it is the project's own, and for the
// standard library a link to its documentation on pkg.go.dev (the archives
// the pack ships have types, not comments).
func (s *Server) hover(p textDocumentPositionParams) *Hover {
	a := s.at(p)
	obj := a.object()
	if obj == nil {
		return a.hoverExpression()
	}
	var b strings.Builder
	b.WriteString("```go\n")
	b.WriteString(a.declaration(obj))
	b.WriteString("\n```")
	if docs := a.snap.docOf(obj); docs != "" {
		b.WriteString("\n\n")
		b.WriteString(docs)
	}
	if link := a.snap.docLink(obj); link != "" {
		b.WriteString("\n\n")
		b.WriteString(link)
	}
	r := a.file.rangeOf(a.ident.Pos(), a.ident.End())
	return &Hover{Contents: MarkupContent{Kind: "markdown", Value: b.String()}, Range: &r}
}

// hoverExpression is the type (and constant value) of a literal or other
// expression with no name at the position.
func (a *at) hoverExpression() *Hover {
	if a == nil || a.pkg == nil || len(a.path) == 0 {
		return nil
	}
	expr, ok := a.path[0].(*ast.BasicLit)
	if !ok {
		return nil
	}
	tv, ok := a.pkg.Info.Types[expr]
	if !ok {
		return nil
	}
	text := types.TypeString(tv.Type, a.qualifier())
	if tv.Value != nil {
		text = fmt.Sprintf("%s = %s", text, tv.Value)
	}
	r := a.file.rangeOf(expr.Pos(), expr.End())
	return &Hover{Contents: MarkupContent{Kind: "markdown", Value: "```go\n" + text + "\n```"}, Range: &r}
}

// qualifier writes other packages' names as the file refers to them.
func (a *at) qualifier() types.Qualifier {
	return func(pkg *types.Package) string {
		if a.pkg != nil && pkg == a.pkg.Types {
			return ""
		}
		return pkg.Name()
	}
}

// declaration is obj as a declaration: "func (p Point) Norm() float64",
// "field X float64", "type Point struct{...}".
func (a *at) declaration(obj types.Object) string {
	q := a.qualifier()
	switch o := obj.(type) {
	case *types.PkgName:
		return fmt.Sprintf("package %s (%q)", o.Imported().Name(), o.Imported().Path())
	case *types.TypeName:
		if o.IsAlias() {
			return fmt.Sprintf("type %s = %s", o.Name(), types.TypeString(types.Unalias(o.Type()), q))
		}
		under := o.Type().Underlying()
		if named, ok := o.Type().(*types.Named); ok && named.TypeParams().Len() > 0 {
			return fmt.Sprintf("type %s%s %s", o.Name(), typeParams(named.TypeParams(), q), types.TypeString(under, q))
		}
		text := fmt.Sprintf("type %s %s", o.Name(), types.TypeString(under, q))
		if o.Pkg() == nil {
			return text
		}
		return text + methods(o, q, a.snap.isLocal(o))
	case *types.Func:
		sig := o.Type().(*types.Signature)
		recv := sig.Recv()
		if recv == nil {
			return types.ObjectString(o, q)
		}
		// As it is declared: func (p Point) Norm() float64.
		name := recv.Name()
		if name != "" && name != "_" {
			name += " "
		}
		return fmt.Sprintf("func (%s%s) %s%s", name, types.TypeString(recv.Type(), q), o.Name(), strings.TrimPrefix(types.TypeString(sig, q), "func"))
	case *types.Var:
		if o.IsField() {
			return fmt.Sprintf("field %s %s", o.Name(), types.TypeString(o.Type(), q))
		}
	}
	return types.ObjectString(obj, q)
}

func typeParams(list *types.TypeParamList, q types.Qualifier) string {
	parts := make([]string, list.Len())
	for i := range parts {
		tp := list.At(i)
		parts[i] = tp.Obj().Name() + " " + types.TypeString(tp.Constraint(), q)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// methods lists a defined type's methods after its declaration, as the
// documentation would: all of them for the project's own type, the
// exported ones for another package's.
func methods(tn *types.TypeName, q types.Qualifier, local bool) string {
	named, ok := tn.Type().(*types.Named)
	if !ok || named.NumMethods() == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n")
	for i := range named.NumMethods() {
		m := named.Method(i)
		if !m.Exported() && !local {
			continue
		}
		sig := m.Type().(*types.Signature)
		recv := "?"
		if sig.Recv() != nil {
			recv = types.TypeString(sig.Recv().Type(), q)
		}
		b.WriteString(fmt.Sprintf("\nfunc (%s) %s%s", recv, m.Name(), strings.TrimPrefix(types.TypeString(sig, q), "func")))
	}
	return b.String()
}

// docOf is the doc comment of a project declaration, as Markdown.
func (snap *Snapshot) docOf(obj types.Object) string {
	if !snap.isLocal(obj) {
		return ""
	}
	pos := snap.Fset.Position(obj.Pos())
	f := snap.File(pos.Filename)
	if f == nil || f.ast == nil {
		return ""
	}
	var group *ast.CommentGroup
	for _, n := range enclosing(f.ast, obj.Pos()) {
		switch d := n.(type) {
		case *ast.FuncDecl:
			group = d.Doc
		case *ast.Field:
			group = d.Doc
			if group == nil {
				group = d.Comment
			}
		case *ast.TypeSpec:
			group = d.Doc
			if group == nil {
				group = d.Comment
			}
		case *ast.ValueSpec:
			group = d.Doc
			if group == nil {
				group = d.Comment
			}
		case *ast.GenDecl:
			if group == nil && len(d.Specs) == 1 {
				group = d.Doc
			}
		default:
			continue
		}
		if group != nil {
			break
		}
	}
	if group == nil {
		return ""
	}
	var parser comment.Parser
	var printer comment.Printer
	return strings.TrimSpace(string(printer.Markdown(parser.Parse(group.Text()))))
}

// docLink links a standard library declaration to its documentation; the
// project's own declarations have none online.
func (snap *Snapshot) docLink(obj types.Object) string {
	pkg := obj.Pkg()
	if pkg == nil {
		return "[`" + obj.Name() + "` on pkg.go.dev](https://pkg.go.dev/builtin#" + obj.Name() + ")"
	}
	if pn, ok := obj.(*types.PkgName); ok {
		pkg = pn.Imported()
		if snap.isProjectPath(pkg.Path()) {
			return ""
		}
		return fmt.Sprintf("[`%s` on pkg.go.dev](https://pkg.go.dev/%s)", pkg.Path(), pkg.Path())
	}
	if snap.isProjectPath(pkg.Path()) || obj.Parent() != pkg.Scope() && !isMethodOrField(obj) {
		return ""
	}
	anchor := obj.Name()
	if f, ok := obj.(*types.Func); ok {
		if recv := f.Type().(*types.Signature).Recv(); recv != nil {
			if named := namedOf(recv.Type()); named != nil {
				anchor = named.Obj().Name() + "." + obj.Name()
			}
		}
	}
	return fmt.Sprintf("[`%s.%s` on pkg.go.dev](https://pkg.go.dev/%s#%s)", pkg.Name(), anchor, pkg.Path(), anchor)
}

func isMethodOrField(obj types.Object) bool {
	switch o := obj.(type) {
	case *types.Func:
		return o.Type().(*types.Signature).Recv() != nil
	case *types.Var:
		return o.IsField()
	}
	return false
}

// isProjectPath reports whether an import path is the project's: one of
// its module's packages, their external tests, or a test's main.
func (snap *Snapshot) isProjectPath(path string) bool {
	_, ok := snap.Project.DirOf(strings.TrimSuffix(path, "_test"))
	return ok || path == "main"
}
