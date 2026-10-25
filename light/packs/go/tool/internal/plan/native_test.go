package plan

import (
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"yukibana.dev/light/packs/go/tool/internal/project"
)

// These tests build plans with this machine's go tool compile and go tool
// link, exactly as the runner drives compile.wasm and link.wasm, and run
// what comes out: a plan that the real compiler or linker refuses fails
// here, not in the browser.

// buildNative compiles and links b in dir and returns the program's path.
func buildNative(t *testing.T, p *project.Project, b Build, dir string) string {
	t.Helper()
	std := append(slices.Clone(b.Std), "runtime")
	out, err := exec.Command("go", append([]string{"list", "-export", "-f", "{{if .Export}}packagefile {{.ImportPath}}={{.Export}}{{end}}", "-deps"}, std...)...).Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	cfg := string(out)
	for i, u := range b.Units {
		archive := filepath.Join(dir, fmt.Sprintf("%d.a", i))
		var files []string
		for _, f := range u.Files {
			name := filepath.Join(dir, "src", fmt.Sprint(i), f)
			text, ok := u.Generated[f]
			if !ok {
				text = p.Files[f]
			}
			if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(name, []byte(text), 0o644); err != nil {
				t.Fatal(err)
			}
			files = append(files, name)
		}
		if err := os.WriteFile(filepath.Join(dir, "importcfg"), []byte(cfg), 0o644); err != nil {
			t.Fatal(err)
		}
		args := append([]string{"tool", "compile", "-p", u.ImportPath, "-lang=go" + p.GoVersion, "-complete", "-importcfg", filepath.Join(dir, "importcfg"), "-pack", "-o", archive}, files...)
		if msg, err := exec.Command("go", args...).CombinedOutput(); err != nil {
			t.Fatalf("compile %s: %v\n%s", u.ImportPath, err, msg)
		}
		cfg += fmt.Sprintf("packagefile %s=%s\n", u.ImportPath, archive)
	}
	if err := os.WriteFile(filepath.Join(dir, "importcfg"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	prog := filepath.Join(dir, "prog")
	if msg, err := exec.Command("go", "tool", "link", "-importcfg", filepath.Join(dir, "importcfg"), "-buildmode=exe", "-o", prog, filepath.Join(dir, fmt.Sprintf("%d.a", len(b.Units)-1))).CombinedOutput(); err != nil {
		t.Fatalf("link: %v\n%s", err, msg)
	}
	return prog
}

func hostProject(t *testing.T, files map[string]string) *project.Project {
	if testing.Short() {
		t.Skip("builds with the go command")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("no go command")
	}
	files["go.mod"] = "module example.com/geo\n\ngo 1.27\n"
	files[project.EnvFile] = fmt.Sprintf("GOOS=%s\nGOARCH=%s\n", runtime.GOOS, runtime.GOARCH)
	p := project.New(files, strings.TrimPrefix(runtime.Version(), "go"))
	if p.Target.GOOS != runtime.GOOS || p.Target.GOARCH != runtime.GOARCH {
		t.Skipf("the pack has no target for this machine (%s/%s)", runtime.GOOS, runtime.GOARCH)
	}
	return p
}

// hostLibrary is the whole standard library of this machine's target.
func hostLibrary(t *testing.T) project.Library {
	out, err := exec.Command("go", "list", "std").Output()
	if err != nil {
		t.Fatal(err)
	}
	target := project.Target{GOOS: runtime.GOOS, GOARCH: runtime.GOARCH}
	return project.NewLibrary(project.LibraryIndex{target.String(): {Packages: strings.Fields(string(out))}})
}

var geometry = map[string]string{
	"main.go":              "package main\n\nimport (\n\t\"fmt\"\n\n\t\"example.com/geo/point\"\n)\n\nfunc main() {\n\tfmt.Println(point.Point{X: 3, Y: 4}.Norm())\n}\n",
	"point/point.go":       "package point\n\nimport \"math\"\n\n// Point is a point in the plane.\ntype Point struct{ X, Y float64 }\n\n// Norm is the distance from the origin.\nfunc (p Point) Norm() float64 { return math.Hypot(p.X, p.Y) }\n\nfunc half(x float64) float64 { return x / 2 }\n",
	"point/point_test.go":  "package point\n\nimport \"testing\"\n\nfunc TestHalf(t *testing.T) {\n\tif half(5) != 2.5 {\n\t\tt.Fatal(\"half\")\n\t}\n}\n",
	"point/extern_test.go": "package point_test\n\nimport (\n\t\"fmt\"\n\t\"testing\"\n\n\t\"example.com/geo/point\"\n)\n\nfunc TestNorm(t *testing.T) {\n\tif got := (point.Point{X: 3, Y: 4}).Norm(); got != 5 {\n\t\tt.Errorf(\"Norm = %v\", got)\n\t}\n}\n\nfunc ExamplePoint_Norm() {\n\tfmt.Println(point.Point{X: 6, Y: 8}.Norm())\n\t// Output: 10\n}\n",
}

func TestAPlannedRunBuildsWithTheRealCompilerAndLinker(t *testing.T) {
	p := hostProject(t, maps.Clone(geometry))
	plan := Run(p, "main.go", hostLibrary(t))
	if len(plan.Errors) > 0 {
		t.Fatal(plan.Errors)
	}
	out, err := exec.Command(buildNative(t, p, plan.Builds[0], t.TempDir())).CombinedOutput()
	if err != nil || string(out) != "5\n" {
		t.Errorf("program: %v, %q", err, out)
	}
}

func TestAPlannedTestRunsTheTestsAndExamplesOfBothTestPackages(t *testing.T) {
	p := hostProject(t, maps.Clone(geometry))
	plan := Test(p, hostLibrary(t))
	if len(plan.Errors) > 0 || len(plan.Builds) != 1 {
		t.Fatal(plan)
	}
	out, err := exec.Command(buildNative(t, p, plan.Builds[0], t.TempDir()), "-test.v").CombinedOutput()
	for _, want := range []string{"--- PASS: TestHalf", "--- PASS: TestNorm", "--- PASS: ExamplePoint_Norm", "\nPASS\n"} {
		if !strings.Contains(string(out), want) {
			t.Errorf("output lacks %q: %v\n%s", want, err, out)
		}
	}
}

func TestAFailingTestFailsItsBinary(t *testing.T) {
	files := maps.Clone(geometry)
	files["point/point_test.go"] = strings.Replace(files["point/point_test.go"], "2.5", "3", 1)
	p := hostProject(t, files)
	plan := Test(p, hostLibrary(t))
	out, err := exec.Command(buildNative(t, p, plan.Builds[0], t.TempDir())).CombinedOutput()
	if err == nil || !strings.Contains(string(out), "--- FAIL: TestHalf") || !strings.Contains(string(out), "point_test.go:7: half") {
		t.Errorf("want TestHalf to fail at point_test.go:7: %v\n%s", err, out)
	}
}
