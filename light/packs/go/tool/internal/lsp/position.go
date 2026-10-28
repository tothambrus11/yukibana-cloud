package lsp

import (
	"sort"
	"strings"
)

// URIPrefix is the workspace root's URI (packs/CONTRACT.md, "Files"): a
// document's URI is this followed by its project path.
const URIPrefix = "file:///workspace/"

// pathOf is the project path of a document URI, and whether it is in the
// workspace.
func pathOf(uri string) (string, bool) {
	return strings.CutPrefix(uri, URIPrefix)
}

func uriOf(path string) string { return URIPrefix + path }

// lines indexes a text's line starts, to turn byte offsets into protocol
// positions (UTF-16 columns) and back.
type lines struct {
	text   string
	starts []int
}

func newLines(text string) *lines {
	starts := []int{0}
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			starts = append(starts, i+1)
		}
	}
	return &lines{text: text, starts: starts}
}

// position is the protocol position of a byte offset (clamped to the text).
func (l *lines) position(offset int) Position {
	offset = max(0, min(offset, len(l.text)))
	line := sort.Search(len(l.starts), func(i int) bool { return l.starts[i] > offset }) - 1
	return Position{Line: line, Character: utf16Len(l.text[l.starts[line]:offset])}
}

// offset is the byte offset of a protocol position; a column past the end
// of its line is the line's end, a line past the end is the text's end.
func (l *lines) offset(p Position) int {
	if p.Line < 0 {
		return 0
	}
	if p.Line >= len(l.starts) {
		return len(l.text)
	}
	start := l.starts[p.Line]
	end := len(l.text)
	if p.Line+1 < len(l.starts) {
		end = l.starts[p.Line+1] - 1
	}
	units := 0
	for i, r := range l.text[start:end] {
		if units >= p.Character {
			return start + i
		}
		units += utf16RuneLen(r)
	}
	return end
}

func (l *lines) rangeOf(start, end int) Range {
	return Range{Start: l.position(start), End: l.position(end)}
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16RuneLen(r)
	}
	return n
}

func utf16RuneLen(r rune) int {
	if r >= 0x10000 {
		return 2
	}
	return 1
}
