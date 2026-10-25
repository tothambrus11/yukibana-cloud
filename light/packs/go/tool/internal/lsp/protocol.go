package lsp

import "encoding/json"

// The parts of the Language Server Protocol this server speaks, with the
// protocol's own names. Positions are 0-based lines and UTF-16 columns, as
// the protocol's default position encoding says.

// Message is any JSON-RPC message, in either direction.
type Message struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method,omitempty"`
	Params  json.RawMessage  `json:"params,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *ResponseError   `json:"error,omitempty"`
}

// ResponseError is a request's failure.
type ResponseError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// JSON-RPC and LSP error codes.
const (
	codeMethodNotFound       = -32601
	codeInvalidParams        = -32602
	codeInternalError        = -32603
	codeServerNotInitialized = -32002
	codeRequestFailed        = -32803
)

// Position is a place in a document.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// Range is a span of a document, end exclusive.
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Location is a range of a document named by URI.
type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

// TextEdit replaces a range with new text.
type TextEdit struct {
	Range   Range  `json:"range"`
	NewText string `json:"newText"`
}

// Diagnostic severities.
const (
	SeverityError       = 1
	SeverityWarning     = 2
	SeverityInformation = 3
)

// Diagnostic is one problem in a document.
type Diagnostic struct {
	Range    Range  `json:"range"`
	Severity int    `json:"severity"`
	Source   string `json:"source"`
	Message  string `json:"message"`
	// Code is go/types' error code ("UnusedImport") when there is one.
	Code string `json:"code,omitempty"`
}

type textDocumentIdentifier struct {
	URI string `json:"uri"`
}

type textDocumentPositionParams struct {
	TextDocument textDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

type didOpenParams struct {
	TextDocument struct {
		URI     string `json:"uri"`
		Version int    `json:"version"`
		Text    string `json:"text"`
	} `json:"textDocument"`
}

type didChangeParams struct {
	TextDocument struct {
		URI     string `json:"uri"`
		Version int    `json:"version"`
	} `json:"textDocument"`
	ContentChanges []struct {
		Range *Range `json:"range"`
		Text  string `json:"text"`
	} `json:"contentChanges"`
}

type didCloseParams struct {
	TextDocument textDocumentIdentifier `json:"textDocument"`
}

type referenceParams struct {
	textDocumentPositionParams
	Context struct {
		IncludeDeclaration bool `json:"includeDeclaration"`
	} `json:"context"`
}

type renameParams struct {
	textDocumentPositionParams
	NewName string `json:"newName"`
}

// MarkupContent is hover text, in Markdown.
type MarkupContent struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// Hover is what hovering shows.
type Hover struct {
	Contents MarkupContent `json:"contents"`
	Range    *Range        `json:"range,omitempty"`
}

// Completion item kinds, as the protocol numbers them.
const (
	kindText      = 1
	kindMethod    = 2
	kindFunction  = 3
	kindField     = 5
	kindVariable  = 6
	kindInterface = 8
	kindModule    = 9
	kindKeyword   = 14
	kindConstant  = 21
	kindStruct    = 22
	kindClass     = 7
	kindTypeParam = 25
)

// CompletionItem is one suggestion.
type CompletionItem struct {
	Label    string    `json:"label"`
	Kind     int       `json:"kind"`
	Detail   string    `json:"detail,omitempty"`
	SortText string    `json:"sortText,omitempty"`
	TextEdit *TextEdit `json:"textEdit,omitempty"`
}

// CompletionList is the answer to a completion request.
type CompletionList struct {
	IsIncomplete bool             `json:"isIncomplete"`
	Items        []CompletionItem `json:"items"`
}

// SignatureHelp is the call's signature and which parameter the caret is at.
type SignatureHelp struct {
	Signatures      []SignatureInformation `json:"signatures"`
	ActiveSignature int                    `json:"activeSignature"`
	ActiveParameter int                    `json:"activeParameter"`
}

// SignatureInformation is one signature, its parameters as label offsets.
type SignatureInformation struct {
	Label      string                 `json:"label"`
	Parameters []ParameterInformation `json:"parameters"`
}

// ParameterInformation is a parameter's [start, end) in the label, in
// UTF-16 code units.
type ParameterInformation struct {
	Label [2]int `json:"label"`
}

// DocumentHighlight is one occurrence of a name.
type DocumentHighlight struct {
	Range Range `json:"range"`
	Kind  int   `json:"kind"` // 1 text, 2 read, 3 write
}

// DocumentSymbol is an outline entry.
type DocumentSymbol struct {
	Name           string           `json:"name"`
	Detail         string           `json:"detail,omitempty"`
	Kind           int              `json:"kind"`
	Range          Range            `json:"range"`
	SelectionRange Range            `json:"selectionRange"`
	Children       []DocumentSymbol `json:"children,omitempty"`
}

// Symbol kinds, as the protocol numbers them.
const (
	symbolField     = 8
	symbolMethod    = 6
	symbolFunction  = 12
	symbolVariable  = 13
	symbolConstant  = 14
	symbolInterface = 11
	symbolStruct    = 23
	symbolClass     = 5
)

// WorkspaceEdit is edits to several documents.
type WorkspaceEdit struct {
	Changes map[string][]TextEdit `json:"changes"`
}
