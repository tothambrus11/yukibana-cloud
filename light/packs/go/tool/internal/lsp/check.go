package lsp

import (
	"errors"
	"fmt"
	"go/ast"
	"go/build"
	"go/parser"
	"go/scanner"
	"go/token"
	"go/types"
	"path"
	"slices"
	"strings"

	"yukibana.dev/light/packs/go/tool/internal/project"
)

// Std is the standard library of one target, as far as it has arrived: the
// worker downloads a package's archive when the server first asks for it
// (Snapshot.Missing) and hands it over with Server.AddStd.
type Std interface {
	// Has reports whether path is a package of the target's standard
	// library, downloaded or not.
	Has(path string) bool
	// Data is the package's archive (export data and all), or nil when it
	// has not arrived yet.
	Data(path string) []byte
}

// file is a project .go file, parsed once per snapshot. A file with syntax
// errors still has an AST, as complete as the parser could make it, which
// completion relies on (a selector with nothing after the dot yet).
type file struct {
	path   string
	text   string
	ast    *ast.File
	tok    *token.File
	lines  *lines
	errors scanner.ErrorList
}

// Package is one type-checked package of a snapshot.
type Package struct {
	// Key names the variant: its directory, with " [test]" for the package
	// compiled with its tests and "_test" for the external tests.
	Key   string
	Types *types.Package
	Info  *types.Info
	Files []*file
	// Errors are go/types' errors, in the order it found them.
	Errors []types.Error
}

// Snapshot is the type-checked project at one moment. Nothing in it changes
// after checking; an edit makes the next snapshot.
type Snapshot struct {
	Project *project.Project
	Fset    *token.FileSet
	files   map[string]*file
	// Packages by key, and the package each file is reported from: its
	// package with tests when it has one, so that test files and the files
	// they test agree.
	Packages map[string]*Package
	owner    map[string]*Package
	// Excluded are .go files the target's build constraints leave out, by
	// project path, with the directory's go/build error when the whole
	// directory is left out or cannot be read.
	Excluded map[string]bool
	// DirErrors are go/build's errors for a directory (two package names),
	// by the file they are reported on.
	DirErrors map[string]string
	// Missing are standard library packages that were imported before
	// their archives arrived: the snapshot's errors are not final while
	// there are any.
	Missing []string

	std      Std
	importer types.ImporterFrom
}

// check type-checks every package of p, each once and its tests' variants
// beside it. stdImporter reads the standard library (shared between
// snapshots, see Server); every import it is asked for and cannot answer
// yet is recorded in Missing.
func check(p *project.Project, std Std, stdImporter types.ImporterFrom, missing func() []string) *Snapshot {
	s := &Snapshot{
		Project: p, Fset: token.NewFileSet(), files: map[string]*file{},
		Packages: map[string]*Package{}, owner: map[string]*Package{},
		Excluded: map[string]bool{}, DirErrors: map[string]string{},
		std: std, importer: stdImporter,
	}
	paths := make([]string, 0, len(p.Files))
	for name := range p.Files {
		if strings.HasSuffix(name, ".go") {
			paths = append(paths, name)
		}
	}
	slices.Sort(paths)
	for _, name := range paths {
		s.parse(name)
	}
	for _, dir := range p.Dirs() {
		s.checkDir(dir)
	}
	s.Missing = missing()
	return s
}

func (s *Snapshot) parse(name string) *file {
	if f, ok := s.files[name]; ok {
		return f
	}
	text := s.Project.Files[name]
	f := &file{path: name, text: text, lines: newLines(text)}
	astFile, err := parser.ParseFile(s.Fset, name, text, parser.ParseComments|parser.AllErrors|parser.SkipObjectResolution)
	f.ast = astFile
	if list, ok := err.(scanner.ErrorList); ok {
		f.errors = list
	}
	if astFile != nil {
		f.tok = s.Fset.File(astFile.Pos())
	}
	s.files[name] = f
	return f
}

// checkDir checks the package in dir, then its test variants.
func (s *Snapshot) checkDir(dir string) {
	pkg, err := s.Project.Package(dir)
	if pkg != nil {
		for _, name := range pkg.IgnoredGoFiles {
			s.Excluded[path.Join(dir, name)] = true
		}
	}
	var multiple *build.MultiplePackageError
	if errors.As(err, &multiple) {
		s.DirErrors[path.Join(dir, multiple.Files[1])] = fmt.Sprintf("found packages %s (%s) and %s (%s) in %s",
			multiple.Packages[0], multiple.Files[0], multiple.Packages[1], multiple.Files[1], dirName(dir))
		return
	}
	if pkg == nil {
		return
	}
	base := s.checkPackage(dir, dir, pkg.Name, pkg.GoFiles, nil)
	owner := base
	if len(pkg.TestGoFiles) > 0 {
		owner = s.checkPackage(dir+" [test]", dir, pkg.Name, slices.Concat(pkg.GoFiles, pkg.TestGoFiles), nil)
	}
	for _, f := range owner.Files {
		s.owner[f.path] = owner
	}
	if len(pkg.XTestGoFiles) > 0 {
		x := s.checkPackage(dir+"_test", dir, pkg.Name+"_test", pkg.XTestGoFiles, map[string]*types.Package{s.Project.ImportPath(dir): owner.Types})
		for _, f := range x.Files {
			s.owner[f.path] = x
		}
	}
}

func dirName(dir string) string {
	if dir == "" {
		return "."
	}
	return "./" + dir
}

// checkPackage type-checks one variant. `replace` maps an import path to the
// package that import gets instead of the module's own (the external tests
// import the package with its tests).
func (s *Snapshot) checkPackage(key, dir, name string, names []string, replace map[string]*types.Package) *Package {
	if pkg, ok := s.Packages[key]; ok {
		return pkg
	}
	pkg := &Package{Key: key, Info: &types.Info{
		Types: map[ast.Expr]types.TypeAndValue{}, Defs: map[*ast.Ident]types.Object{}, Uses: map[*ast.Ident]types.Object{},
		Implicits: map[ast.Node]types.Object{}, Selections: map[*ast.SelectorExpr]*types.Selection{}, Scopes: map[ast.Node]*types.Scope{},
	}}
	// Registered first, so that an import cycle finds it (unfinished)
	// rather than recursing forever; the checker reports the cycle.
	s.Packages[key] = pkg
	var asts []*ast.File
	for _, n := range names {
		f := s.parse(path.Join(dir, n))
		pkg.Files = append(pkg.Files, f)
		if f.ast != nil {
			asts = append(asts, f.ast)
		}
	}
	importPath := s.Project.ImportPath(dir)
	if strings.HasSuffix(key, "_test") {
		importPath += "_test"
	}
	conf := types.Config{
		GoVersion: "go" + s.Project.GoVersion,
		Importer:  &localImporter{s: s, replace: replace, from: key},
		Sizes:     types.SizesFor("gc", s.Project.Target.GOARCH),
		Error: func(err error) {
			if e, ok := err.(types.Error); ok {
				pkg.Errors = append(pkg.Errors, e)
			}
		},
	}
	pkg.Types, _ = conf.Check(importPath, s.Fset, asts, pkg.Info)
	if pkg.Types == nil {
		pkg.Types = types.NewPackage(importPath, name)
	}
	return pkg
}

// localImporter resolves one package's imports: the module's packages from this
// snapshot, everything else from the standard library.
type localImporter struct {
	s       *Snapshot
	replace map[string]*types.Package
	from    string
}

func (i *localImporter) Import(path string) (*types.Package, error) {
	return i.ImportFrom(path, "", 0)
}

func (i *localImporter) ImportFrom(importPath, _ string, _ types.ImportMode) (*types.Package, error) {
	if pkg, ok := i.replace[importPath]; ok {
		return pkg, nil
	}
	p := i.s.Project
	if dir, ok := p.DirOf(importPath); ok {
		if !slices.Contains(p.Dirs(), dir) {
			return nil, fmt.Errorf("package %s is not in the project: no Go files in %s", importPath, dirName(dir))
		}
		bp, err := p.Package(dir)
		if err != nil {
			return nil, err
		}
		if bp.Name == "main" {
			return nil, fmt.Errorf("import %q is a program, not an importable package", importPath)
		}
		if pkg, ok := i.s.Packages[dir]; ok && pkg.Types == nil {
			// Still being checked: this import closes a cycle.
			return nil, fmt.Errorf("import cycle not allowed: %s imports itself through %s", importPath, i.from)
		}
		return i.s.checkPackage(dir, dir, bp.Name, bp.GoFiles, nil).Types, nil
	}
	if importPath == "C" {
		return nil, errors.New(`cgo (import "C") is not supported here`)
	}
	if !i.s.std.Has(importPath) {
		if first, _, _ := strings.Cut(importPath, "/"); strings.Contains(first, ".") {
			return nil, fmt.Errorf("no required module provides package %s: only the standard library and this module's packages are available here", importPath)
		}
		return nil, fmt.Errorf("package %s is not in std", importPath)
	}
	return i.s.importer.ImportFrom(importPath, "", 0)
}

// File is the parsed file at a project path, or nil.
func (s *Snapshot) File(name string) *file { return s.files[name] }

// Owner is the checked package a file is reported from, or nil for a file
// no package builds (excluded by build constraints, or in a skipped
// directory).
func (s *Snapshot) Owner(name string) *Package { return s.owner[name] }

// rangeOf is the protocol range of [pos, end) in f.
func (f *file) rangeOf(pos, end token.Pos) Range {
	return f.lines.rangeOf(f.offset(pos), f.offset(end))
}

// offset is the byte offset of pos in f, clamped to it.
func (f *file) offset(pos token.Pos) int {
	if f.tok == nil || !pos.IsValid() {
		return 0
	}
	if int(pos) < f.tok.Base() {
		return 0
	}
	if int(pos) > f.tok.Base()+f.tok.Size() {
		return f.tok.Size()
	}
	return f.tok.Offset(pos)
}

// pos is the token.Pos of a protocol position in f.
func (f *file) pos(p Position) token.Pos {
	if f.tok == nil {
		return token.NoPos
	}
	return f.tok.Pos(f.lines.offset(p))
}
