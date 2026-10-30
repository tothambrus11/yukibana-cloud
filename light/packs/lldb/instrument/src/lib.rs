//! The debugger's instrumenter: turns a WebAssembly program with DWARF into
//! one that stops where LLDB asks it to, for the probe runtime in
//! `../src/stub.js` (README.md, "How a program stops").
//!
//! A browser gives a page no way to set a breakpoint in a module it runs, so
//! the program is rewritten to ask: before every instruction that starts a
//! statement (a `.debug_line` row with `is_stmt`), and after every call, the
//! new code calls the import `yukibana:debug probe(site, depth, caller, fb)`.
//! `site` is the module offset of that instruction in the *original*
//! module, which is the module LLDB reads (with its DWARF) and the address
//! space its breakpoints and program counters are in, so the instrumented
//! module's own offsets never reach LLDB. `depth` counts the instrumented
//! frames on the stack, `caller` is the site in the calling frame that the
//! call returns to, and `fb` is the frame's `DW_AT_frame_base` (a local or a
//! global), the one value LLDB needs to find every variable of an unoptimised
//! frame in linear memory. The runtime keeps the last of each per depth: that
//! is the shadow call stack it answers `qWasmCallStack` and `qWasmLocal` from.
//!
//! The depth lives in a new global, incremented on entry into a local of the
//! frame's own and written back by every probe, so an exception that unwinds
//! past frames (libc++ throws with `-fwasm-exceptions`) leaves it right again
//! at the next probe of the frame that caught it; leaving a frame by `return`
//! or by its last `end` restores the caller's. The caller's return site is
//! set into another global before each call and copied into a local at entry.
//!
//! Functions without line rows (wasi-libc, libc++'s compiled parts) are
//! copied unchanged but for function indices, which move up by one for the
//! new import. Custom sections other than `name` are dropped: the DWARF in
//! them describes the original module, and LLDB reads that one.

use std::collections::{BTreeMap, BTreeSet};

use wasm_encoder::reencode::{Error as ReError, Reencode};
use wasm_encoder::{Function, Instruction};
use wasmparser::{FunctionBody, Operator, Parser, Payload, TypeRef};

/// The module and name the probe is imported as.
pub const PROBE_MODULE: &str = "yukibana:debug";
pub const PROBE_NAME: &str = "probe";

/// What a site is: where a statement begins, or where a call returns to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SiteKind {
    Statement = 0,
    Return = 1,
}

/// Where a frame's `DW_AT_frame_base` is: a wasm local, a global, or nowhere
/// the instrumenter understood (the frame's variables are then unavailable).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameBase {
    Local(u32),
    Global(u32),
    None,
}

/// One probe: its site (an offset in the original module), what it is, and
/// the frame base of the function it is in.
#[derive(Clone, Copy, Debug)]
pub struct Site {
    pub offset: u32,
    pub kind: SiteKind,
    pub function: u32,
    pub frame_base: FrameBase,
}

/// What `instrument` made: the new module, every probe site, and the index
/// of the first global it added (`depth`, then `caller`).
pub struct Output {
    pub module: Vec<u8>,
    pub sites: Vec<Site>,
    pub globals: u32,
}

/// Names what was wrong with a module, for the person whose program it is.
#[derive(Debug)]
pub struct Problem(pub String);

impl<T: std::fmt::Display> From<T> for Problem {
    fn from(e: T) -> Self {
        Problem(e.to_string())
    }
}

/// What the first pass learns about the original module.
#[derive(Default)]
struct Shape {
    types: u32,
    func_params: Vec<u32>,
    imported_funcs: u32,
    imported_globals: u32,
    globals: u32,
    defined_types: Vec<u32>,
    code_start: u32,
    has_imports: bool,
    custom: BTreeMap<String, Vec<u8>>,
}

fn shape(wasm: &[u8]) -> Result<Shape, Problem> {
    let mut s = Shape::default();
    for payload in Parser::new(0).parse_all(wasm) {
        match payload? {
            Payload::TypeSection(r) => {
                for group in r {
                    for sub in group?.into_types() {
                        let params = match &sub.composite_type.inner {
                            wasmparser::CompositeInnerType::Func(f) => f.params().len() as u32,
                            _ => 0,
                        };
                        s.func_params.push(params);
                        s.types += 1;
                    }
                }
            }
            Payload::ImportSection(r) => {
                s.has_imports = true;
                for imports in r {
                    for import in imports? {
                        let (_, import) = import?;
                        match import.ty {
                            TypeRef::Func(_) | TypeRef::FuncExact(_) => s.imported_funcs += 1,
                            TypeRef::Global(_) => s.imported_globals += 1,
                            _ => {}
                        }
                    }
                }
            }
            Payload::FunctionSection(r) => {
                for t in r {
                    s.defined_types.push(t?);
                }
            }
            Payload::GlobalSection(r) => s.globals = r.count(),
            Payload::CodeSectionStart { unchecked_range, .. } => s.code_start = unchecked_range.start as u32,
            Payload::CustomSection(c) if c.name().starts_with(".debug_") => {
                s.custom.insert(c.name().to_string(), c.data().to_vec());
            }
            _ => {}
        }
    }
    Ok(s)
}

/// The statement rows and frame bases the DWARF gives, as module offsets.
struct Debug {
    statements: BTreeSet<u32>,
    /// Function low_pc (module offset) to its frame base.
    frame_bases: BTreeMap<u32, FrameBase>,
}

fn read_dwarf(s: &Shape) -> Result<Debug, Problem> {
    use gimli::{EndianSlice, LittleEndian};
    let empty: &[u8] = &[];
    let load = |id: gimli::SectionId| -> Result<EndianSlice<'_, LittleEndian>, gimli::Error> {
        let data = s.custom.get(id.name()).map(|v| v.as_slice()).unwrap_or(empty);
        Ok(EndianSlice::new(data, LittleEndian))
    };
    let dwarf = gimli::Dwarf::load(load)?;
    let base = s.code_start;
    let mut statements = BTreeSet::new();
    let mut frame_bases = BTreeMap::new();
    let mut units = dwarf.units();
    while let Some(header) = units.next()? {
        let unit = dwarf.unit(header)?;
        if let Some(program) = unit.line_program.clone() {
            let mut rows = program.rows();
            while let Some((_, row)) = rows.next_row()? {
                // Address 0 is a function the linker discarded (its rows were
                // kept, relocated to nothing), not the first byte of code.
                if row.is_stmt() && !row.end_sequence() && row.address() != 0 {
                    statements.insert(base + row.address() as u32);
                }
            }
        }
        let mut entries = unit.entries();
        while let Some(entry) = entries.next_dfs()? {
            if entry.tag() != gimli::DW_TAG_subprogram {
                continue;
            }
            let Some(gimli::AttributeValue::Exprloc(expr)) = entry.attr_value(gimli::DW_AT_frame_base) else {
                continue;
            };
            let low = match entry.attr_value(gimli::DW_AT_low_pc) {
                Some(v) => match dwarf.attr_address(&unit, v)? {
                    Some(a) if a != 0 => a,
                    _ => continue,
                },
                None => continue,
            };
            frame_bases.insert(base + low as u32, frame_base_of(expr.0.slice()));
        }
    }
    Ok(Debug { statements, frame_bases })
}

/// Reads `DW_OP_WASM_location kind index` (0xed), the only frame base clang
/// and swiftc emit for wasm: kind 0 is a local, 1 a global (ULEB index), 3 a
/// global with a fixed 4-byte index.
fn frame_base_of(expr: &[u8]) -> FrameBase {
    fn uleb(b: &[u8]) -> Option<u32> {
        let (mut v, mut shift) = (0u64, 0);
        for &byte in b {
            v |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return u32::try_from(v).ok();
            }
            shift += 7;
            if shift > 35 {
                return None;
            }
        }
        None
    }
    match expr {
        [0xed, 0, rest @ ..] => uleb(rest).map_or(FrameBase::None, FrameBase::Local),
        [0xed, 1, rest @ ..] => uleb(rest).map_or(FrameBase::None, FrameBase::Global),
        [0xed, 3, a, b, c, d, ..] => FrameBase::Global(u32::from_le_bytes([*a, *b, *c, *d])),
        _ => FrameBase::None,
    }
}

struct Instrumenter<'d> {
    shape: &'d Shape,
    debug: &'d Debug,
    probe_type: u32,
    probe_func: u32,
    depth_global: u32,
    caller_global: u32,
    defined: u32,
    sites: Vec<Site>,
}

impl Reencode for Instrumenter<'_> {
    type Error = Problem;

    fn function_index(&mut self, func: u32) -> Result<u32, ReError<Problem>> {
        Ok(if func >= self.shape.imported_funcs { func + 1 } else { func })
    }

    fn parse_type_section(&mut self, types: &mut wasm_encoder::TypeSection, section: wasmparser::TypeSectionReader<'_>) -> Result<(), ReError<Problem>> {
        wasm_encoder::reencode::utils::parse_type_section(self, types, section)?;
        types.ty().function([wasm_encoder::ValType::I32; 4], []);
        Ok(())
    }

    fn parse_import_section(&mut self, imports: &mut wasm_encoder::ImportSection, section: wasmparser::ImportSectionReader<'_>) -> Result<(), ReError<Problem>> {
        // Function imports come first in the index space whatever the order
        // of the section, so the probe, last, is index imported_funcs.
        wasm_encoder::reencode::utils::parse_import_section(self, imports, section)?;
        imports.import(PROBE_MODULE, PROBE_NAME, wasm_encoder::EntityType::Function(self.probe_type));
        Ok(())
    }

    fn parse_global_section(&mut self, globals: &mut wasm_encoder::GlobalSection, section: wasmparser::GlobalSectionReader<'_>) -> Result<(), ReError<Problem>> {
        wasm_encoder::reencode::utils::parse_global_section(self, globals, section)?;
        let ty = wasm_encoder::GlobalType {
            val_type: wasm_encoder::ValType::I32,
            mutable: true,
            shared: false,
        };
        globals.global(ty, &wasm_encoder::ConstExpr::i32_const(0));
        globals.global(ty, &wasm_encoder::ConstExpr::i32_const(0));
        Ok(())
    }

    fn parse_export_section(&mut self, exports: &mut wasm_encoder::ExportSection, section: wasmparser::ExportSectionReader<'_>) -> Result<(), ReError<Problem>> {
        wasm_encoder::reencode::utils::parse_export_section(self, exports, section)?;
        // Every global, so the runtime can answer qWasmGlobal (the stack
        // pointer is a frame base in leaf functions) and read the depth.
        let all = self.shape.imported_globals + self.shape.globals + 2;
        for g in 0..all {
            exports.export(&format!("__yk_global{g}"), wasm_encoder::ExportKind::Global, g);
        }
        Ok(())
    }

    fn parse_custom_section(&mut self, module: &mut wasm_encoder::Module, section: wasmparser::CustomSectionReader<'_>) -> Result<(), ReError<Problem>> {
        if section.name() == "name" {
            wasm_encoder::reencode::utils::parse_custom_section(self, module, section)?;
        }
        Ok(())
    }

    fn parse_function_body(&mut self, code: &mut wasm_encoder::CodeSection, func: FunctionBody<'_>) -> Result<(), ReError<Problem>> {
        let index = self.shape.imported_funcs + self.defined;
        self.defined += 1;
        let range = func.range();
        let (start, end) = (range.start as u32, range.end as u32);
        let has_rows = self.debug.statements.range(start..end).next().is_some();
        if !has_rows {
            return wasm_encoder::reencode::utils::parse_function_body(self, code, func);
        }
        let type_index = self.shape.defined_types[(index - self.shape.imported_funcs) as usize];
        let params = self.shape.func_params.get(type_index as usize).copied().unwrap_or(0);
        let mut locals = Vec::new();
        let mut count = params;
        for pair in func.get_locals_reader()? {
            let (n, ty) = pair?;
            count += n;
            locals.push((n, self.val_type(ty)?));
        }
        let (depth, caller) = (count, count + 1);
        locals.push((2, wasm_encoder::ValType::I32));
        // The frame base: the last subprogram that starts at or before the
        // body (low_pc is the body's start or its first instruction).
        let frame_base = self
            .debug
            .frame_bases
            .range(..end)
            .next_back()
            .filter(|(low, _)| **low >= start.saturating_sub(8))
            .map_or(FrameBase::None, |(_, fb)| *fb);
        let frame_base = match frame_base {
            FrameBase::Local(l) if l >= count => FrameBase::None,
            fb => fb,
        };

        let mut f = Function::new(locals);
        f.instruction(&Instruction::GlobalGet(self.depth_global));
        f.instruction(&Instruction::I32Const(1));
        f.instruction(&Instruction::I32Add);
        f.instruction(&Instruction::LocalTee(depth));
        f.instruction(&Instruction::GlobalSet(self.depth_global));
        f.instruction(&Instruction::GlobalGet(self.caller_global));
        f.instruction(&Instruction::LocalSet(caller));

        let probe = |f: &mut Function, me: &mut Self, site: u32, kind: SiteKind| {
            f.instruction(&Instruction::LocalGet(depth));
            f.instruction(&Instruction::GlobalSet(me.depth_global));
            f.instruction(&Instruction::I32Const(site as i32));
            f.instruction(&Instruction::LocalGet(depth));
            f.instruction(&Instruction::LocalGet(caller));
            match frame_base {
                FrameBase::Local(l) => f.instruction(&Instruction::LocalGet(l)),
                FrameBase::Global(g) => f.instruction(&Instruction::GlobalGet(g)),
                FrameBase::None => f.instruction(&Instruction::I32Const(0)),
            };
            f.instruction(&Instruction::Call(me.probe_func));
            me.sites.push(Site {
                offset: site,
                kind,
                function: index,
                frame_base,
            });
        };
        let leave = |f: &mut Function, me: &Self| {
            f.instruction(&Instruction::LocalGet(depth));
            f.instruction(&Instruction::I32Const(1));
            f.instruction(&Instruction::I32Sub);
            f.instruction(&Instruction::GlobalSet(me.depth_global));
        };

        let mut reader = func.get_operators_reader()?;
        // Rows before the first instruction (the body's start) belong to it.
        let mut pending: Vec<u32> = self
            .debug
            .statements
            .range(start..)
            .take_while(|a| **a < reader.original_position() as u32)
            .copied()
            .collect();
        let mut nesting = 0u32;
        let mut return_site: Option<u32> = None;
        while !reader.eof() {
            let at = reader.original_position() as u32;
            let op = reader.read()?;
            let next = reader.original_position() as u32;
            // A statement row here, or a call that just returned to here.
            let row = self.debug.statements.contains(&at);
            if let Some(&first) = pending.first() {
                probe(&mut f, self, first, SiteKind::Statement);
                pending.clear();
            } else if row {
                probe(&mut f, self, at, SiteKind::Statement);
            } else if let Some(site) = return_site {
                probe(&mut f, self, site, SiteKind::Return);
            }
            return_site = None;
            match &op {
                Operator::Block { .. } | Operator::Loop { .. } | Operator::If { .. } | Operator::TryTable { .. } | Operator::Try { .. } => nesting += 1,
                Operator::Delegate { .. } => nesting -= 1,
                Operator::End => {
                    if nesting == 0 {
                        leave(&mut f, self);
                    } else {
                        nesting -= 1;
                    }
                }
                Operator::Return | Operator::ReturnCall { .. } | Operator::ReturnCallIndirect { .. } | Operator::ReturnCallRef { .. } => leave(&mut f, self),
                Operator::Call { .. } | Operator::CallIndirect { .. } | Operator::CallRef { .. } => {
                    f.instruction(&Instruction::I32Const(next as i32));
                    f.instruction(&Instruction::GlobalSet(self.caller_global));
                    return_site = Some(next);
                }
                _ => {}
            }
            f.instruction(&self.instruction(op)?);
        }
        code.function(&f);
        Ok(())
    }
}

/// Instruments `wasm` (README.md, "How a program stops"). Fails, naming why,
/// for a module that does not parse or has no imports (every WASI program
/// imports from `wasi_snapshot_preview1`).
pub fn instrument(wasm: &[u8]) -> Result<Output, Problem> {
    let shape = shape(wasm)?;
    if !shape.has_imports {
        return Err(Problem("the program imports nothing, so it is not a WASI program".into()));
    }
    let debug = read_dwarf(&shape)?;
    if debug.statements.is_empty() {
        return Err(Problem("the program has no line table: it was compiled without -g".into()));
    }
    let globals = shape.imported_globals + shape.globals;
    let mut me = Instrumenter {
        shape: &shape,
        debug: &debug,
        probe_type: shape.types,
        probe_func: shape.imported_funcs,
        depth_global: globals,
        caller_global: globals + 1,
        defined: 0,
        sites: Vec::new(),
    };
    let mut module = wasm_encoder::Module::new();
    me.parse_core_module(&mut module, Parser::new(0), wasm).map_err(|e| match e {
        ReError::UserError(p) => p,
        other => Problem(format!("{other:?}")),
    })?;
    Ok(Output {
        module: module.finish(),
        sites: me.sites,
        globals,
    })
}

/// The site table the runtime reads, as little-endian u32s: for each site
/// its offset, kind, function index (original numbering) and frame base
/// (kind 0 none, 1 local, 2 global; then the index).
pub fn site_table(sites: &[Site]) -> Vec<u8> {
    let mut out = Vec::with_capacity(sites.len() * 20);
    for s in sites {
        let (fk, fi) = match s.frame_base {
            FrameBase::None => (0u32, 0u32),
            FrameBase::Local(l) => (1, l),
            FrameBase::Global(g) => (2, g),
        };
        for v in [s.offset, s.kind as u32, s.function, fk, fi] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

#[cfg(target_arch = "wasm32")]
mod exports {
    //! The C ABI the runtime calls: `alloc` a buffer for the program,
    //! `instrument` it, then read `result_ptr`/`result_len` (on success the
    //! instrumented module, on failure the problem in UTF-8) and
    //! `sites_ptr`/`sites_len`, and `globals`.
    use std::cell::RefCell;

    thread_local! {
        static RESULT: RefCell<(Vec<u8>, Vec<u8>, u32)> = const { RefCell::new((Vec::new(), Vec::new(), 0)) };
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        let mut v = vec![0u8; len];
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// Returns 1 on success, 0 on failure.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn instrument(ptr: *mut u8, len: usize) -> u32 {
        let input = unsafe { Vec::from_raw_parts(ptr, len, len) };
        let (ok, result) = match super::instrument(&input) {
            Ok(out) => (1, (out.module, super::site_table(&out.sites), out.globals)),
            Err(p) => (0, (p.0.into_bytes(), Vec::new(), 0)),
        };
        RESULT.with(|r| *r.borrow_mut() = result);
        ok
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn result_ptr() -> *const u8 {
        RESULT.with(|r| r.borrow().0.as_ptr())
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn result_len() -> usize {
        RESULT.with(|r| r.borrow().0.len())
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn sites_ptr() -> *const u8 {
        RESULT.with(|r| r.borrow().1.as_ptr())
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn sites_len() -> usize {
        RESULT.with(|r| r.borrow().1.len())
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn globals() -> u32 {
        RESULT.with(|r| r.borrow().2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ../tests/hello.wasm, hello.cpp compiled with wasi-sdk 30 at -g -O0.
    const HELLO: &[u8] = include_bytes!("../../tests/hello.wasm");

    #[test]
    fn a_program_with_debug_information_is_instrumented_into_a_valid_module() {
        let out = instrument(HELLO).expect("hello.wasm instruments");
        wasmparser::validate(&out.module).expect("the instrumented module validates");
        assert!(
            out.sites.iter().any(|s| s.offset == 0x302 && s.kind == SiteKind::Statement),
            "hello.cpp:12 is a statement site"
        );
        assert!(
            out.sites.iter().any(|s| s.offset == 0x31a && s.kind == SiteKind::Return),
            "the return from the call at 0x314 is a site"
        );
        assert_eq!(site_table(&out.sites).len(), out.sites.len() * 20);
    }

    #[test]
    fn a_program_without_a_line_table_is_refused_saying_so() {
        // The smallest WASI-shaped module: one import, no DWARF.
        let mut module = wasm_encoder::Module::new();
        let mut types = wasm_encoder::TypeSection::new();
        types.ty().function([], []);
        module.section(&types);
        let mut imports = wasm_encoder::ImportSection::new();
        imports.import("wasi_snapshot_preview1", "sched_yield", wasm_encoder::EntityType::Function(0));
        module.section(&imports);
        let problem = instrument(&module.finish()).err().expect("refused");
        assert!(problem.0.contains("compiled without -g"), "{}", problem.0);
    }
}
