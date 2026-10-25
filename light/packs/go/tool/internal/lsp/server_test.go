package lsp

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
)

// The standard library comes from this machine's go command, as archives
// with export data, the same kind the pack ships; the tests need a Go of
// the version this module asks for.

var stdCache = struct {
	sync.Mutex
	index map[string][]string
	files map[string]map[string]string // target -> import path -> archive file
}{index: map[string][]string{}, files: map[string]map[string]string{}}

func stdOfTarget(t *testing.T, target string) {
	t.Helper()
	stdCache.Lock()
	defer stdCache.Unlock()
	if _, ok := stdCache.files[target]; ok {
		return
	}
	goos, goarch, _ := strings.Cut(target, "/")
	cmd := exec.Command("go", "list", "-export", "-f", "{{.ImportPath}}={{.Export}}", "std")
	cmd.Env = append(os.Environ(), "GOOS="+goos, "GOARCH="+goarch, "CGO_ENABLED=0")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list std for %s: %v", target, err)
	}
	files := map[string]string{}
	var index []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		path, file, _ := strings.Cut(line, "=")
		index = append(index, path)
		files[path] = file
	}
	stdCache.index[target] = index
	stdCache.files[target] = files
}

// session drives a Server as the worker does: messages in, diagnostics out,
// and every package it needs handed over when it asks.
type session struct {
	t           *testing.T
	s           *Server
	nextID      int
	diagnostics map[string][]Diagnostic // by project path, as last published
	published   []string                // paths, in publishing order, since reset
	needs       []Need
}

func newSession(t *testing.T, files map[string]string) *session {
	t.Helper()
	if testing.Short() {
		t.Skip("reads the standard library with the go command")
	}
	for _, target := range []string{"linux/amd64", "wasip1/wasm"} {
		stdOfTarget(t, target)
	}
	ss := &session{t: t, s: NewServer(strings.TrimPrefix(runtime.Version(), "go"), stdCache.index), diagnostics: map[string][]Diagnostic{}}
	ss.request("initialize", map[string]any{"processId": nil, "rootUri": "file:///workspace/"})
	ss.notify("initialized", map[string]any{})
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		ss.notify("textDocument/didOpen", map[string]any{"textDocument": map[string]any{"uri": uriOf(p), "languageId": "go", "version": 1, "text": files[p]}})
	}
	ss.idle()
	return ss
}

func (ss *session) take(out Output) []Message {
	ss.t.Helper()
	var rest []Message
	for _, m := range out.Messages {
		if m.Method == "textDocument/publishDiagnostics" {
			var p struct {
				URI         string       `json:"uri"`
				Diagnostics []Diagnostic `json:"diagnostics"`
			}
			if err := json.Unmarshal(m.Params, &p); err != nil {
				ss.t.Fatal(err)
			}
			name, _ := pathOf(p.URI)
			ss.diagnostics[name] = p.Diagnostics
			ss.published = append(ss.published, name)
			continue
		}
		if m.Method == "window/logMessage" {
			ss.t.Logf("log: %s", m.Params)
			continue
		}
		rest = append(rest, m)
	}
	return rest
}

// idle runs Idle until it needs nothing more, handing over each package it
// asks for.
func (ss *session) idle() {
	ss.t.Helper()
	for range 20 {
		out := ss.s.Idle()
		ss.take(out)
		if out.Need == nil {
			return
		}
		ss.needs = append(ss.needs, *out.Need)
		for _, path := range out.Need.Packages {
			file := stdCache.files[out.Need.Target][path]
			data, err := os.ReadFile(file)
			if err != nil {
				ss.t.Fatalf("%s %s: %v", out.Need.Target, path, err)
			}
			ss.s.AddStd(out.Need.Target, path, data)
		}
	}
	ss.t.Fatal("the server kept asking for packages")
}

func (ss *session) send(method string, params any, id *int) []Message {
	ss.t.Helper()
	msg := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	if id != nil {
		msg["id"] = *id
	}
	raw, _ := json.Marshal(msg)
	return ss.take(ss.s.Handle(raw))
}

func (ss *session) notify(method string, params any) { ss.send(method, params, nil) }

// request returns the result's JSON, failing on an error response.
func (ss *session) request(method string, params any) json.RawMessage {
	ss.t.Helper()
	raw, err := ss.tryRequest(method, params)
	if err != nil {
		ss.t.Fatalf("%s: %v", method, err)
	}
	return raw
}

func (ss *session) tryRequest(method string, params any) (json.RawMessage, error) {
	ss.t.Helper()
	ss.nextID++
	id := ss.nextID
	for _, m := range ss.send(method, params, &id) {
		if m.ID == nil {
			continue
		}
		if m.Error != nil {
			return nil, fmt.Errorf("%s", m.Error.Message)
		}
		raw, _ := json.Marshal(m.Result)
		return raw, nil
	}
	ss.t.Fatalf("%s: no response", method)
	return nil, nil
}

// posOf is the position of the first `marker` in a file's text, plus `skip`
// characters (ASCII text only).
func posOf(text, marker string, skip int) Position {
	i := strings.Index(text, marker)
	if i < 0 {
		panic("no " + marker)
	}
	l := newLines(text)
	return l.position(i + skip)
}

func params(path string, pos Position) map[string]any {
	return map[string]any{"textDocument": map[string]any{"uri": uriOf(path)}, "position": pos}
}

const goMod = "module example.com/geo\n\ngo 1.27\n"
const goEnv = "GOOS=linux\nGOARCH=amd64\n"

var mainGo = `package main

import (
	"fmt"

	"example.com/geo/point"
)

func main() {
	p := point.Point{X: 3, Y: 4}
	fmt.Println(p.Norm(), point.Origin)
}
`

var pointGo = `// Package point is points in the plane.
package point

import "math"

// Point is a point in the plane.
type Point struct {
	X, Y  float64 // the coordinates
	label string
}

// Origin is where the axes cross.
var Origin = Point{}

// Norm is the distance from the origin.
func (p Point) Norm() float64 { return math.Hypot(p.X, p.Y) }

func (p *Point) scale(k float64) { p.X *= k; p.Y *= k }
`

var pointTest = `package point

import "testing"

func TestNorm(t *testing.T) {
	if (Point{X: 3, Y: 4}).Norm() != 5 {
		t.Fatal("norm")
	}
}
`

var externTest = `package point_test

import (
	"testing"

	"example.com/geo/point"
)

func TestOrigin(t *testing.T) {
	if point.Origin.Norm() != 0 {
		t.Fatal("origin")
	}
}
`

func geometry() map[string]string {
	return map[string]string{
		"go.mod": goMod, "go.env": goEnv, "main.go": mainGo,
		"point/point.go": pointGo, "point/point_test.go": pointTest, "point/extern_test.go": externTest,
	}
}

func messages(list []Diagnostic) []string {
	out := make([]string, len(list))
	for i, d := range list {
		out[i] = fmt.Sprintf("%d:%d-%d:%d %s", d.Range.Start.Line+1, d.Range.Start.Character+1, d.Range.End.Line+1, d.Range.End.Character+1, d.Message)
	}
	return out
}

func TestACleanProjectPublishesAnEmptyListForEveryFileOnce(t *testing.T) {
	ss := newSession(t, geometry())
	want := []string{"go.env", "go.mod", "main.go", "point/extern_test.go", "point/point.go", "point/point_test.go"}
	if got := slices.Sorted(slices.Values(ss.published)); !slices.Equal(got, want) {
		t.Errorf("published %q, want %q", got, want)
	}
	for name, list := range ss.diagnostics {
		if len(list) > 0 {
			t.Errorf("%s: %q", name, messages(list))
		}
	}
	if len(ss.needs) == 0 || !slices.Contains(ss.needs[0].Packages, "fmt") || ss.needs[0].Target != "linux/amd64" {
		t.Errorf("first needs %v, want fmt for linux/amd64", ss.needs)
	}
	ss.published = nil
	ss.idle()
	if len(ss.published) != 0 {
		t.Errorf("an unchanged project published again: %q", ss.published)
	}
}

func TestTypeErrorsAreTheCompilersAtTheirNames(t *testing.T) {
	files := geometry()
	files["main.go"] = strings.Replace(mainGo, "fmt.Println(p.Norm(), point.Origin)", "var unused int\n\tfmt.Println(p.Nrom() + \"x\")", 1)
	files["main.go"] = strings.Replace(files["main.go"], "\"fmt\"\n", "\"fmt\"\n\t\"os\"\n", 1)
	ss := newSession(t, files)
	got := messages(ss.diagnostics["main.go"])
	want := []string{
		`5:2-5:6 "os" imported and not used`,
		`12:6-12:12 declared and not used: unused`,
		`13:16-13:20 p.Nrom undefined (type point.Point has no field or method Nrom)`,
	}
	if !slices.Equal(got, want) {
		t.Errorf("got\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestASyntaxErrorHidesThatFilesTypeErrors(t *testing.T) {
	files := geometry()
	files["main.go"] = strings.Replace(mainGo, "func main() {", "func main() {\n\tvar x int =\n", 1)
	ss := newSession(t, files)
	list := ss.diagnostics["main.go"]
	if len(list) == 0 {
		t.Fatal("no diagnostics")
	}
	for _, d := range list {
		if d.Source != "syntax" {
			t.Errorf("a type error beside the syntax errors: %q", messages(list))
		}
	}
}

func TestNothingIsPublishedUntilTheStandardLibraryArrives(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	stdOfTarget(t, "linux/amd64")
	s := NewServer("1.27.3", stdCache.index)
	ss := &session{t: t, s: s, diagnostics: map[string][]Diagnostic{}}
	ss.request("initialize", map[string]any{})
	for name, text := range geometry() {
		ss.notify("textDocument/didOpen", map[string]any{"textDocument": map[string]any{"uri": uriOf(name), "version": 1, "text": text}})
	}
	out := s.Idle()
	if len(out.Messages) != 0 || out.Need == nil {
		t.Fatalf("published %d messages, need %v", len(out.Messages), out.Need)
	}
	if want := []string{"fmt", "math", "testing"}; !slices.Equal(out.Need.Packages, want) {
		t.Errorf("need %q, want %q", out.Need.Packages, want)
	}
}

func TestAFileTheTargetLeavesOutIsSaidToBe(t *testing.T) {
	files := geometry()
	files["sys_wasip1.go"] = "package main\n\nvar onWasm = true\n"
	ss := newSession(t, files)
	got := messages(ss.diagnostics["sys_wasip1.go"])
	if len(got) != 1 || !strings.Contains(got[0], "Not built for linux/amd64") {
		t.Errorf("got %q", got)
	}
	// Switching the target to WebAssembly builds it, and leaves nothing out.
	ss.notify("textDocument/didChange", map[string]any{"textDocument": map[string]any{"uri": uriOf("go.env"), "version": 2}, "contentChanges": []any{map[string]any{"text": "GOOS=wasip1\n"}}})
	ss.idle()
	if got := messages(ss.diagnostics["sys_wasip1.go"]); len(got) != 0 {
		t.Errorf("after the switch: %q", got)
	}
	if last := ss.needs[len(ss.needs)-1]; last.Target != "wasip1/wasm" {
		t.Errorf("the switch asked for %s's packages", last.Target)
	}
}

func TestABadGoEnvIsMarkedAtItsLine(t *testing.T) {
	files := geometry()
	files["go.env"] = "GOOS=linux\nGOARCH=sparc\n"
	ss := newSession(t, files)
	got := messages(ss.diagnostics["go.env"])
	if len(got) != 1 || !strings.HasPrefix(got[0], "2:1-2:13 unsupported target linux/sparc") {
		t.Errorf("got %q", got)
	}
}

func TestHoverShowsTheDeclarationAndItsDocumentation(t *testing.T) {
	ss := newSession(t, geometry())
	var h Hover
	json.Unmarshal(ss.request("textDocument/hover", params("main.go", posOf(mainGo, "Norm()", 1))), &h)
	if !strings.Contains(h.Contents.Value, "func (p point.Point) Norm() float64") || !strings.Contains(h.Contents.Value, "Norm is the distance from the origin.") {
		t.Errorf("hover on a method:\n%s", h.Contents.Value)
	}
	json.Unmarshal(ss.request("textDocument/hover", params("main.go", posOf(mainGo, "Println", 2))), &h)
	if !strings.Contains(h.Contents.Value, "func fmt.Println(a ...any) (n int, err error)") || !strings.Contains(h.Contents.Value, "https://pkg.go.dev/fmt#Println") {
		t.Errorf("hover on fmt.Println:\n%s", h.Contents.Value)
	}
	json.Unmarshal(ss.request("textDocument/hover", params("point/point.go", posOf(pointGo, "X, Y", 0))), &h)
	if !strings.Contains(h.Contents.Value, "field X float64") || !strings.Contains(h.Contents.Value, "the coordinates") {
		t.Errorf("hover on a field:\n%s", h.Contents.Value)
	}
	json.Unmarshal(ss.request("textDocument/hover", params("point/point.go", posOf(pointGo, "type Point", 6))), &h)
	if !strings.Contains(h.Contents.Value, "type Point struct{X float64; Y float64; label string}") || !strings.Contains(h.Contents.Value, "func (*Point) scale(k float64)") {
		t.Errorf("hover on a type:\n%s", h.Contents.Value)
	}
}

func TestDefinitionCrossesPackages(t *testing.T) {
	ss := newSession(t, geometry())
	var locs []Location
	json.Unmarshal(ss.request("textDocument/definition", params("main.go", posOf(mainGo, "Origin", 0))), &locs)
	if len(locs) != 1 || locs[0].URI != uriOf("point/point.go") || locs[0].Range.Start != posOf(pointGo, "Origin =", 0) {
		t.Errorf("definition of point.Origin: %+v", locs)
	}
	json.Unmarshal(ss.request("textDocument/typeDefinition", params("main.go", posOf(mainGo, "p :=", 0))), &locs)
	if len(locs) != 1 || locs[0].Range.Start != posOf(pointGo, "Point struct", 0) {
		t.Errorf("type definition of p: %+v", locs)
	}
	json.Unmarshal(ss.request("textDocument/definition", params("main.go", posOf(mainGo, "Println", 0))), &locs)
	if len(locs) != 0 {
		t.Errorf("the standard library has no definition here: %+v", locs)
	}
}

func TestReferencesIncludeBothTestPackages(t *testing.T) {
	ss := newSession(t, geometry())
	var locs []Location
	json.Unmarshal(ss.request("textDocument/references", map[string]any{
		"textDocument": map[string]any{"uri": uriOf("point/point.go")}, "position": posOf(pointGo, "Norm()", 0),
		"context": map[string]any{"includeDeclaration": true},
	}), &locs)
	var files []string
	for _, l := range locs {
		files = append(files, strings.TrimPrefix(l.URI, URIPrefix))
	}
	if want := []string{"main.go", "point/extern_test.go", "point/point.go", "point/point_test.go"}; !slices.Equal(files, want) {
		t.Errorf("references of Norm in %q, want %q", files, want)
	}
}

func TestRenameChangesEveryUseAndRefusesTheStandardLibrary(t *testing.T) {
	ss := newSession(t, geometry())
	var edit WorkspaceEdit
	json.Unmarshal(ss.request("textDocument/rename", map[string]any{
		"textDocument": map[string]any{"uri": uriOf("main.go")}, "position": posOf(mainGo, "Origin", 0), "newName": "Zero",
	}), &edit)
	if len(edit.Changes[uriOf("main.go")]) != 1 || len(edit.Changes[uriOf("point/point.go")]) != 1 || len(edit.Changes[uriOf("point/extern_test.go")]) != 1 {
		t.Errorf("edits %+v", edit.Changes)
	}
	if _, err := ss.tryRequest("textDocument/rename", map[string]any{
		"textDocument": map[string]any{"uri": uriOf("main.go")}, "position": posOf(mainGo, "Println", 0), "newName": "Say",
	}); err == nil || !strings.Contains(err.Error(), "outside the project") {
		t.Errorf("renaming fmt.Println: %v", err)
	}
	if _, err := ss.tryRequest("textDocument/rename", map[string]any{
		"textDocument": map[string]any{"uri": uriOf("main.go")}, "position": posOf(mainGo, "p :=", 0), "newName": "1p",
	}); err == nil || !strings.Contains(err.Error(), "not a valid Go identifier") {
		t.Errorf("renaming to 1p: %v", err)
	}
}

func completion(t *testing.T, ss *session, file, text string, pos Position) []string {
	t.Helper()
	var list CompletionList
	json.Unmarshal(ss.request("textDocument/completion", params(file, pos)), &list)
	sort.SliceStable(list.Items, func(i, j int) bool { return list.Items[i].SortText < list.Items[j].SortText })
	out := make([]string, len(list.Items))
	for i, it := range list.Items {
		out[i] = it.Label
	}
	return out
}

func edit(ss *session, file, text string) {
	ss.notify("textDocument/didChange", map[string]any{"textDocument": map[string]any{"uri": uriOf(file), "version": 2}, "contentChanges": []any{map[string]any{"text": text}}})
}

func TestCompletionAfterADotOffersMembers(t *testing.T) {
	ss := newSession(t, geometry())
	text := strings.Replace(mainGo, "fmt.Println(p.Norm(), point.Origin)", "fmt.Println(p.)", 1)
	edit(ss, "main.go", text)
	got := completion(t, ss, "main.go", text, posOf(text, "p.)", 2))
	if !slices.Equal(got, []string{"Norm", "X", "Y"}) {
		t.Errorf("p. offers %q, want Norm, X, Y (scale and label are unexported)", got)
	}
	text = strings.Replace(mainGo, "fmt.Println(p.Norm(), point.Origin)", "fmt.Pr", 1)
	edit(ss, "main.go", text)
	got = completion(t, ss, "main.go", text, posOf(text, "fmt.Pr", 6))
	for _, want := range []string{"Println", "Printf", "Sprintf", "Stringer"} {
		if !slices.Contains(got, want) {
			t.Errorf("fmt. lacks %s: %q", want, got)
		}
	}
	if slices.Contains(got, "newPrinter") {
		t.Error("fmt. offers an unexported name")
	}
}

func TestCompletionOffersWhatIsInScopeThere(t *testing.T) {
	ss := newSession(t, geometry())
	text := strings.Replace(mainGo, "\tp := point", "\tvar early int\n\tea\n\tlate := 1\n\t_ = late\n\tp := point", 1)
	edit(ss, "main.go", text)
	got := completion(t, ss, "main.go", text, posOf(text, "\tea\n", 3))
	if i, j := slices.Index(got, "early"), slices.Index(got, "main"); i < 0 || j < 0 || i > j {
		t.Errorf("want the local early before the package-level main: %q", got)
	}
	for _, unwanted := range []string{"late", "p"} {
		if slices.Contains(got, unwanted) {
			t.Errorf("offers %s, declared later", unwanted)
		}
	}
	for _, want := range []string{"fmt", "point", "len", "string", "for", "return"} {
		if !slices.Contains(got, want) {
			t.Errorf("lacks %s", want)
		}
	}
}

func TestCompletionInAnImportOffersPackages(t *testing.T) {
	ss := newSession(t, geometry())
	text := strings.Replace(mainGo, "\"fmt\"\n", "\"fmt\"\n\t\"str\"\n", 1)
	edit(ss, "main.go", text)
	got := completion(t, ss, "main.go", text, posOf(text, "\"str\"", 4))
	if got[0] != "example.com/geo" || !slices.Contains(got, "example.com/geo/point") || !slices.Contains(got, "strings") || !slices.Contains(got, "strconv") {
		t.Errorf("import completion %q", got[:min(10, len(got))])
	}
	if slices.ContainsFunc(got, func(s string) bool { return strings.Contains(s, "internal") }) {
		t.Error("offers an internal package")
	}
}

func TestSignatureHelpFollowsTheArguments(t *testing.T) {
	files := geometry()
	files["main.go"] = strings.Replace(mainGo, "fmt.Println(p.Norm(), point.Origin)", "fmt.Printf(\"%v\", 1, )", 1)
	ss := newSession(t, files)
	text := files["main.go"]
	var help SignatureHelp
	json.Unmarshal(ss.request("textDocument/signatureHelp", params("main.go", posOf(text, "Printf(", 7))), &help)
	if len(help.Signatures) != 1 || help.Signatures[0].Label != "Printf(format string, a ...any) (n int, err error)" || help.ActiveParameter != 0 {
		t.Errorf("at the format: %+v", help)
	}
	json.Unmarshal(ss.request("textDocument/signatureHelp", params("main.go", posOf(text, ", )", 2))), &help)
	if help.ActiveParameter != 1 {
		t.Errorf("after the second comma the variadic parameter stays active: %+v", help)
	}
}

func TestFormattingIsGofmt(t *testing.T) {
	files := geometry()
	files["main.go"] = "package main\nfunc main(){\nprintln( 1)}\n"
	ss := newSession(t, files)
	var edits []TextEdit
	json.Unmarshal(ss.request("textDocument/formatting", map[string]any{"textDocument": map[string]any{"uri": uriOf("main.go")}}), &edits)
	if len(edits) != 1 || edits[0].NewText != "package main\n\nfunc main() {\n\tprintln(1)\n}\n" {
		t.Errorf("edits %+v", edits)
	}
	json.Unmarshal(ss.request("textDocument/formatting", map[string]any{"textDocument": map[string]any{"uri": uriOf("point/point.go")}}), &edits)
	if len(edits) != 0 {
		t.Errorf("a formatted file got edits %+v", edits)
	}
}

func TestTheOutlineNestsFieldsAndMethodsUnderTheirType(t *testing.T) {
	ss := newSession(t, geometry())
	var syms []DocumentSymbol
	json.Unmarshal(ss.request("textDocument/documentSymbol", map[string]any{"textDocument": map[string]any{"uri": uriOf("point/point.go")}}), &syms)
	var got []string
	for _, s := range syms {
		got = append(got, s.Name)
		for _, c := range s.Children {
			got = append(got, s.Name+"."+c.Name)
		}
	}
	if want := []string{"Point", "Point.X", "Point.Y", "Point.label", "Point.Norm", "Point.scale", "Origin"}; !slices.Equal(got, want) {
		t.Errorf("outline %q, want %q", got, want)
	}
}

func TestIncrementalEditsApplyInOrder(t *testing.T) {
	ss := newSession(t, geometry())
	start := posOf(mainGo, "3, Y", 0)
	ss.notify("textDocument/didChange", map[string]any{
		"textDocument": map[string]any{"uri": uriOf("main.go"), "version": 2},
		"contentChanges": []any{
			map[string]any{"range": Range{Start: start, End: Position{start.Line, start.Character + 1}}, "text": "\"three\""},
		},
	})
	ss.idle()
	got := messages(ss.diagnostics["main.go"])
	if len(got) != 1 || !strings.Contains(got[0], `cannot use "three" (untyped string constant) as float64 value in struct literal`) {
		t.Errorf("got %q", got)
	}
}
