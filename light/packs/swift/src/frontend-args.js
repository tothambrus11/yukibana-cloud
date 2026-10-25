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
