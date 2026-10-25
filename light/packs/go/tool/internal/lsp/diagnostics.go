package lsp

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// diagnose is every file's diagnostics, by project path: the syntax errors
// the parser found, the type checker's errors from the package that owns
// the file, what go/build says about the directory, a note on a file the
// target leaves out, and the problems of go.mod and go.env. The compiler
// reports the same errors with the same words (it is go/types too), so
// what Run prints and what the editor marks agree.
func diagnose(snap *Snapshot) map[string][]Diagnostic {
	out := map[string][]Diagnostic{}
	add := func(name string, d Diagnostic) { out[name] = append(out[name], d) }
	for name, f := range snap.files {
		for _, e := range f.errors {
			add(name, Diagnostic{Range: f.wordRange(e.Pos.Offset), Severity: SeverityError, Source: "syntax", Message: e.Msg})
		}
		if snap.Excluded[name] {
			add(name, Diagnostic{Range: f.lines.rangeOf(0, 0), Severity: SeverityInformation, Source: "go/build",
				Message: fmt.Sprintf("Not built for %s: build constraints exclude this file, so it is not type-checked. The target is set in go.env.", snap.Project.Target)})
		}
		if msg, ok := snap.DirErrors[name]; ok {
			add(name, Diagnostic{Range: f.lines.rangeOf(0, 0), Severity: SeverityError, Source: "go/build", Message: msg})
		}
	}
	reported := map[*Package]bool{}
	for name := range snap.files {
		pkg := snap.Owner(name)
		if pkg == nil || reported[pkg] {
			continue
		}
		reported[pkg] = true
		for _, e := range pkg.Errors {
			pos := snap.Fset.Position(e.Pos)
			f := snap.File(pos.Filename)
			if f == nil || len(f.errors) > 0 {
				// A file with syntax errors gets those alone: the type
				// errors of a half-parsed file are mostly echoes of them.
				continue
			}
			add(pos.Filename, Diagnostic{Range: f.wordRange(pos.Offset), Severity: SeverityError, Source: "compiler", Message: e.Msg})
		}
	}
	for _, problem := range snap.Project.Problems {
		text := snap.Project.Files[problem.File]
		l := newLines(text)
		line := max(problem.Line-1, 0)
		start := l.offset(Position{Line: line})
		end := l.offset(Position{Line: line, Character: 1 << 30})
		add(problem.File, Diagnostic{Range: l.rangeOf(start, end), Severity: SeverityError, Source: "go", Message: problem.Message})
	}
	for name := range out {
		sort.SliceStable(out[name], func(i, j int) bool {
			a, b := out[name][i].Range.Start, out[name][j].Range.Start
			return a.Line < b.Line || a.Line == b.Line && a.Character < b.Character
		})
	}
	return out
}

// wordRange is a range for an error at a byte offset: the identifier,
// number or string literal that starts there, or the one character, so the
// editor has something to underline (go/types and the parser give a start
// only).
func (f *file) wordRange(offset int) Range {
	offset = max(0, min(offset, len(f.text)))
	if offset < len(f.text) && (f.text[offset] == '"' || f.text[offset] == '`') {
		if end := strings.IndexByte(f.text[offset+1:], f.text[offset]); end >= 0 && !strings.Contains(f.text[offset:offset+1+end], "\n") {
			return f.lines.rangeOf(offset, offset+end+2)
		}
	}
	end := offset
	for end < len(f.text) {
		r, size := utf8.DecodeRuneInString(f.text[end:])
		if !(r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)) {
			break
		}
		end += size
	}
	if end == offset && end < len(f.text) && f.text[end] != '\n' {
		_, size := utf8.DecodeRuneInString(f.text[end:])
		end += size
	}
	return f.lines.rangeOf(offset, end)
}
