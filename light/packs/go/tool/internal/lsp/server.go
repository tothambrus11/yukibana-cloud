// Package lsp is the Go pack's language server: go/parser and go/types over
// the project's files, the standard library read from the same archives the
// compiler links (export data), for the target the project's go.env names.
// It is not gopls, which needs the go command and a file system; it is the
// type checker gopls is built on, with the protocol around it written here.
//
// The server is a library: the worker hands it one message at a time
// (Handle) and, once the editor has been quiet, asks for diagnostics
// (Idle). Both return the messages to send, and the standard library
// packages the type checker asked for that have not been handed over yet
// (Need), which the worker downloads and gives it (AddStd) before asking
// again. Nothing here blocks or starts a goroutine.
package lsp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/importer"
	"go/token"
	"go/types"
	"io"
	"slices"
	"sort"
	"strings"

	"yukibana.dev/light/packs/go/tool/internal/project"
)

// Need is the standard library packages the server is waiting for, of one
// target ("linux/arm64"), sorted.
type Need struct {
	Target   string   `json:"target"`
	Packages []string `json:"packages"`
}

// Output is what one call returns to the worker.
type Output struct {
	Messages []Message `json:"messages"`
	Need     *Need     `json:"need,omitempty"`
}

// Server is one session's state.
type Server struct {
	toolchain string
	// index lists each target's standard library packages ("linux/amd64"
	// to import paths); data holds the archives that have arrived, by
	// target and import path.
	index map[string]map[string]bool
	data  map[string]map[string][]byte

	docs        map[string]string // project path -> text
	initialized bool
	shutdown    bool

	snapshot  *Snapshot // nil when an edit has made it stale
	published map[string]string

	// The standard library's importer, kept between snapshots (reading
	// export data is the slow part of a check) and replaced when the
	// target changes. Its objects' positions are in its own file set.
	stdTarget   project.Target
	stdImporter types.ImporterFrom
	missing     map[string]bool
}

// NewServer starts a session for the Go toolchain `toolchain` ("1.27.3")
// whose standard library has, per target, the packages in `index`.
func NewServer(toolchain string, index map[string][]string) *Server {
	s := &Server{
		toolchain: toolchain, index: map[string]map[string]bool{}, data: map[string]map[string][]byte{},
		docs: map[string]string{}, published: map[string]string{}, missing: map[string]bool{},
	}
	for target, pkgs := range index {
		set := map[string]bool{}
		for _, p := range pkgs {
			set[p] = true
		}
		s.index[target] = set
	}
	return s
}

// AddStd hands over a standard library package's archive. The next check
// sees it; the snapshot is stale from now on.
func (s *Server) AddStd(target, importPath string, data []byte) {
	if s.data[target] == nil {
		s.data[target] = map[string][]byte{}
	}
	s.data[target][importPath] = data
	s.snapshot = nil
}

// stdOf is the Std of one target, over what has arrived.
type stdOf struct {
	s      *Server
	target string
}

func (st stdOf) Has(path string) bool    { return st.s.index[st.target][path] }
func (st stdOf) Data(path string) []byte { return st.s.data[st.target][path] }

func (s *Server) project() *project.Project {
	return project.New(s.docs, s.toolchain)
}

// check is the current snapshot, checking the project if it is stale.
func (s *Server) check() *Snapshot {
	if s.snapshot != nil {
		return s.snapshot
	}
	p := s.project()
	if s.stdImporter == nil || p.Target != s.stdTarget {
		s.stdTarget = p.Target
		std := stdOf{s, p.Target.String()}
		s.stdImporter = importer.ForCompiler(token.NewFileSet(), "gc", func(path string) (io.ReadCloser, error) {
			data := std.Data(path)
			if data == nil {
				s.missing[path] = true
				return nil, fmt.Errorf("package %s has not been downloaded yet", path)
			}
			delete(s.missing, path)
			return io.NopCloser(bytes.NewReader(data)), nil
		}).(types.ImporterFrom)
	}
	// What this check asks for and lacks; an import deleted since the
	// last check is no longer waited for.
	clear(s.missing)
	s.snapshot = check(p, stdOf{s, p.Target.String()}, s.stdImporter, func() []string {
		var out []string
		for path := range s.missing {
			out = append(out, path)
		}
		slices.Sort(out)
		return out
	})
	return s.snapshot
}

func (s *Server) need(snap *Snapshot) *Need {
	if len(snap.Missing) == 0 {
		return nil
	}
	return &Need{Target: snap.Project.Target.String(), Packages: snap.Missing}
}

// Handle answers one message from the client.
func (s *Server) Handle(raw []byte) (out Output) {
	var msg Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		return Output{Messages: []Message{s.log(1, "unreadable message: "+err.Error())}}
	}
	reply := func(result any, err *ResponseError) {
		if msg.ID == nil {
			return
		}
		if err != nil {
			out.Messages = append(out.Messages, Message{JSONRPC: "2.0", ID: msg.ID, Error: err})
			return
		}
		if result == nil {
			result = json.RawMessage("null")
		}
		out.Messages = append(out.Messages, Message{JSONRPC: "2.0", ID: msg.ID, Result: result})
	}
	defer func() {
		// A bug here fails the request, not the session.
		if r := recover(); r != nil {
			out = Output{Messages: []Message{s.log(1, fmt.Sprintf("%s failed: %v", msg.Method, r))}}
			reply(nil, &ResponseError{Code: codeInternalError, Message: fmt.Sprint(r)})
		}
	}()
	if msg.Method == "" {
		return out // a response to something we never send
	}
	if !s.initialized && msg.Method != "initialize" {
		if msg.ID != nil {
			reply(nil, &ResponseError{Code: codeServerNotInitialized, Message: "not initialized"})
		}
		return out
	}
	switch msg.Method {
	case "initialize":
		s.initialized = true
		reply(s.capabilities(), nil)
	case "initialized", "$/setTrace", "$/cancelRequest", "workspace/didChangeConfiguration", "workspace/didChangeWatchedFiles", "textDocument/didSave":
	case "shutdown":
		s.shutdown = true
		reply(nil, nil)
	case "exit":
	case "textDocument/didOpen":
		var p didOpenParams
		if s.decode(msg, &p, reply) {
			if name, ok := pathOf(p.TextDocument.URI); ok {
				s.docs[name] = p.TextDocument.Text
				s.snapshot = nil
			}
		}
	case "textDocument/didChange":
		var p didChangeParams
		if s.decode(msg, &p, reply) {
			if name, ok := pathOf(p.TextDocument.URI); ok {
				text := s.docs[name]
				for _, c := range p.ContentChanges {
					text = applyChange(text, c.Range, c.Text)
				}
				s.docs[name] = text
				s.snapshot = nil
			}
		}
	case "textDocument/didClose":
		var p didCloseParams
		if s.decode(msg, &p, reply) {
			if name, ok := pathOf(p.TextDocument.URI); ok {
				// The app closes a document when the file is deleted.
				delete(s.docs, name)
				s.snapshot = nil
				if _, had := s.published[name]; had {
					delete(s.published, name)
					out.Messages = append(out.Messages, publish(name, []Diagnostic{}))
				}
			}
		}
	case "textDocument/hover":
		var p textDocumentPositionParams
		if s.decode(msg, &p, reply) {
			reply(s.hover(p), nil)
		}
	case "textDocument/definition", "textDocument/typeDefinition":
		var p textDocumentPositionParams
		if s.decode(msg, &p, reply) {
			reply(s.definition(p, msg.Method == "textDocument/typeDefinition"), nil)
		}
	case "textDocument/references":
		var p referenceParams
		if s.decode(msg, &p, reply) {
			reply(s.references(p.textDocumentPositionParams, p.Context.IncludeDeclaration), nil)
		}
	case "textDocument/documentHighlight":
		var p textDocumentPositionParams
		if s.decode(msg, &p, reply) {
			reply(s.highlights(p), nil)
		}
	case "textDocument/rename":
		var p renameParams
		if s.decode(msg, &p, reply) {
			edit, err := s.rename(p)
			if err != nil {
				reply(nil, &ResponseError{Code: codeRequestFailed, Message: err.Error()})
			} else {
				reply(edit, nil)
			}
		}
	case "textDocument/completion":
		var p textDocumentPositionParams
		if s.decode(msg, &p, reply) {
			reply(s.complete(p), nil)
		}
	case "textDocument/signatureHelp":
		var p textDocumentPositionParams
		if s.decode(msg, &p, reply) {
			reply(s.signatureHelp(p), nil)
		}
	case "textDocument/documentSymbol":
		var p struct {
			TextDocument textDocumentIdentifier `json:"textDocument"`
		}
		if s.decode(msg, &p, reply) {
			reply(s.symbols(p.TextDocument.URI), nil)
		}
	case "textDocument/formatting":
		var p struct {
			TextDocument textDocumentIdentifier `json:"textDocument"`
		}
		if s.decode(msg, &p, reply) {
			edits, err := s.format(p.TextDocument.URI)
			if err != nil {
				reply(nil, &ResponseError{Code: codeRequestFailed, Message: err.Error()})
			} else {
				reply(edits, nil)
			}
		}
	default:
		if msg.ID != nil {
			reply(nil, &ResponseError{Code: codeMethodNotFound, Message: "unsupported method " + msg.Method})
		}
	}
	if s.snapshot != nil {
		out.Need = s.need(s.snapshot)
	}
	return out
}

func (s *Server) decode(msg Message, into any, reply func(any, *ResponseError)) bool {
	if err := json.Unmarshal(msg.Params, into); err != nil {
		reply(nil, &ResponseError{Code: codeInvalidParams, Message: err.Error()})
		return false
	}
	return true
}

func (s *Server) log(level int, text string) Message {
	params, _ := json.Marshal(map[string]any{"type": level, "message": text})
	return Message{JSONRPC: "2.0", Method: "window/logMessage", Params: params}
}

func (s *Server) capabilities() any {
	return map[string]any{
		"capabilities": map[string]any{
			"positionEncoding":           "utf-16",
			"textDocumentSync":           map[string]any{"openClose": true, "change": 2},
			"hoverProvider":              true,
			"definitionProvider":         true,
			"typeDefinitionProvider":     true,
			"referencesProvider":         true,
			"documentHighlightProvider":  true,
			"documentSymbolProvider":     true,
			"renameProvider":             true,
			"documentFormattingProvider": true,
			"completionProvider":         map[string]any{"triggerCharacters": []string{".", "\""}},
			"signatureHelpProvider":      map[string]any{"triggerCharacters": []string{"(", ","}},
		},
		"serverInfo": map[string]any{"name": "go/types (Yukibana)", "version": "go" + s.toolchain},
	}
}

// applyChange applies one content change: the whole text without a range.
func applyChange(text string, r *Range, change string) string {
	if r == nil {
		return change
	}
	l := newLines(text)
	start, end := l.offset(r.Start), l.offset(r.End)
	if end < start {
		start, end = end, start
	}
	return text[:start] + change + text[end:]
}

// Idle computes the diagnostics of every document whose list changed since
// it was last published (every document, the first time), unless the
// check is still waiting for standard library packages: then it publishes
// nothing, rather than errors about imports that are on their way, and
// says what it needs.
func (s *Server) Idle() (out Output) {
	defer func() {
		if r := recover(); r != nil {
			out = Output{Messages: []Message{s.log(1, fmt.Sprintf("checking failed: %v", r))}}
		}
	}()
	if !s.initialized || s.shutdown {
		return out
	}
	snap := s.check()
	if need := s.need(snap); need != nil {
		return Output{Need: need}
	}
	all := diagnose(snap)
	names := make([]string, 0, len(s.docs))
	for name := range s.docs {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !strings.HasSuffix(name, ".go") && name != project.ModFile && name != project.EnvFile {
			continue
		}
		list := all[name]
		if list == nil {
			list = []Diagnostic{}
		}
		key, _ := json.Marshal(list)
		if prev, ok := s.published[name]; ok && prev == string(key) {
			continue
		}
		s.published[name] = string(key)
		out.Messages = append(out.Messages, publish(name, list))
	}
	return out
}

func publish(name string, list []Diagnostic) Message {
	params, _ := json.Marshal(map[string]any{"uri": uriOf(name), "diagnostics": list})
	return Message{JSONRPC: "2.0", Method: "textDocument/publishDiagnostics", Params: params}
}
