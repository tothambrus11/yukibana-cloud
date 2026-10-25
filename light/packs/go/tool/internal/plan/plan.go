// Package plan decides what Run and Test compile: which packages, from which
// files, in which order, against which standard library packages, the way
// the go command would for `go run .` and `go test ./...`. It reads files
// and writes nothing; the runner (../../../src/runner.js) does the compiling
// and linking with the real compile and link, by these plans.
package plan

import (
	"errors"
	"fmt"
	"go/build"
	"go/parser"
	"go/token"
	"path"
	"slices"
	"strings"

	"yukibana.dev/light/packs/go/tool/internal/project"
)

// Unit is one invocation of the compiler: one package, compiled to an
// archive that later units and the linker find by ImportPath.
type Unit struct {
	// ImportPath is what other units import it as, and the compiler's -p.
	// "main" for the program's main package and for a test main.
	ImportPath string `json:"importPath"`
	// Dir is the package's directory in the project ("" for the root).
	Dir string `json:"dir"`
	// Files are the project paths compiled, in go/build's order.
	Files []string `json:"files"`
	// Generated is a file the planner wrote (a test main), by its path
	// outside the project ("_testmain.go") to its text.
	Generated map[string]string `json:"generated,omitempty"`
	// Imports are every import path its files name, sorted, local and
	// standard library alike.
	Imports []string `json:"imports"`
}

// Build is the units of one program, each after every unit it imports; the
// last one is the main package the linker starts from.
type Build struct {
	// Package is the import path of what is built: the main package for a
	// run, the package under test for a test.
	Package string `json:"package"`
	Units   []Unit `json:"units"`
	// Std are the standard library packages the units import directly,
	// sorted. The runner adds what they import in turn (the standard
	// library's index), and what every program links (runtime's).
	Std []string `json:"std"`
}

// Error is a problem that stops the build, at a project file's 1-based line
// and column (0 when it has none).
type Error struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

func (e Error) String() string {
	switch {
	case e.File == "":
		return e.Message
	case e.Line == 0:
		return e.File + ": " + e.Message
	case e.Column == 0:
		return fmt.Sprintf("%s:%d: %s", e.File, e.Line, e.Message)
	}
	return fmt.Sprintf("%s:%d:%d: %s", e.File, e.Line, e.Column, e.Message)
}

// Plan is what Run or Test does.
type Plan struct {
	// Builds are the programs to link and run, in order: one for a run,
	// one per package with tests for a test.
	Builds []Build `json:"builds"`
	// NoTests are the packages a test found no test files in, which `go
	// test` reports as "[no test files]", in the order of the project's
	// directories among Builds.
	NoTests []string `json:"noTests,omitempty"`
	// Errors stop everything: the runner prints them and compiles nothing.
	Errors []Error `json:"errors,omitempty"`
}

// Run plans `go run` of the package in the directory of `entry` (a project
// path, "main.go"), which must be package main.
func Run(p *project.Project, entry string, std project.Library) Plan {
	l := newLoader(p, std)
	dir := path.Dir(entry)
	if dir == "." {
		dir = ""
	}
	pkg := l.load(dir, nil)
	if pkg == nil {
		return Plan{Errors: l.errors}
	}
	if pkg.Name != "main" {
		l.fail(Error{File: firstFile(pkg), Line: 1, Message: fmt.Sprintf("package %s is not a main package", pkg.ImportPath)})
	}
	b := l.build(pkg.ImportPath, l.closure(pkg, false), nil)
	if len(l.errors) > 0 {
		return Plan{Errors: l.errors}
	}
	// The main package is compiled with -p main, as the go command does.
	b.Units[len(b.Units)-1].ImportPath = "main"
	return Plan{Builds: []Build{b}}
}

// Test plans `go test ./...`: a test binary for every package with test
// files, in the order of the project's directories.
func Test(p *project.Project, std project.Library) Plan {
	l := newLoader(p, std)
	var plan Plan
	for _, dir := range p.Dirs() {
		pkg := l.load(dir, nil)
		if pkg == nil {
			continue
		}
		if len(pkg.TestGoFiles) == 0 && len(pkg.XTestGoFiles) == 0 {
			plan.NoTests = append(plan.NoTests, pkg.ImportPath)
			continue
		}
		if b, ok := l.testBuild(pkg); ok {
			plan.Builds = append(plan.Builds, b)
		}
	}
	if len(l.errors) > 0 {
		return Plan{Errors: l.errors}
	}
	return plan
}

// loader reads packages once each and remembers what went wrong.
type loader struct {
	p      *project.Project
	std    project.Library
	pkgs   map[string]*build.Package // by directory; nil: failed
	errors []Error
}

func newLoader(p *project.Project, std project.Library) *loader {
	l := &loader{p: p, std: std, pkgs: map[string]*build.Package{}}
	for _, problem := range p.Problems {
		// go.env and go.mod problems fall back to defaults; only the ones
		// that make the build meaningless stop it.
		if strings.Contains(problem.Message, "requires go >=") {
			l.fail(Error{File: problem.File, Line: problem.Line, Message: problem.Message})
		}
	}
	return l
}

func (l *loader) fail(e Error) {
	if !slices.Contains(l.errors, e) {
		l.errors = append(l.errors, e)
	}
}

// load reads the package in dir, or reports why it cannot be built, at the
// import that asked for it when there is one.
func (l *loader) load(dir string, at *token.Position) *build.Package {
	if pkg, ok := l.pkgs[dir]; ok {
		return pkg
	}
	pkg, err := l.p.Package(dir)
	var noGo *build.NoGoError
	var multiple *build.MultiplePackageError
	switch {
	case errors.As(err, &noGo) && len(pkg.TestGoFiles)+len(pkg.XTestGoFiles) > 0 && at == nil:
		// A directory of tests alone still has tests to run.
	case errors.As(err, &noGo):
		message := fmt.Sprintf("no Go files in %s", displayDir(dir))
		if len(pkg.IgnoredGoFiles) > 0 {
			message = fmt.Sprintf("build constraints exclude all Go files in %s", displayDir(dir))
		}
		e := errorAt(at, dir, message)
		if cgo := l.cgoImport(dir, pkg.IgnoredGoFiles); cgo != nil {
			// With cgo off, go/build leaves such a file out, which would
			// otherwise read as a build constraint excluding it.
			e = *cgo
		}
		l.fail(e)
		pkg = nil
	case errors.As(err, &multiple):
		l.fail(Error{File: path.Join(dir, multiple.Files[1]), Line: 1, Message: fmt.Sprintf("found packages %s (%s) and %s (%s) in %s",
			multiple.Packages[0], multiple.Files[0], multiple.Packages[1], multiple.Files[1], displayDir(dir))})
		pkg = nil
	case err != nil:
		l.fail(errorAt(at, dir, err.Error()))
		pkg = nil
	}
	if pkg != nil {
		// InvalidGoFiles (a parse error) are left to the compiler, which
		// names the error with its position.
		if len(pkg.SFiles)+len(pkg.CgoFiles)+len(pkg.CFiles) > 0 {
			l.fail(Error{File: firstOf(dir, pkg.SFiles, pkg.CgoFiles, pkg.CFiles), Message: "assembly, cgo and C files are not supported here"})
			pkg = nil
		} else if len(pkg.EmbedPatterns) > 0 {
			pos := pkg.EmbedPatternPos[pkg.EmbedPatterns[0]][0]
			l.fail(Error{File: path.Join(dir, path.Base(pos.Filename)), Line: pos.Line, Column: pos.Column, Message: "//go:embed is not supported here"})
			pkg = nil
		}
	}
	l.pkgs[dir] = pkg
	return pkg
}

// cgoImport is the error for the first of `names` (files of dir) that
// imports "C", or nil.
func (l *loader) cgoImport(dir string, names []string) *Error {
	for _, name := range names {
		file := path.Join(dir, name)
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, file, l.p.Files[file], parser.ImportsOnly)
		if err != nil {
			continue
		}
		for _, spec := range f.Imports {
			if spec.Path.Value == `"C"` {
				e := l.at(fset, spec.Pos(), `cgo (import "C") is not supported here`)
				return &e
			}
		}
	}
	return nil
}

func displayDir(dir string) string {
	if dir == "" {
		return "."
	}
	return "./" + dir
}

func errorAt(at *token.Position, dir, message string) Error {
	if at == nil {
		return Error{File: dir, Message: message}
	}
	return Error{File: at.Filename, Line: at.Line, Column: at.Column, Message: message}
}

func firstFile(pkg *build.Package) string {
	return firstOf(pkg.Dir, pkg.GoFiles)
}

func firstOf(dir string, lists ...[]string) string {
	for _, list := range lists {
		if len(list) > 0 {
			return path.Join(dir, list[0])
		}
	}
	return dir
}

// closure is pkg and every local package it imports, directly or not, each
// after the ones it imports (the order the compiler needs them in). With
// tests, the package's own test imports count as its imports.
func (l *loader) closure(root *build.Package, tests bool) []*build.Package {
	return l.order([]*build.Package{root}, map[*build.Package]bool{root: tests})
}

// order is closure for several roots in turn, sharing what was visited: a
// package comes once, after everything it imports. withTests names the
// packages whose test imports count.
func (l *loader) order(roots []*build.Package, withTests map[*build.Package]bool) []*build.Package {
	var order []*build.Package
	state := map[*build.Package]int{} // 1: visiting, 2: done
	var stack []string
	var visit func(pkg *build.Package, withTests bool)
	visit = func(pkg *build.Package, withTests bool) {
		switch state[pkg] {
		case 1:
			cycle := append(slices.Clone(stack[slices.Index(stack, pkg.ImportPath):]), pkg.ImportPath)
			l.fail(Error{File: firstFile(pkg), Message: "import cycle not allowed: " + strings.Join(cycle, " -> ")})
			return
		case 2:
			return
		}
		state[pkg] = 1
		stack = append(stack, pkg.ImportPath)
		imports, positions := pkg.Imports, pkg.ImportPos
		if withTests {
			imports, positions = mergeImports(pkg.Imports, pkg.ImportPos, pkg.TestImports, pkg.TestImportPos)
		}
		for _, imp := range imports {
			dep := l.local(pkg, imp, positions[imp])
			if dep != nil {
				visit(dep, false)
			}
		}
		stack = stack[:len(stack)-1]
		state[pkg] = 2
		order = append(order, pkg)
	}
	for _, root := range roots {
		visit(root, withTests[root])
	}
	return order
}

func mergeImports(a []string, apos map[string][]token.Position, b []string, bpos map[string][]token.Position) ([]string, map[string][]token.Position) {
	all := slices.Concat(a, b)
	slices.Sort(all)
	pos := map[string][]token.Position{}
	for _, m := range []map[string][]token.Position{apos, bpos} {
		for k, v := range m {
			pos[k] = append(pos[k], v...)
		}
	}
	return slices.Compact(all), pos
}

// local resolves one import of pkg: the module's package it names, or nil
// for a standard library package (or one that cannot be resolved, which is
// reported at the import).
func (l *loader) local(pkg *build.Package, imp string, positions []token.Position) *build.Package {
	at := l.position(pkg, positions)
	if dir, ok := l.p.DirOf(imp); ok {
		if !slices.Contains(l.p.Dirs(), dir) {
			l.fail(errorAt(at, dir, fmt.Sprintf("package %s is not in the project: no Go files in %s", imp, displayDir(dir))))
			return nil
		}
		dep := l.load(dir, at)
		if dep != nil && dep.Name == "main" {
			l.fail(errorAt(at, dir, fmt.Sprintf("import %q is a program, not an importable package", imp)))
			return nil
		}
		return dep
	}
	if !l.std.Has(l.p.Target, imp) {
		l.fail(errorAt(at, pkg.Dir, l.std.ImportProblem(l.p.Target, imp)))
	}
	return nil
}

// position is the first place pkg's files name an import, as a project path.
func (l *loader) position(pkg *build.Package, positions []token.Position) *token.Position {
	if len(positions) == 0 {
		return nil
	}
	pos := positions[0]
	pos.Filename = path.Join(pkg.Dir, path.Base(pos.Filename))
	return &pos
}

// build turns an ordered closure into units. `replace` swaps a package's
// unit for another (the package under test, compiled with its tests).
func (l *loader) build(name string, pkgs []*build.Package, replace map[string]Unit) Build {
	b := Build{Package: name}
	std := map[string]bool{}
	for _, pkg := range pkgs {
		u, ok := replace[pkg.ImportPath]
		if !ok {
			u = Unit{ImportPath: pkg.ImportPath, Dir: pkg.Dir, Files: paths(pkg.Dir, pkg.GoFiles), Imports: slices.Clone(pkg.Imports)}
		}
		b.Units = append(b.Units, u)
	}
	for _, u := range b.Units {
		for _, imp := range u.Imports {
			if _, ok := l.p.DirOf(imp); !ok && l.std.Has(l.p.Target, imp) {
				std[imp] = true
			}
		}
	}
	for imp := range std {
		b.Std = append(b.Std, imp)
	}
	slices.Sort(b.Std)
	return b
}

func paths(dir string, names []string) []string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = path.Join(dir, n)
	}
	return out
}
