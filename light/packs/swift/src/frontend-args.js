// The Swift frontend's argument vector for wasm32-unknown-wasip1 and the
// paths it names in the toolchain's file system: pure, no imports, so that
// views.js and its tests (test-emit.mjs, run by node with no npm install)
// can build the vectors explorer.js runs. toolchain.js re-exports all of it.

export const SYSROOT = '/sysroot';
export const WASI_SYSROOT = `${SYSROOT}/wasi-sysroot`;
export const RESOURCES = `${SYSROOT}/swift/lib/swift_static`;
export const MODULE_CACHE = '/tmp/module-cache';

/**
 * What the driver would pass to `swift-frontend -frontend` for
 * wasm32-unknown-wasip1. `moduleName` is `main` unless a test file imports
 * the project under another name (see xctest.js, projectModuleName).
 */
export function commonFrontendArgs(moduleName = 'main') {
    return [
        '-target', 'wasm32-unknown-wasip1',
        // wasm has no Objective-C runtime; the driver always passes this for wasi.
        '-disable-objc-interop',
        '-sdk', WASI_SYSROOT,
        '-resource-dir', RESOURCES,
        '-use-static-resource-dir',
        '-no-color-diagnostics',
        '-Xcc', '-fno-color-diagnostics',
        // Clang builds the SwiftShims module implicitly and caches it here; the
        // cache lives as long as the worker, so only the first compile pays.
        '-module-cache-path', MODULE_CACHE,
        ...macroPluginArgs(),
        '-module-name', moduleName,
    ];
}

/**
 * The macro plugins, one WASI module from swift-toolchain-wasm (its Stage
 * 37): the example `StringifyMacros`, Observation's `ObservationMacros` and
 * swift-testing's `TestingMacros`, sharing one copy of swift-syntax. Every
 * compile and sourcekitd are told (macroPluginArgs) that they are an
 * in-process plugin library at MACRO_PLUGIN_PATH; the file is there only
 * when loadMacroPlugins() has put it there, for code that uses one of their
 * macros (usesMacroPlugins). Without it a macro use is a diagnostic, "could
 * not be found ...; No such file or directory", like a missing plugin on a
 * native host.
 */
export const MACRO_PLUGINS_WASM = 'SwiftMacroPlugins.wasm';
export const MACRO_PLUGIN_PATH = `${SYSROOT}/plugins/${MACRO_PLUGINS_WASM}`;
export const MACRO_MODULES = ['StringifyMacros', 'ObservationMacros', 'TestingMacros'];

/** `-load-resolved-plugin <library>#<no executable>#<modules>`: the plugins above, in-process. */
export function macroPluginArgs() {
    return ['-load-resolved-plugin', `${MACRO_PLUGIN_PATH}##${MACRO_MODULES.join(',')}`];
}

// ---------------------------------------------------------------- Linux

/**
 * The Linux targets a project can build for instead of WebAssembly (swift.env,
 * target.js), with swift-toolchain-wasm's cross compiler and Swift's Static
 * Linux SDK: static musl executables, run under the C++ pack's QEMU. `arch`
 * is the SDK's and QEMU's name, `triple` the frontend's target,
 * `emulation` ld.lld's `-m`, `frontend` what `swiftc -v` adds for the
 * target. There is no riscv64: Swift has no SDK for it (README, "Linux
 * targets").
 */
export const LINUX_TARGETS = {
    'x86_64-linux': { arch: 'x86_64', triple: 'x86_64-swift-linux-musl', emulation: 'elf_x86_64', frontend: [], label: 'x86-64 Linux' },
    'aarch64-linux': { arch: 'aarch64', triple: 'aarch64-swift-linux-musl', emulation: 'aarch64linux', frontend: ['-Xllvm', '-aarch64-use-tbi'], label: 'AArch64 Linux' },
};

/**
 * Where a Linux target's sysroot (swift-sysroot-linux-<arch>.tar, the SDK's
 * own layout) is unpacked, next to the WebAssembly one at SYSROOT, so that a
 * worker can hold both.
 */
export const linuxSysroot = (arch) => `/sysroot-linux-${arch}`;

/**
 * `swift-frontend -frontend -c` for a Linux target: what `swiftc -v
 * -static-executable -static-stdlib` passes with the Static Linux SDK at
 * linuxSysroot(arch), plus DWARF debug info (the program's own; the SDK's
 * archives come without theirs). The same vector, with native paths, is
 * swift-toolchain-wasm's Stage 58.
 */
export function linuxCompileArgs(target, sources, output, moduleName = 'main', optimization = '-Onone') {
    const sdk = linuxSysroot(target.arch);
    return [
        'swift-frontend', '-frontend', '-c', ...sources,
        '-target', target.triple, ...target.frontend,
        '-disable-objc-interop',
        '-sdk', sdk,
        '-resource-dir', `${sdk}/usr/lib/swift_static`,
        '-use-static-resource-dir',
        '-no-color-diagnostics',
        '-Xcc', '-fno-color-diagnostics',
        '-module-cache-path', MODULE_CACHE,
        ...macroPluginArgs(),
        '-g', '-debug-info-format=dwarf', '-dwarf-version=4',
        '-module-name', moduleName,
        optimization, '-empty-abi-descriptor', '-o', output,
    ];
}

/**
 * The libraries every Linux program links, after its objects and their
 * autolink entries: the SDK's static-executable-args.lnk, which `swiftc
 * -static-executable` reads, as ld.lld arguments.
 */
const LINUX_RUNTIME_LIBRARIES = [
    '-lswiftCore', '-lswift_RegexParser',
    '-undefined=pthread_self', '-undefined=pthread_once', '-undefined=pthread_key_create',
    '-ldispatch', '-lBlocksRuntime', '-lpthread', '-ldl', '-lc++', '-lc++abi', '-lm',
];

/**
 * `ld.lld` for a Linux target, as clang drives it for `swiftc
 * -static-executable`: musl's start files, compiler-rt's crtbegin/crtend and
 * builtins, the objects and `autolink` (their autolink entries, which name
 * every Swift library a module imports, transitively) in a group. `args[0]`
 * is `ld.lld`, which is what makes lld (wasm-ld.wasm is the multiplexed
 * driver) link ELF.
 */
export function linuxLinkArgs(target, objects, output, autolink = []) {
    const sdk = linuxSysroot(target.arch);
    const lib = `${sdk}/usr/lib/swift_static/linux-static`;
    const crt = `${sdk}/usr/lib/swift_static/clang/lib/linux`;
    return [
        'ld.lld', `--sysroot=${sdk}`, '-z', 'relro', '--hash-style=gnu', '--eh-frame-hdr',
        '-m', target.emulation, '-static', '-o', output,
        `${sdk}/usr/lib/crt1.o`, `${sdk}/usr/lib/crti.o`, `${crt}/clang_rt.crtbegin-${target.arch}.o`,
        `-L${lib}`, `-L${lib}/${target.arch}`, `-L${sdk}/usr/lib`,
        '--build-id', `${lib}/${target.arch}/swiftrt.o`,
        '--start-group', ...objects, ...autolink, '--end-group',
        ...LINUX_RUNTIME_LIBRARIES,
        '--start-group', `${crt}/libclang_rt.builtins-${target.arch}.a`, '-l:libunwind.a', '-lc', '--end-group',
        `${crt}/clang_rt.crtend-${target.arch}.o`, `${sdk}/usr/lib/crtn.o`,
        '--error-limit=0', '--threads=1',
    ];
}
