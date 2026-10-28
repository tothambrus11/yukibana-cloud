package lsp

import (
	"bytes"
	"errors"
	"go/ast"
	"go/format"
	"go/token"
	"go/types"
	"strings"
)

// signatureHelp shows the signature of the call whose parentheses hold the
// position, with the argument the caret is in.
func (s *Server) signatureHelp(p textDocumentPositionParams) *SignatureHelp {
	a := s.at(p)
	if a == nil || a.pkg == nil {
		return nil
	}
	var call *ast.CallExpr
	for _, n := range a.path {
		if c, ok := n.(*ast.CallExpr); ok && c.Lparen < a.pos && (a.pos <= c.Rparen || !c.Rparen.IsValid() || c.Rparen < c.Lparen) {
			call = c
			break
		}
	}
	if call == nil {
		return nil
	}
	tv, ok := a.pkg.Info.Types[call.Fun]
	if !ok || tv.Type == nil {
		return nil
	}
	sig, ok := tv.Type.Underlying().(*types.Signature)
	if !ok {
		return nil
	}
	q := a.qualifier()
	name := "func"
	switch fun := ast.Unparen(call.Fun).(type) {
	case *ast.Ident:
		name = fun.Name
	case *ast.SelectorExpr:
		name = fun.Sel.Name
	}
	label := name + "("
	params := make([]ParameterInformation, sig.Params().Len())
	for i := range sig.Params().Len() {
		if i > 0 {
			label += ", "
		}
		v := sig.Params().At(i)
		text := types.TypeString(v.Type(), q)
		if sig.Variadic() && i == sig.Params().Len()-1 {
			text = "..." + types.TypeString(v.Type().(*types.Slice).Elem(), q)
		}
		if v.Name() != "" {
			text = v.Name() + " " + text
		}
		params[i] = ParameterInformation{Label: [2]int{utf16Len(label), utf16Len(label + text)}}
		label += text
	}
	label += ")"
	if res := sig.Results(); res.Len() > 0 {
		r := types.TypeString(res, q)
		if res.Len() == 1 && res.At(0).Name() == "" {
			r = strings.TrimSuffix(strings.TrimPrefix(r, "("), ")")
		}
		label += " " + r
	}
	// The argument the caret is in: one more than the arguments that
	// end before it with a comma after them.
	active := 0
	for i, arg := range call.Args {
		end, here := a.file.offset(arg.End()), a.file.offset(a.pos)
		if end <= here && strings.Contains(a.file.text[end:here], ",") {
			active = i + 1
		}
	}
	if sig.Variadic() && active >= len(params) {
		active = len(params) - 1
	}
	return &SignatureHelp{Signatures: []SignatureInformation{{Label: label, Parameters: params}}, ActiveParameter: active}
}

// symbols is the outline of a file: its top-level declarations, with a
// struct's fields and an interface's methods, and each type's methods
// under it.
func (s *Server) symbols(uri string) []DocumentSymbol {
	name, ok := pathOf(uri)
	if !ok {
		return nil
	}
	snap := s.check()
	f := snap.File(name)
	out := []DocumentSymbol{}
	if f == nil || f.ast == nil {
		return out
	}
	byType := map[string]int{}
	var methods []*ast.FuncDecl
	sym := func(name string, kind int, node ast.Node, id *ast.Ident, detail string) DocumentSymbol {
		return DocumentSymbol{Name: name, Kind: kind, Detail: detail, Range: f.rangeOf(node.Pos(), node.End()), SelectionRange: f.rangeOf(id.Pos(), id.End())}
	}
	for _, decl := range f.ast.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if d.Recv != nil {
				methods = append(methods, d)
				continue
			}
			out = append(out, sym(d.Name.Name, symbolFunction, d, d.Name, exprString(d.Type)))
		case *ast.GenDecl:
			for _, spec := range d.Specs {
				switch sp := spec.(type) {
				case *ast.TypeSpec:
					kind, children := symbolClass, []DocumentSymbol(nil)
					switch t := sp.Type.(type) {
					case *ast.StructType:
						kind = symbolStruct
						for _, field := range t.Fields.List {
							for _, n := range fieldNames(field) {
								children = append(children, sym(n.Name, symbolField, field, n, exprString(field.Type)))
							}
						}
					case *ast.InterfaceType:
						kind = symbolInterface
						for _, m := range t.Methods.List {
							for _, n := range m.Names {
								children = append(children, sym(n.Name, symbolMethod, m, n, exprString(m.Type)))
							}
						}
					}
					ds := sym(sp.Name.Name, kind, sp, sp.Name, "")
					ds.Children = children
					byType[sp.Name.Name] = len(out)
					out = append(out, ds)
				case *ast.ValueSpec:
					kind := symbolVariable
					if d.Tok == token.CONST {
						kind = symbolConstant
					}
					for _, n := range sp.Names {
						if n.Name != "_" {
							out = append(out, sym(n.Name, kind, sp, n, exprString(sp.Type)))
						}
					}
				}
			}
		}
	}
	for _, m := range methods {
		ds := sym(m.Name.Name, symbolMethod, m, m.Name, exprString(m.Type))
		recv := receiverName(m)
		if i, ok := byType[recv]; ok {
			out[i].Children = append(out[i].Children, ds)
		} else {
			ds.Name = "(" + recv + ")." + ds.Name
			out = append(out, ds)
		}
	}
	return out
}

// fieldNames are a field's names, or for an embedded field its type's.
func fieldNames(field *ast.Field) []*ast.Ident {
	if len(field.Names) > 0 {
		return field.Names
	}
	t := field.Type
	if star, ok := t.(*ast.StarExpr); ok {
		t = star.X
	}
	switch t := t.(type) {
	case *ast.Ident:
		return []*ast.Ident{t}
	case *ast.SelectorExpr:
		return []*ast.Ident{t.Sel}
	}
	return nil
}

func receiverName(m *ast.FuncDecl) string {
	if len(m.Recv.List) == 0 {
		return ""
	}
	t := m.Recv.List[0].Type
	if star, ok := t.(*ast.StarExpr); ok {
		t = star.X
	}
	switch t := t.(type) {
	case *ast.IndexExpr:
		t2, _ := t.X.(*ast.Ident)
		if t2 != nil {
			return t2.Name
		}
	case *ast.IndexListExpr:
		t2, _ := t.X.(*ast.Ident)
		if t2 != nil {
			return t2.Name
		}
	case *ast.Ident:
		return t.Name
	}
	return ""
}

func exprString(e ast.Expr) string {
	if e == nil {
		return ""
	}
	var b bytes.Buffer
	if err := format.Node(&b, token.NewFileSet(), e); err != nil {
		return ""
	}
	return strings.TrimPrefix(b.String(), "func")
}

// format is gofmt's output for the file, as one edit of the whole text, or
// no edits when it is formatted already.
func (s *Server) format(uri string) ([]TextEdit, error) {
	name, ok := pathOf(uri)
	if !ok {
		return nil, errors.New("not a workspace file")
	}
	text, ok := s.docs[name]
	if !ok || !strings.HasSuffix(name, ".go") {
		return []TextEdit{}, nil
	}
	out, err := format.Source([]byte(text))
	if err != nil {
		return nil, errors.New("cannot format a file with syntax errors: " + err.Error())
	}
	if string(out) == text {
		return []TextEdit{}, nil
	}
	l := newLines(text)
	return []TextEdit{{Range: l.rangeOf(0, len(text)), NewText: string(out)}}, nil
}
