package lsp

import (
	"errors"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"slices"
	"sort"
	"strings"
)

// enclosing is the chain of nodes of f that contain pos, innermost
// (smallest) first. A position just after a node (the caret at the end of
// a name) is in it. Sorted by size rather than taken in visiting order: a
// method's FuncType starts at `func`, so it contains the method's name,
// which is not its child.
func enclosing(f *ast.File, pos token.Pos) []ast.Node {
	var path []ast.Node
	ast.Inspect(f, func(n ast.Node) bool {
		if n == nil || pos < n.Pos() || pos > n.End() {
			return false
		}
		path = append(path, n)
		return true
	})
	slices.Reverse(path)
	slices.SortStableFunc(path, func(a, b ast.Node) int { return int(a.End()-a.Pos()) - int(b.End()-b.Pos()) })
	return path
}

// at is what is at a protocol position of a document: its file, the package
// that owns it, and the identifier there (nil if none).
type at struct {
	snap  *Snapshot
	file  *file
	pkg   *Package
	pos   token.Pos
	path  []ast.Node
	ident *ast.Ident
}

func (s *Server) at(p textDocumentPositionParams) *at {
	name, ok := pathOf(p.TextDocument.URI)
	if !ok {
		return nil
	}
	snap := s.check()
	f := snap.File(name)
	if f == nil || f.ast == nil {
		return nil
	}
	a := &at{snap: snap, file: f, pkg: snap.Owner(name), pos: f.pos(p.Position)}
	a.path = enclosing(f.ast, a.pos)
	if len(a.path) > 0 {
		a.ident, _ = a.path[0].(*ast.Ident)
	}
	return a
}

// object is what the identifier at the position names or declares.
func (a *at) object() types.Object {
	if a == nil || a.ident == nil || a.pkg == nil {
		return nil
	}
	if obj := a.pkg.Info.Defs[a.ident]; obj != nil {
		return obj
	}
	if obj := a.pkg.Info.Uses[a.ident]; obj != nil {
		return obj
	}
	// The package name of a file's package clause, and a type switch's
	// bound variable, have implicit objects.
	for _, n := range a.path {
		if obj := a.pkg.Info.Implicits[n]; obj != nil {
			return obj
		}
	}
	return nil
}

// isLocal reports whether obj is declared in the project, where its
// position is in the snapshot's file set: the standard library's objects
// have positions in the importer's own.
func (snap *Snapshot) isLocal(obj types.Object) bool {
	if obj == nil || obj.Pkg() == nil || !obj.Pos().IsValid() {
		return false
	}
	path := strings.TrimSuffix(obj.Pkg().Path(), "_test")
	_, ok := snap.Project.DirOf(path)
	return ok
}

// location is the protocol location of a local object's declaration.
func (snap *Snapshot) location(obj types.Object) (Location, bool) {
	if !snap.isLocal(obj) {
		return Location{}, false
	}
	pos := snap.Fset.Position(obj.Pos())
	f := snap.File(pos.Filename)
	if f == nil {
		return Location{}, false
	}
	return Location{URI: uriOf(f.path), Range: f.lines.rangeOf(pos.Offset, pos.Offset+len(obj.Name()))}, true
}

func (s *Server) definition(p textDocumentPositionParams, typeDefinition bool) []Location {
	a := s.at(p)
	obj := a.object()
	if obj == nil {
		return nil
	}
	if typeDefinition {
		named := namedOf(obj.Type())
		if named == nil {
			return nil
		}
		obj = named.Obj()
	}
	if pkgName, ok := obj.(*types.PkgName); ok {
		// A local package's import: its first file.
		if dir, ok := a.snap.Project.DirOf(pkgName.Imported().Path()); ok {
			if pkg := a.snap.Packages[dir]; pkg != nil && len(pkg.Files) > 0 {
				return []Location{{URI: uriOf(pkg.Files[0].path)}}
			}
		}
		return nil
	}
	if loc, ok := a.snap.location(obj); ok {
		return []Location{loc}
	}
	return nil
}

// namedOf is the named type behind t, through pointers, or nil.
func namedOf(t types.Type) *types.Named {
	if t == nil {
		return nil
	}
	if ptr, ok := types.Unalias(t).(*types.Pointer); ok {
		t = ptr.Elem()
	}
	named, _ := types.Unalias(t).(*types.Named)
	return named
}

// same reports whether a and b are one declaration: the same object, or,
// for the project's own, objects at the same place (a package and its test
// variant are checked separately and have an object each).
func (snap *Snapshot) same(a, b types.Object) bool {
	if a == b {
		return true
	}
	if a == nil || b == nil || a.Name() != b.Name() || !snap.isLocal(a) || !snap.isLocal(b) {
		return false
	}
	return a.Pos() == b.Pos()
}

type occurrence struct {
	file  *file
	ident *ast.Ident
	def   bool
}

// occurrences are every identifier in the project naming obj, once each,
// sorted by file and position.
func (snap *Snapshot) occurrences(obj types.Object) []occurrence {
	seen := map[token.Pos]bool{}
	var out []occurrence
	for _, pkg := range snap.Packages {
		for _, uses := range []map[*ast.Ident]types.Object{pkg.Info.Defs, pkg.Info.Uses} {
			for id, o := range uses {
				if o == nil || seen[id.Pos()] || !snap.same(o, obj) {
					continue
				}
				f := snap.File(snap.Fset.Position(id.Pos()).Filename)
				if f == nil {
					continue
				}
				seen[id.Pos()] = true
				_, def := pkg.Info.Defs[id]
				out = append(out, occurrence{file: f, ident: id, def: def})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].file.path != out[j].file.path {
			return out[i].file.path < out[j].file.path
		}
		return out[i].ident.Pos() < out[j].ident.Pos()
	})
	return out
}

func (s *Server) references(p textDocumentPositionParams, includeDeclaration bool) []Location {
	a := s.at(p)
	obj := a.object()
	if obj == nil {
		return nil
	}
	locs := []Location{}
	for _, o := range a.snap.occurrences(obj) {
		if o.def && !includeDeclaration {
			continue
		}
		locs = append(locs, Location{URI: uriOf(o.file.path), Range: o.file.rangeOf(o.ident.Pos(), o.ident.End())})
	}
	return locs
}

func (s *Server) highlights(p textDocumentPositionParams) []DocumentHighlight {
	a := s.at(p)
	obj := a.object()
	if obj == nil {
		return nil
	}
	out := []DocumentHighlight{}
	for _, o := range a.snap.occurrences(obj) {
		if o.file != a.file {
			continue
		}
		kind := 2
		if o.def {
			kind = 3
		}
		out = append(out, DocumentHighlight{Range: o.file.rangeOf(o.ident.Pos(), o.ident.End()), Kind: kind})
	}
	return out
}

// rename renames a declaration of the project and every use of it. The
// standard library's names, the universe's and package names are refused:
// renaming them would change what the program means elsewhere.
func (s *Server) rename(p renameParams) (*WorkspaceEdit, error) {
	a := s.at(p.textDocumentPositionParams)
	obj := a.object()
	switch {
	case obj == nil:
		return nil, errors.New("there is no name here to rename")
	case !token.IsIdentifier(p.NewName):
		return nil, fmt.Errorf("%q is not a valid Go identifier", p.NewName)
	case obj.Pkg() == nil:
		return nil, fmt.Errorf("%s is predeclared and cannot be renamed", obj.Name())
	case !a.snap.isLocal(obj):
		return nil, fmt.Errorf("%s is declared in package %s, outside the project", obj.Name(), obj.Pkg().Path())
	}
	if _, ok := obj.(*types.PkgName); ok {
		return nil, errors.New("renaming an imported package is not supported")
	}
	edit := &WorkspaceEdit{Changes: map[string][]TextEdit{}}
	for _, o := range a.snap.occurrences(obj) {
		uri := uriOf(o.file.path)
		edit.Changes[uri] = append(edit.Changes[uri], TextEdit{Range: o.file.rangeOf(o.ident.Pos(), o.ident.End()), NewText: p.NewName})
	}
	return edit, nil
}
