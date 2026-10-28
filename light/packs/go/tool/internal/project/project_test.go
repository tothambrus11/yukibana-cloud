package project

import (
	"slices"
	"strings"
	"testing"
)

func TestTheTargetIsWhatGoEnvSays(t *testing.T) {
	cases := []struct {
		name, env string
		want      Target
		problem   string // a substring of the one problem, "" for none
		line      int
	}{
		{"an empty go.env is the default target", "", DefaultTarget, "", 0},
		{"comments and blank lines are skipped", "# the target\n\nGOOS=linux\nGOARCH=arm64\n", Target{"linux", "arm64"}, "", 0},
		{"spaces around the = are allowed", "GOOS = linux\nGOARCH = riscv64", Target{"linux", "riscv64"}, "", 0},
		{"GOARCH alone names its one target", "GOARCH=amd64", Target{"linux", "amd64"}, "", 0},
		{"GOOS=wasip1 alone is WebAssembly", "GOOS=wasip1", Target{"wasip1", "wasm"}, "", 0},
		{"other variables are ignored", "CGO_ENABLED=0\nGOOS=linux\nGOARCH=amd64", Target{"linux", "amd64"}, "", 0},
		{"GOOS=linux alone asks for an architecture", "GOOS=linux", DefaultTarget, "GOOS=linux needs a GOARCH: one of amd64, arm64, riscv64", 1},
		{"an unknown architecture is named at its line", "GOOS=linux\nGOARCH=mips", DefaultTarget, "unsupported target linux/mips", 2},
		{"an unknown system is named at its line", "GOOS=windows\nGOARCH=amd64", DefaultTarget, "unsupported target windows/amd64", 1},
		{"a line without = is malformed", "linux", DefaultTarget, "malformed line", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, problems := TargetOf(c.env)
			if got != c.want {
				t.Errorf("target = %v, want %v", got, c.want)
			}
			switch {
			case c.problem == "" && len(problems) > 0:
				t.Errorf("unexpected problems %v", problems)
			case c.problem != "" && (len(problems) != 1 || !strings.Contains(problems[0].Message, c.problem) || problems[0].Line != c.line):
				t.Errorf("problems = %v, want one at line %d containing %q", problems, c.line, c.problem)
			}
		})
	}
}

func TestGoModGivesTheModulePathAndLanguageVersion(t *testing.T) {
	cases := []struct {
		name, mod    string
		module, lang string
		problem      string
	}{
		{"a module and a go line", "module example.com/geo\n\ngo 1.24\n", "example.com/geo", "1.24", ""},
		{"a patch version is cut to the language", "module m\ngo 1.25.3", "m", "1.25", ""},
		{"comments are not part of a line", "module m // the module\ngo 1.26 // old", "m", "1.26", ""},
		{"a quoted module path", "module \"m/x\"\ngo 1.27", "m/x", "1.27", ""},
		{"no go line is the toolchain's language", "module m\n", "m", "1.27", ""},
		{"a newer go than the toolchain is refused", "module m\ngo 1.28", "m", "1.27", "go.mod requires go >= 1.28 (running go 1.27.3)"},
		{"a malformed go version is named", "module m\ngo one", "m", "1.27", "invalid go version"},
		{"no module line falls back to example", "go 1.27", DefaultModule, "1.27", "no module declaration"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := New(map[string]string{ModFile: c.mod}, "1.27.3")
			if p.Module != c.module || p.GoVersion != c.lang {
				t.Errorf("module %q, go %q; want %q, %q", p.Module, p.GoVersion, c.module, c.lang)
			}
			if (c.problem == "") != (len(p.Problems) == 0) || c.problem != "" && !strings.Contains(p.Problems[0].Message, c.problem) {
				t.Errorf("problems = %v, want %q", p.Problems, c.problem)
			}
		})
	}
}

func TestPackagesAreTheDirectoriesWithGoFiles(t *testing.T) {
	p := New(map[string]string{
		"go.mod":                 "module m\n",
		"main.go":                "package main\n",
		"geo/point.go":           "package geo\n",
		"geo/testdata/x.go":      "package x\n",
		"_old/old.go":            "package old\n",
		".hidden/h.go":           "package h\n",
		"docs/README.md":         "#",
		"geo/internal/calc/c.go": "package calc\n",
	}, "1.27.3")
	want := []string{"", "geo", "geo/internal/calc"}
	if got := p.Dirs(); !slices.Equal(got, want) {
		t.Errorf("Dirs() = %q, want %q", got, want)
	}
	if got := p.ImportPath("geo"); got != "m/geo" {
		t.Errorf("ImportPath(geo) = %q", got)
	}
	if dir, ok := p.DirOf("m/geo/internal/calc"); !ok || dir != "geo/internal/calc" {
		t.Errorf("DirOf = %q, %v", dir, ok)
	}
	if _, ok := p.DirOf("fmt"); ok {
		t.Error("fmt is not in the module")
	}
	if _, ok := p.DirOf("mx"); ok {
		t.Error("mx is not m's package even though it starts with m")
	}
}

func TestBuildConstraintsAndFileSuffixesFollowTheTarget(t *testing.T) {
	files := map[string]string{
		"main.go":          "package main\n",
		"sys_linux.go":     "package main\n",
		"sys_wasip1.go":    "package main\n",
		"arch_arm64.go":    "package main\n",
		"tagged.go":        "//go:build linux && riscv64\n\npackage main\n",
		"ignored.go":       "//go:build ignore\n\npackage main\n",
		"main_test.go":     "package main\n",
		"external_test.go": "package main_test\n",
	}
	cases := []struct {
		env  string
		want []string
	}{
		{"", []string{"main.go", "sys_wasip1.go"}},
		{"GOARCH=arm64", []string{"arch_arm64.go", "main.go", "sys_linux.go"}},
		{"GOARCH=riscv64", []string{"main.go", "sys_linux.go", "tagged.go"}},
	}
	for _, c := range cases {
		files[EnvFile] = c.env
		pkg, err := New(files, "1.27.3").Package("")
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(pkg.GoFiles, c.want) {
			t.Errorf("go.env %q: GoFiles = %q, want %q", c.env, pkg.GoFiles, c.want)
		}
		if !slices.Equal(pkg.TestGoFiles, []string{"main_test.go"}) || !slices.Equal(pkg.XTestGoFiles, []string{"external_test.go"}) {
			t.Errorf("go.env %q: tests %q, %q", c.env, pkg.TestGoFiles, pkg.XTestGoFiles)
		}
	}
}
