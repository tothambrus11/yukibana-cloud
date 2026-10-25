package plan

import (
	"slices"
	"strings"
	"testing"

	"yukibana.dev/light/packs/go/tool/internal/project"
)

// std is a standard library with what the cases import, for the default
// target, which leaves net/http out.
var std = libraryOf(project.DefaultTarget, []string{"embed", "fmt", "math", "os", "reflect", "strings", "testing", "testing/internal/testdeps"}, []string{"net/http"})

func libraryOf(target project.Target, packages, unshipped []string) project.Library {
	return project.NewLibrary(project.LibraryIndex{target.String(): {Packages: packages, Unshipped: unshipped}})
}

func newProject(files map[string]string) *project.Project {
	if _, ok := files["go.mod"]; !ok {
		files["go.mod"] = "module m\n\ngo 1.27\n"
	}
	return project.New(files, "1.27.3")
}

func importPaths(units []Unit) []string {
	out := make([]string, len(units))
	for i, u := range units {
		out[i] = u.ImportPath
	}
	return out
}

func TestRunCompilesTheLocalPackagesBeforeTheMainPackage(t *testing.T) {
	p := newProject(map[string]string{
		"main.go":               "package main\n\nimport (\n\t\"fmt\"\n\t\"m/geo\"\n)\n\nfunc main() { fmt.Println(geo.Norm(3, 4)) }\n",
		"geo/geo.go":            "package geo\n\nimport \"m/geo/internal/sq\"\n\nfunc Norm(x, y float64) float64 { return sq.Root(x*x + y*y) }\n",
		"geo/geo_test.go":       "package geo\n\nimport \"testing\"\n\nfunc TestNorm(t *testing.T) {}\n",
		"geo/internal/sq/sq.go": "package sq\n\nimport \"math\"\n\nfunc Root(x float64) float64 { return math.Sqrt(x) }\n",
	})
	plan := Run(p, "main.go", std)
	if len(plan.Errors) > 0 {
		t.Fatal(plan.Errors)
	}
	b := plan.Builds[0]
	if got, want := importPaths(b.Units), []string{"m/geo/internal/sq", "m/geo", "main"}; !slices.Equal(got, want) {
		t.Errorf("units %q, want %q", got, want)
	}
	if !slices.Equal(b.Std, []string{"fmt", "math"}) {
		t.Errorf("std %q", b.Std)
	}
	if got := b.Units[1].Files; !slices.Equal(got, []string{"geo/geo.go"}) {
		t.Errorf("a run leaves the test files out: %q", got)
	}
	if b.Package != "m" {
		t.Errorf("package %q", b.Package)
	}
}

func TestRunRefusesWhatGoRunRefuses(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		entry string
		want  string
	}{
		{"an entry that is not package main", map[string]string{"lib.go": "package lib\n"}, "lib.go", "lib.go:1: package m is not a main package"},
		{"an import of a directory the project lacks", map[string]string{"main.go": "package main\n\nimport \"m/nope\"\n\nfunc main() {}\n"}, "main.go",
			"main.go:3:8: package m/nope is not in the project: no Go files in ./nope"},
		{"an import that is not in the standard library", map[string]string{"main.go": "package main\n\nimport \"fmtx\"\n\nfunc main() {}\n"}, "main.go",
			"main.go:3:8: package fmtx is not in std"},
		{"an import from another module", map[string]string{"main.go": "package main\n\nimport \"github.com/x/y\"\n\nfunc main() {}\n"}, "main.go",
			"main.go:3:8: no required module provides package github.com/x/y"},
		{"an unshipped package of the standard library", map[string]string{"main.go": "package main\n\nimport \"net/http\"\n\nfunc main() {}\n"}, "main.go",
			"main.go:3:8: package net/http is in the standard library but not in the browser's copy of it"},
		{"cgo", map[string]string{"main.go": "package main\n\nimport \"C\"\n\nfunc main() {}\n"}, "main.go", "main.go:3:8: cgo"},
		{"two packages in one directory", map[string]string{"main.go": "package main\n", "other.go": "package other\n"}, "main.go",
			"found packages main (main.go) and other (other.go) in ."},
		{"an import cycle", map[string]string{
			"main.go": "package main\n\nimport _ \"m/a\"\n\nfunc main() {}\n",
			"a/a.go":  "package a\n\nimport _ \"m/b\"\n",
			"b/b.go":  "package b\n\nimport _ \"m/a\"\n",
		}, "main.go", "import cycle not allowed: m/a -> m/b -> m/a"},
		{"importing a program", map[string]string{
			"main.go":     "package main\n\nimport _ \"m/cmd\"\n\nfunc main() {}\n",
			"cmd/main.go": "package main\n\nfunc main() {}\n",
		}, "main.go", "main.go:3:8: import \"m/cmd\" is a program, not an importable package"},
		{"embedding", map[string]string{"main.go": "package main\n\nimport _ \"embed\"\n\n//go:embed x.txt\nvar s string\n\nfunc main() {}\n"}, "main.go",
			"main.go:5:12: //go:embed is not supported here"},
		{"a go.mod newer than the toolchain", map[string]string{"go.mod": "module m\ngo 1.30\n", "main.go": "package main\n\nfunc main() {}\n"}, "main.go",
			"go.mod:2: go.mod requires go >= 1.30"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			plan := Run(newProject(c.files), c.entry, std)
			if len(plan.Builds) > 0 || len(plan.Errors) == 0 {
				t.Fatalf("planned %v", plan)
			}
			var got []string
			for _, e := range plan.Errors {
				got = append(got, e.String())
			}
			if !slices.ContainsFunc(got, func(s string) bool { return strings.Contains(s, c.want) }) {
				t.Errorf("errors %q, want one containing %q", got, c.want)
			}
		})
	}
}

func TestTestBuildsEveryPackageWithTestsAndSaysWhichHaveNone(t *testing.T) {
	p := newProject(map[string]string{
		"main.go":            "package main\n\nimport \"m/geo\"\n\nfunc main() { _ = geo.Norm }\n",
		"geo/geo.go":         "package geo\n\nfunc Norm(x, y float64) float64 { return x + y }\n",
		"geo/geo_test.go":    "package geo\n\nimport \"testing\"\n\nfunc TestNorm(t *testing.T) {}\nfunc Testify(t *testing.T) {}\nfunc BenchmarkNorm(b *testing.B) {}\n",
		"geo/extern_test.go": "package geo_test\n\nimport (\n\t\"fmt\"\n\t\"m/geo\"\n\t\"m/show\"\n)\n\nfunc ExampleNorm() {\n\tfmt.Println(geo.Norm(1, 2), show.S)\n\t// Output: 3 x\n}\n\nfunc ExampleNoOutput() {}\n",
		"show/show.go":       "package show\n\nimport _ \"m/geo\"\n\nconst S = \"x\"\n",
	})
	plan := Test(p, std)
	if len(plan.Errors) > 0 {
		t.Fatal(plan.Errors)
	}
	if !slices.Equal(plan.NoTests, []string{"m", "m/show"}) {
		t.Errorf("no tests in %q", plan.NoTests)
	}
	if len(plan.Builds) != 1 {
		t.Fatalf("%d builds", len(plan.Builds))
	}
	b := plan.Builds[0]
	// show imports geo, so it comes after geo's test variant, which it is
	// compiled against, and before the external tests that import it.
	if got, want := importPaths(b.Units), []string{"m/geo", "m/show", "m/geo_test", "main"}; !slices.Equal(got, want) {
		t.Fatalf("units %q, want %q", got, want)
	}
	if got := b.Units[0].Files; !slices.Equal(got, []string{"geo/geo.go", "geo/geo_test.go"}) {
		t.Errorf("the package under test has its test files: %q", got)
	}
	main := b.Units[3].Generated[TestMainFile]
	for _, want := range []string{
		`_test "m/geo"`, `_xtest "m/geo_test"`,
		`{"TestNorm", _test.TestNorm}`, `{"BenchmarkNorm", _test.BenchmarkNorm}`,
		`{"ExampleNorm", _xtest.ExampleNorm, "3 x\n", false}`,
		`testdeps.ImportPath = "m/geo"`,
		`os.Exit(m.Run())`,
	} {
		if !strings.Contains(main, want) {
			t.Errorf("test main lacks %s:\n%s", want, main)
		}
	}
	for _, unwanted := range []string{"Testify", "ExampleNoOutput"} {
		if strings.Contains(main, unwanted) {
			t.Errorf("test main runs %s", unwanted)
		}
	}
	if !slices.Contains(b.Std, "testing/internal/testdeps") || !slices.Contains(b.Std, "fmt") {
		t.Errorf("std %q", b.Std)
	}
}

func TestTestMainIsCalledInsteadOfRun(t *testing.T) {
	p := newProject(map[string]string{
		"main.go":      "package main\n\nfunc main() {}\n",
		"main_test.go": "package main\n\nimport (\n\t\"os\"\n\t\"testing\"\n)\n\nfunc TestMain(m *testing.M) { os.Exit(m.Run()) }\nfunc TestX(t *testing.T) {}\n",
	})
	plan := Test(p, std)
	if len(plan.Errors) > 0 {
		t.Fatal(plan.Errors)
	}
	units := plan.Builds[0].Units
	if got := importPaths(units); !slices.Equal(got, []string{"m", "main"}) {
		t.Fatalf("a main package under test is compiled as m: %q", got)
	}
	main := units[1].Generated[TestMainFile]
	if !strings.Contains(main, "_test.TestMain(m)") || !strings.Contains(main, `"reflect"`) {
		t.Errorf("test main:\n%s", main)
	}
}

func TestTestReportsAWrongSignatureWhereGoTestDoes(t *testing.T) {
	cases := []struct{ name, src, want string }{
		{"a test without *testing.T", "func TestX() {}", "x_test.go:3:1: wrong signature for TestX, must be: func TestX(t *testing.T)"},
		{"a benchmark taking T", "func BenchmarkX(t *testing.T) {}", "wrong signature for BenchmarkX, must be: func BenchmarkX(b *testing.B)"},
		{"a generic test", "func TestX[T any](t *testing.T) {}", "test functions cannot have type parameters"},
		{"TestMain twice", "func TestMain(m *testing.M) {}\nfunc TestMain(m *testing.M) {}", "multiple definitions of TestMain"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := newProject(map[string]string{
				"x.go":      "package x\n",
				"x_test.go": "package x\n\n" + c.src + "\n\nvar _ testing.T\n",
			})
			plan := Test(p, std)
			if len(plan.Errors) == 0 || !strings.Contains(plan.Errors[0].String(), c.want) {
				t.Errorf("errors %v, want %q", plan.Errors, c.want)
			}
		})
	}
}
