// Package project is a Go project held in memory, the way the editor and Run
// see it: its files by slash-separated relative path, its module (go.mod),
// its target (go.env), and go/build's reading of each directory for that
// target. The language server and the build planner both start here, so the
// files the editor type-checks are the files Run compiles.
package project

import (
	"bytes"
	"fmt"
	"go/build"
	"io"
	"io/fs"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Target is a GOOS/GOARCH pair the pack builds for.
type Target struct {
	GOOS   string `json:"goos"`
	GOARCH string `json:"goarch"`
}

// String is "goos/goarch", as `go tool dist list` prints it.
func (t Target) String() string { return t.GOOS + "/" + t.GOARCH }

// Targets are the pairs the pack has a standard library for, the default
// first: WebAssembly (WASI), run in the browser's worker, then the three
// Linux architectures the C++ pack's QEMU-Wasm runs.
var Targets = []Target{
	{"wasip1", "wasm"},
	{"linux", "amd64"},
	{"linux", "arm64"},
	{"linux", "riscv64"},
}

// DefaultTarget is the target of a project whose go.env names none.
var DefaultTarget = Targets[0]

// EnvFile is the file a project's target is read from: Go's own go.env
// format (`go env -w` writes the same KEY=value lines), with GOOS and GOARCH.
const EnvFile = "go.env"

// ModFile is the module's go.mod.
const ModFile = "go.mod"

// DefaultModule is the module path of a project with no go.mod.
const DefaultModule = "example"

// Problem is something wrong with the project's own configuration (go.mod,
// go.env), at a 1-based line of that file (0: the file as a whole).
type Problem struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Message string `json:"message"`
}

func (p Problem) Error() string {
	if p.Line > 0 {
		return fmt.Sprintf("%s:%d: %s", p.File, p.Line, p.Message)
	}
	return p.File + ": " + p.Message
}

// Project is one snapshot of the files. It is never changed after New; an
// edit makes a new one.
type Project struct {
	// Files maps a slash-separated relative path ("main.go",
	// "geometry/point.go") to its text.
	Files map[string]string
	// Module is go.mod's module path, or DefaultModule.
	Module string
	// GoVersion is the language version, "1.N": go.mod's `go` line cut to
	// its minor version, or the toolchain's when there is none.
	GoVersion string
	// Target is what go.env names, or DefaultTarget.
	Target Target
	// Problems are what was wrong with go.mod and go.env; each one fell
	// back to its default rather than stop the build.
	Problems []Problem

	dirs map[string][]string // directory -> names of its files, sorted
}

// New reads the configuration out of `files`. `toolchain` is the Go version
// the pack runs ("1.27.3"): a go.mod asking for a newer language is a
// problem, as `go build` refuses it.
func New(files map[string]string, toolchain string) *Project {
	p := &Project{Files: files, Module: DefaultModule, GoVersion: languageOf(toolchain), Target: DefaultTarget, dirs: map[string][]string{}}
	for name := range files {
		dir, file := path.Split(name)
		dir = strings.TrimSuffix(dir, "/")
		p.dirs[dir] = append(p.dirs[dir], file)
	}
	for dir := range p.dirs {
		slices.Sort(p.dirs[dir])
	}
	if text, ok := files[ModFile]; ok {
		p.readMod(text, toolchain)
	}
	if text, ok := files[EnvFile]; ok {
		target, problems := TargetOf(text)
		p.Target = target
		p.Problems = append(p.Problems, problems...)
	}
	return p
}

// languageOf cuts "1.27.3" (or "go1.27rc1") to "1.27".
func languageOf(version string) string {
	version = strings.TrimPrefix(version, "go")
	major, rest, _ := strings.Cut(version, ".")
	minor := strings.TrimLeftFunc(rest, func(r rune) bool { return r < '0' || r > '9' })
	end := strings.IndexFunc(rest, func(r rune) bool { return r < '0' || r > '9' })
	if end >= 0 {
		minor = rest[:end]
	}
	return major + "." + minor
}

// readMod takes the module path and the go version from go.mod. Everything
// else in it (require, replace, toolchain) is not read: there is no module
// proxy here, so an import outside the module and the standard library
// fails at the import, where it can be named.
func (p *Project) readMod(text, toolchain string) {
	sawModule := false
	for i, line := range strings.Split(text, "\n") {
		line, _, _ = strings.Cut(line, "//")
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch fields[0] {
		case "module":
			if len(fields) != 2 {
				p.problem(ModFile, i+1, "usage: module module/path")
				continue
			}
			mod := fields[1]
			if unq, err := strconv.Unquote(mod); err == nil {
				mod = unq
			}
			if mod == "" || strings.ContainsAny(mod, " \\") || strings.HasPrefix(mod, "/") || strings.HasSuffix(mod, "/") {
				p.problem(ModFile, i+1, fmt.Sprintf("invalid module path %q", mod))
				continue
			}
			p.Module, sawModule = mod, true
		case "go":
			if len(fields) != 2 || !validVersion(fields[1]) {
				p.problem(ModFile, i+1, "invalid go version: must match format 1.23.0")
				continue
			}
			want := languageOf(fields[1])
			if compareLanguage(want, languageOf(toolchain)) > 0 {
				p.problem(ModFile, i+1, fmt.Sprintf("go.mod requires go >= %s (running go %s)", fields[1], toolchain))
				continue
			}
			p.GoVersion = want
		}
	}
	if !sawModule {
		p.problem(ModFile, 0, "no module declaration in go.mod")
	}
}

func validVersion(v string) bool {
	parts := strings.Split(v, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return false
	}
	for i, part := range parts {
		// The last part may carry a pre-release ("1.27rc1").
		digits := part
		if i == len(parts)-1 {
			digits = strings.TrimRightFunc(part, func(r rune) bool { return r < '0' || r > '9' })
			if rest := part[len(digits):]; rest != "" && !strings.HasPrefix(rest, "rc") && !strings.HasPrefix(rest, "beta") {
				return false
			}
		}
		if _, err := strconv.Atoi(digits); err != nil {
			return false
		}
	}
	return true
}

// compareLanguage compares "1.N" versions as numbers.
func compareLanguage(a, b string) int {
	minor := func(v string) int {
		_, m, _ := strings.Cut(v, ".")
		n, _ := strconv.Atoi(m)
		return n
	}
	return minor(a) - minor(b)
}

func (p *Project) problem(file string, line int, message string) {
	p.Problems = append(p.Problems, Problem{File: file, Line: line, Message: message})
}

// TargetOf reads GOOS and GOARCH from a go.env's text. Blank lines and lines
// starting with # are skipped and other variables are ignored. One of the
// two alone is enough when it names a single target (GOARCH=arm64 is
// linux/arm64, GOOS=wasip1 is wasip1/wasm). A pair the pack has no standard
// library for is a problem, at the line that names it, and gives
// DefaultTarget.
func TargetOf(text string) (Target, []Problem) {
	var problems []Problem
	values := map[string]string{}
	lines := map[string]int{}
	for i, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			problems = append(problems, Problem{EnvFile, i + 1, fmt.Sprintf("malformed line %q: want KEY=value", line)})
			continue
		}
		key = strings.TrimSpace(key)
		values[key] = strings.TrimSpace(value)
		lines[key] = i + 1
	}
	goos, hasOS := values["GOOS"]
	goarch, hasArch := values["GOARCH"]
	if !hasOS && !hasArch {
		return DefaultTarget, problems
	}
	var matches []Target
	for _, t := range Targets {
		if (!hasOS || t.GOOS == goos) && (!hasArch || t.GOARCH == goarch) {
			matches = append(matches, t)
		}
	}
	if len(matches) == 1 {
		return matches[0], problems
	}
	names := make([]string, len(Targets))
	for i, t := range Targets {
		names[i] = t.String()
	}
	line := lines["GOARCH"]
	message := fmt.Sprintf("unsupported target %s/%s; supported: %s", goos, goarch, strings.Join(names, ", "))
	switch {
	case len(matches) > 1:
		// Only GOOS=linux can match several.
		line = lines["GOOS"]
		archs := make([]string, len(matches))
		for i, t := range matches {
			archs[i] = t.GOARCH
		}
		message = fmt.Sprintf("GOOS=%s needs a GOARCH: one of %s", goos, strings.Join(archs, ", "))
	case !hasArch || hasOS && !slices.ContainsFunc(Targets, func(t Target) bool { return t.GOOS == goos }):
		line = lines["GOOS"]
		if !hasArch {
			message = fmt.Sprintf("unsupported GOOS %s; supported: %s", goos, strings.Join(names, ", "))
		}
	case !hasOS:
		message = fmt.Sprintf("unsupported GOARCH %s; supported: %s", goarch, strings.Join(names, ", "))
	}
	problems = append(problems, Problem{EnvFile, line, message})
	return DefaultTarget, problems
}

// Dirs are the directories that hold .go files, sorted, "" for the root.
// Like the go command, it skips testdata, vendor and directories whose name
// starts with "." or "_".
func (p *Project) Dirs() []string {
	var dirs []string
	for dir, names := range p.dirs {
		if skipped(dir) || !slices.ContainsFunc(names, func(n string) bool { return strings.HasSuffix(n, ".go") }) {
			continue
		}
		dirs = append(dirs, dir)
	}
	slices.Sort(dirs)
	return dirs
}

func skipped(dir string) bool {
	if dir == "" {
		return false
	}
	for _, elem := range strings.Split(dir, "/") {
		if elem == "testdata" || elem == "vendor" || strings.HasPrefix(elem, ".") || strings.HasPrefix(elem, "_") {
			return true
		}
	}
	return false
}

// ImportPath is the import path of the package in `dir`.
func (p *Project) ImportPath(dir string) string {
	if dir == "" {
		return p.Module
	}
	return p.Module + "/" + dir
}

// DirOf is the directory of a package of this module, and whether the
// import path is in the module at all (it may still name no directory).
func (p *Project) DirOf(importPath string) (string, bool) {
	if importPath == p.Module {
		return "", true
	}
	if rest, ok := strings.CutPrefix(importPath, p.Module+"/"); ok {
		return rest, true
	}
	return "", false
}

// Context is go/build's context for the target, over these files: what
// decides which files a package has (build constraints, _test.go, file name
// suffixes such as _linux.go) is go/build's own code.
func (p *Project) Context() *build.Context {
	ctxt := build.Default
	ctxt.GOOS, ctxt.GOARCH = p.Target.GOOS, p.Target.GOARCH
	ctxt.GOROOT, ctxt.GOPATH = "/goroot", ""
	ctxt.CgoEnabled = false
	ctxt.Compiler = "gc"
	// The release tags are the toolchain's (build.Default's); the language
	// version of go.mod is the compiler's -lang, not a build tag.
	ctxt.JoinPath = path.Join
	ctxt.IsAbsPath = path.IsAbs
	ctxt.SplitPathList = func(list string) []string { return strings.Split(list, ":") }
	ctxt.IsDir = func(dir string) bool { _, ok := p.dirs[clean(dir)]; return ok || clean(dir) == "" }
	ctxt.HasSubdir = func(root, dir string) (string, bool) {
		root, dir = clean(root), clean(dir)
		if root == "" {
			return dir, true
		}
		rel, ok := strings.CutPrefix(dir, root+"/")
		return rel, ok
	}
	ctxt.ReadDir = func(dir string) ([]fs.FileInfo, error) {
		names, ok := p.dirs[clean(dir)]
		if !ok {
			return nil, fs.ErrNotExist
		}
		infos := make([]fs.FileInfo, len(names))
		for i, n := range names {
			infos[i] = fileInfo{name: n, size: int64(len(p.Files[path.Join(clean(dir), n)]))}
		}
		return infos, nil
	}
	ctxt.OpenFile = func(name string) (io.ReadCloser, error) {
		text, ok := p.Files[clean(name)]
		if !ok {
			return nil, fs.ErrNotExist
		}
		return io.NopCloser(bytes.NewReader([]byte(text))), nil
	}
	return &ctxt
}

// Root is where go/build sees the project: an absolute path, because it
// resolves a relative directory against a working directory it does not
// have here. The language server's and the compiler's paths are the same.
const Root = "/workspace"

// clean makes a path relative to the project: "/workspace/x" and "x" are
// both "x", and "/workspace" is "".
func clean(name string) string {
	name = path.Clean("/" + name)
	if name == Root {
		return ""
	}
	if rel, ok := strings.CutPrefix(name, Root+"/"); ok {
		return rel
	}
	return strings.TrimPrefix(name, "/")
}

// Package is go/build's reading of `dir` for the target. A directory with
// no buildable files gives *build.NoGoError; one whose files disagree on
// the package name gives *build.MultiplePackageError.
func (p *Project) Package(dir string) (*build.Package, error) {
	pkg, err := p.Context().ImportDir(path.Join(Root, dir), 0)
	if pkg != nil {
		pkg.ImportPath = p.ImportPath(dir)
		pkg.Dir = dir
	}
	return pkg, err
}

type fileInfo struct {
	name string
	size int64
}

func (f fileInfo) Name() string       { return f.name }
func (f fileInfo) Size() int64        { return f.size }
func (f fileInfo) Mode() fs.FileMode  { return 0o444 }
func (f fileInfo) ModTime() time.Time { return time.Time{} }
func (f fileInfo) IsDir() bool        { return false }
func (f fileInfo) Sys() any           { return nil }
