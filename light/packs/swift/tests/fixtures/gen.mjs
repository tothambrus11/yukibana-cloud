// Writes the fixtures test-emit.mjs reads: the SIL, LLVM IR and assembly of
// sample.json's two files, at -Onone and -O, exactly as explorer.js asks the
// shipped compiler for them (src/views.js emitArgs), unfiltered.
//
//   node tests/fixtures/gen.mjs [dir with swift-frontend-lsp.wasm and swift-sysroot.tar]
//
// (default: ../../app/static/packs/swift, what build.sh wrote).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tc from '../../src/toolchain.js';
import { emitArgs, OUTPUT } from '../../src/views.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] ?? join(HERE, '../../../../app/static/packs/swift'));
const files = JSON.parse(readFileSync(join(HERE, 'sample.json'), 'utf8'));
const frontend = await WebAssembly.compile(readFileSync(join(dir, tc.FRONTEND_WASM)));
const root = new tc.Directory(new Map());
tc.untar(root, new Uint8Array(readFileSync(join(dir, tc.SYSROOT_TAR))), tc.SYSROOT);
tc.mkdirp(root, '/tmp');
tc.writeProject(root, '/workspace', files, 'main.swift');
tc.mkdirp(root, '/build');
for (const path of Object.keys(files))
    for (const optimization of ['-Onone', '-O'])
        for (const emit of ['sil', 'sil-raw', 'llvm-ir', 'asm']) {
            const args = emitArgs({ emit, files, path, optimization });
            tc.remove(root, OUTPUT);
            const sink = tc.textSink();
            const code = await tc.runFrontend(frontend, { args, root, stdout: sink, stderr: sink });
            if (code !== 0) throw new Error(`${path} ${emit} ${optimization}: ${sink.text}`);
            const name = `${path}${optimization}.${emit}`;
            writeFileSync(join(HERE, name), new TextDecoder().decode(tc.readFile(root, OUTPUT)));
            console.log(name);
        }
