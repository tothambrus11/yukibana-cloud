package plan

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/build"
	"go/doc"
	"go/parser"
	"go/token"
	"path"
	"slices"
	"strings"
	"text/template"
	"unicode"
	"unicode/utf8"
)

// TestMainFile is the generated test main's file name, outside the project
// (an underscore keeps it from ever being a project file go/build reads).
const TestMainFile = "_testmain.go"

// testBuild is the test binary of pkg, as `go test` builds it: pkg compiled
// with its _test.go files of the same package, the external test package
// (package pkg_test) if there is one, and a generated main that runs them.
func (l *loader) testBuild(pkg *build.Package) (Build, bool) {
	errorsBefore := len(l.errors)
	funcs := testFuncs{ImportPath: pkg.ImportPath, ModulePath: l.p.Module}
	for _, name := range pkg.TestGoFiles {
		l.loadTests(&funcs, path.Join(pkg.Dir, name), "_test", &funcs.ImportTest, &funcs.NeedTest)
	}
	for _, name := range pkg.XTestGoFiles {
		l.loadTests(&funcs, path.Join(pkg.Dir, name), "_xtest", &funcs.ImportXtest, &funcs.NeedXtest)
	}

	// pkg as its tests see it, under its own import path, so that the
	// external tests and every package they import get this variant.
	tested := Unit{
		ImportPath: pkg.ImportPath, Dir: pkg.Dir,
		Files: paths(pkg.Dir, slices.Concat(pkg.GoFiles, pkg.TestGoFiles)),
	}
	tested.Imports, _ = mergeImports(pkg.Imports, nil, pkg.TestImports, nil)
	replace := map[string]Unit{pkg.ImportPath: tested}
	roots := []*build.Package{pkg}
	if len(pkg.XTestGoFiles) > 0 {
		xtest := &build.Package{
			Dir: pkg.Dir, Name: pkg.Name + "_test", ImportPath: pkg.ImportPath + "_test",
			GoFiles: pkg.XTestGoFiles, Imports: pkg.XTestImports, ImportPos: pkg.XTestImportPos,
		}
		roots = append(roots, xtest)
	}
	order := l.order(roots, map[*build.Package]bool{pkg: true})

	main := Unit{ImportPath: "main", Dir: pkg.Dir, Files: []string{TestMainFile}}
	main.Imports = []string{"os", "testing", "testing/internal/testdeps"}
	if funcs.TestMain != nil {
		main.Imports = append(main.Imports, "reflect")
	}
	if funcs.ImportTest {
		main.Imports = append(main.Imports, pkg.ImportPath)
	}
	if funcs.ImportXtest {
		main.Imports = append(main.Imports, pkg.ImportPath+"_test")
	}
	slices.Sort(main.Imports)
	if len(l.errors) > errorsBefore {
		return Build{}, false
	}
	var text bytes.Buffer
	if err := testmainTemplate.Execute(&text, &funcs); err != nil {
		// The template and its data are both this package's.
		panic(err)
	}
	main.Generated = map[string]string{TestMainFile: text.String()}

	b := l.build(pkg.ImportPath, order, replace)
	b.Units = append(b.Units, main)
	for _, imp := range main.Imports {
		if _, ok := l.p.DirOf(imp); !ok && !slices.Contains(b.Std, imp) {
			b.Std = append(b.Std, imp)
		}
	}
	slices.Sort(b.Std)
	return b, len(l.errors) == errorsBefore
}

// testFuncs is what the test main runs: the template's data, with the
// go command's field names (cmd/go/internal/load/test.go).
type testFuncs struct {
	Tests       []testFunc
	Benchmarks  []testFunc
	FuzzTargets []testFunc
	Examples    []testFunc
	TestMain    *testFunc
	ImportPath  string
	ModulePath  string
	ImportTest  bool
	NeedTest    bool
	ImportXtest bool
	NeedXtest   bool
}

// Package is pkg as the test main imports it, for the template.
func (t *testFuncs) Package() *testFuncs { return t }

type testFunc struct {
	Package   string // "_test" or "_xtest"
	Name      string
	Output    string
	Unordered bool
}

// loadTests finds the tests, benchmarks, fuzz targets, examples and
// TestMain of one test file, with the go command's rules for each, and
// reports a wrong signature where the go command does.
func (l *loader) loadTests(t *testFuncs, file, pkg string, doImport, seen *bool) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, file, l.p.Files[file], parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		// The compiler reports it, with every other error of the file.
		*doImport = true
		return
	}
	for _, d := range f.Decls {
		n, ok := d.(*ast.FuncDecl)
		if !ok || n.Recv != nil {
			continue
		}
		name := n.Name.String()
		switch {
		case name == "TestMain":
			if isTestFunc(n, "T") {
				t.Tests = append(t.Tests, testFunc{pkg, name, "", false})
				*doImport, *seen = true, true
				continue
			}
			if !l.checkTestFunc(fset, n, "M") {
				continue
			}
			if t.TestMain != nil {
				l.fail(l.at(fset, n.Pos(), "multiple definitions of TestMain"))
				continue
			}
			t.TestMain = &testFunc{pkg, name, "", false}
			*doImport, *seen = true, true
		case isTest(name, "Test"):
			if l.checkTestFunc(fset, n, "T") {
				t.Tests = append(t.Tests, testFunc{pkg, name, "", false})
				*doImport, *seen = true, true
			}
		case isTest(name, "Benchmark"):
			if l.checkTestFunc(fset, n, "B") {
				t.Benchmarks = append(t.Benchmarks, testFunc{pkg, name, "", false})
				*doImport, *seen = true, true
			}
		case isTest(name, "Fuzz"):
			if l.checkTestFunc(fset, n, "F") {
				t.FuzzTargets = append(t.FuzzTargets, testFunc{pkg, name, "", false})
				*doImport, *seen = true, true
			}
		}
	}
	examples := doc.Examples(f)
	slices.SortFunc(examples, func(a, b *doc.Example) int { return a.Order - b.Order })
	for _, e := range examples {
		*doImport = true // the file is imported whether its examples run or not
		if e.Output == "" && !e.EmptyOutput {
			continue // an example without an output comment is compiled, not run
		}
		t.Examples = append(t.Examples, testFunc{pkg, "Example" + e.Name, e.Output, e.Unordered})
		*seen = true
	}
}

func (l *loader) at(fset *token.FileSet, pos token.Pos, message string) Error {
	p := fset.Position(pos)
	return Error{File: p.Filename, Line: p.Line, Column: p.Column, Message: message}
}

func (l *loader) checkTestFunc(fset *token.FileSet, fn *ast.FuncDecl, arg string) bool {
	var why string
	if !isTestFunc(fn, arg) {
		why = fmt.Sprintf("must be: func %s(%s *testing.%s)", fn.Name.String(), strings.ToLower(arg), arg)
	}
	if fn.Type.TypeParams.NumFields() > 0 {
		why = "test functions cannot have type parameters"
	}
	if why != "" {
		l.fail(l.at(fset, fn.Pos(), fmt.Sprintf("wrong signature for %s, %s", fn.Name.String(), why)))
		return false
	}
	return true
}

// isTestFunc reports whether fn is func(*X.arg) or func(*arg) with no
// results, as the go command checks it: how `testing` was imported is not
// known here, so any package name is accepted.
func isTestFunc(fn *ast.FuncDecl, arg string) bool {
	if fn.Type.Results != nil && len(fn.Type.Results.List) > 0 ||
		fn.Type.Params.List == nil ||
		len(fn.Type.Params.List) != 1 ||
		len(fn.Type.Params.List[0].Names) > 1 {
		return false
	}
	ptr, ok := fn.Type.Params.List[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	if name, ok := ptr.X.(*ast.Ident); ok && name.Name == arg {
		return true
	}
	if sel, ok := ptr.X.(*ast.SelectorExpr); ok && sel.Sel.Name == arg {
		return true
	}
	return false
}

// isTest reports whether name is prefix ("Test") alone or followed by
// something that is not a lower-case letter ("TestX", not "Testify").
func isTest(name, prefix string) bool {
	if !strings.HasPrefix(name, prefix) {
		return false
	}
	if len(name) == len(prefix) {
		return true
	}
	r, _ := utf8.DecodeRuneInString(name[len(prefix):])
	return !unicode.IsLower(r)
}

// testmainTemplate is the go command's (Go 1.27, cmd/go/internal/load/
// test.go, BSD licence) without coverage, which this pack does not offer.
var testmainTemplate = template.Must(template.New("main").Parse(`
// Code generated by 'go test'. DO NOT EDIT.

package main

import (
	"os"
{{if .TestMain}}
	"reflect"
{{end}}
	"testing"
	"testing/internal/testdeps"

{{if .ImportTest}}
	{{if .NeedTest}}_test{{else}}_{{end}} {{.Package.ImportPath | printf "%q"}}
{{end}}
{{if .ImportXtest}}
	{{if .NeedXtest}}_xtest{{else}}_{{end}} {{.Package.ImportPath | printf "%s_test" | printf "%q"}}
{{end}}
)

var tests = []testing.InternalTest{
{{range .Tests}}
	{"{{.Name}}", {{.Package}}.{{.Name}}},
{{end}}
}

var benchmarks = []testing.InternalBenchmark{
{{range .Benchmarks}}
	{"{{.Name}}", {{.Package}}.{{.Name}}},
{{end}}
}

var fuzzTargets = []testing.InternalFuzzTarget{
{{range .FuzzTargets}}
	{"{{.Name}}", {{.Package}}.{{.Name}}},
{{end}}
}

var examples = []testing.InternalExample{
{{range .Examples}}
	{"{{.Name}}", {{.Package}}.{{.Name}}, {{.Output | printf "%q"}}, {{.Unordered}}},
{{end}}
}

func init() {
	testdeps.ModulePath = {{.ModulePath | printf "%q"}}
	testdeps.ImportPath = {{.ImportPath | printf "%q"}}
}

func main() {
	m := testing.MainStart(testdeps.TestDeps{}, tests, benchmarks, fuzzTargets, examples)
{{with .TestMain}}
	{{.Package}}.{{.Name}}(m)
	os.Exit(int(reflect.ValueOf(m).Elem().FieldByName("exitCode").Int()))
{{else}}
	os.Exit(m.Run())
{{end}}
}

`))
