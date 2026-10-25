// Command gotool is the Go pack's tool as a wasip1 reactor: the language
// server (internal/lsp) for the editor's worker and the build planner
// (internal/plan) for the runner's, one module for both so the browser
// downloads it once. ../src/tool.js is its only caller.
//
// The calling convention: the worker asks for a buffer (yk_alloc), copies
// a call's bytes into it, and calls an export with (pointer, length) pairs;
// the export's answer is JSON, read with yk_output_ptr and yk_output_len
// until the next call. A panic is caught and answered as {"panic": text},
// so a bug fails one call, not the instance.
package main

import (
	"encoding/json"
	"fmt"
	"slices"
	"unsafe"

	"yukibana.dev/light/packs/go/tool/internal/lsp"
	"yukibana.dev/light/packs/go/tool/internal/plan"
	"yukibana.dev/light/packs/go/tool/internal/project"
)

// The buffers handed out since the last call: kept reachable (Go's
// collector does not move objects) until the call that reads them is over.
var inputs [][]byte

var output []byte

var (
	toolchain string
	library   project.Library
	server    *lsp.Server
)

func main() {}

//go:wasmexport yk_alloc
func ykAlloc(size uint32) uint32 {
	buf := make([]byte, max(size, 1))
	inputs = append(inputs, buf)
	return uint32(uintptr(unsafe.Pointer(&buf[0])))
}

//go:wasmexport yk_output_ptr
func ykOutputPtr() uint32 {
	if len(output) == 0 {
		return 0
	}
	return uint32(uintptr(unsafe.Pointer(&output[0])))
}

//go:wasmexport yk_output_len
func ykOutputLen() uint32 { return uint32(len(output)) }

// bytesAt is the input buffer at ptr, cut to n bytes.
func bytesAt(ptr, n uint32) []byte {
	if n == 0 {
		return nil
	}
	for _, buf := range inputs {
		if uint32(uintptr(unsafe.Pointer(&buf[0]))) == ptr {
			return buf[:n]
		}
	}
	panic(fmt.Sprintf("no buffer at %#x", ptr))
}

// answer runs f, sets the output to its JSON (or the panic's) and frees the
// call's inputs.
func answer(f func() any) {
	defer func() {
		inputs = inputs[:0]
		if r := recover(); r != nil {
			output, _ = json.Marshal(map[string]string{"panic": fmt.Sprint(r)})
		}
	}()
	out, err := json.Marshal(f())
	if err != nil {
		panic(err)
	}
	output = out
}

// yk_init takes {"toolchain": "1.27.3", "std": {"linux/amd64": {"packages":
// [...], "unshipped": [...]}}}: the Go version and what the pack ships of
// every target's standard library (project.LibraryIndex, from the pack's
// std/index.json). It must come first, once.
//
//go:wasmexport yk_init
func ykInit(ptr, n uint32) {
	answer(func() any {
		var in struct {
			Toolchain string               `json:"toolchain"`
			Std       project.LibraryIndex `json:"std"`
		}
		if err := json.Unmarshal(bytesAt(ptr, n), &in); err != nil {
			panic(err)
		}
		toolchain, library = in.Toolchain, project.NewLibrary(in.Std)
		server = lsp.NewServer(toolchain, library)
		return map[string]bool{"ok": true}
	})
}

// yk_message hands the language server one JSON-RPC message.
//
//go:wasmexport yk_message
func ykMessage(ptr, n uint32) {
	answer(func() any { return server.Handle(bytesAt(ptr, n)) })
}

// yk_idle asks the language server for diagnostics.
//
//go:wasmexport yk_idle
func ykIdle() {
	answer(func() any { return server.Idle() })
}

// yk_std hands the language server a standard library archive: target
// ("linux/arm64"), import path, bytes.
//
//go:wasmexport yk_std
func ykStd(targetPtr, targetLen, pathPtr, pathLen, dataPtr, dataLen uint32) {
	answer(func() any {
		server.AddStd(string(bytesAt(targetPtr, targetLen)), string(bytesAt(pathPtr, pathLen)), slices.Clone(bytesAt(dataPtr, dataLen)))
		return map[string]bool{"ok": true}
	})
}

// yk_plan plans a run or a test: {"files": {path: text}, "entry":
// "main.go", "test": false}. The answer is the plan with the project's
// target and language version, which the compiler is given.
//
//go:wasmexport yk_plan
func ykPlan(ptr, n uint32) {
	answer(func() any {
		var in struct {
			Files map[string]string `json:"files"`
			Entry string            `json:"entry"`
			Test  bool              `json:"test"`
		}
		if err := json.Unmarshal(bytesAt(ptr, n), &in); err != nil {
			panic(err)
		}
		p := project.New(in.Files, toolchain)
		var pl plan.Plan
		if in.Test {
			pl = plan.Test(p, library)
		} else {
			pl = plan.Run(p, in.Entry, library)
		}
		return struct {
			plan.Plan
			Target    project.Target    `json:"target"`
			GoVersion string            `json:"goVersion"`
			Problems  []project.Problem `json:"problems,omitempty"`
		}{pl, p.Target, p.GoVersion, p.Problems}
	})
}
