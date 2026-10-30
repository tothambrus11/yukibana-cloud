# Patches to Rust 1.98.1's source tarball

`../build.sh` applies them in name order.

## 00xx: homescoop's WASI-hosted rustc

Copied (unchanged but for 0007, see below) from [homescoop](https://github.com/ai-ecoverse/homescoop)
at commit `15880c4c69796878f507e0028d507d657f92b82d` (2026-10-28),
`packages/wasi-rustc/patches/`. Copyright 2026 ai-ecoverse, licensed under the
Apache License 2.0 (`LICENSE-homescoop.txt`); the files they patch are Rust's
and LLVM's, under their own licences.

| patch | what it does |
|---|---|
| 0003 | std's paths on a WASI host: `getcwd`, `chdir`, `temp_dir`, `split_paths` |
| 0004 | lld's ELF and wasm linkers in rustc (`RustRunLld`), called instead of spawning `rust-lld`; rustc_driver as an rlib too |
| 0005 | bootstrap builds LLVM for wasm32-wasip1-threads |
| 0006 | the sysroot from `RUSTC_SYSROOT` (WASI has no path of the running program) |
| 0007 | LLVM's endianness headers on WASI (without its hunk for orc-rt, which Rust's source tarball does not have) |
| 0008 | bootstrap configures LLVM as a Unix for WASI |
| 0009 | LLVM's support library without signals, processes and dynamic libraries |
| 0010 | no `dlopen` (codegen backends, Enzyme) |
| 0011 | an output file is writeable without permission bits |
| 0013 | the working directory from `PWD` |
| 0014 | no permission bits on WASI's files |
| 0015 | a fatal error exits instead of unwinding |
| 0016–0019 | LTO is refused early and cleanly (it needs a linker plugin this rustc has not) |

Left out: 0012, procedural macros through WASIX's process spawning; the
browser has no processes.

## 01xx: LLVM's WebAssembly debug-info fixes from LLVM 23.1.1

LLVM's WebAssembly backend was quadratic in the number of debug values
(minutes for a function rustc emits with `-C debuginfo=2`). Backported to
LLVM 22.1.8 from llvm-project, applied in `src/llvm-project` without their
tests (the tarball has none):

| patch | llvm-project commit |
|---|---|
| 0101 | `fe990b9005` (#188871) DebugValueManager's constructor scans only a value's uses instead of the whole block |
| 0102 | `8956179fa4` (#218369) no same-block dominance walks in RegStackify |
| 0103 | `fdf0409c65` (#218378) no scanning of unrelated debug values |

## 02xx: ours

| patch | what it does |
|---|---|
| 0201 | `RUSTC_LLVM_ONLY_TARGETS=webassembly` links rustc_llvm against LLVM's WebAssembly target alone and lld's wasm driver alone, so one LLVM build gives both rustc.wasm and rustc-cross.wasm; read for WASI targets only, so the native stage 1 never sees it |
| 0202 | bootstrap keeps the rustc crates' rlibs in a WASI host's sysroot, where there is no `librustc_driver.so` for a tool (Miri) to link against |
| 0203 | Miri on a WASI host: target features from rustc's dummy backend (the ABI's required ones), since an LLVM with only WebAssembly's code generator cannot make another target's machine; and the host code Miri has only for Unix and Windows (`OsStr` bytes, links, sockets, Windows paths) built for WASI too, failing where a browser has no such thing |

`config.yukibana.toml`'s `description = ""` is not a patch but matters as
much: without it the version string says "(built from a source tarball)",
and Rust's own rust-std for each target is refused (E0514).
