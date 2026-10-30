// Unit tests of the Rust target choice (src/lib/rust-targets.ts): which
// target .cargo/config.toml puts a project on, how the Target picker
// rewrites that file, and that the app's table and parse rule agree with
// the Rust pack's (packs/rust/src/targets.json and targets.js).
//
//   node --test tests/unit/rust-targets.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RUST_TARGETS, rustTargetOf, withRustTarget } from '../../src/lib/rust-targets.ts';
import { targetOf as packTargetOf } from '../../../packs/rust/src/targets.js';

const json = JSON.parse(readFileSync(new URL('../../../packs/rust/src/targets.json', import.meta.url), 'utf8'));
const said = (c) => (c.kind === 'unsupported' ? `unsupported ${c.triple}` : c.target.id);
const packSaid = (c) => (c.unsupported !== undefined ? `unsupported ${c.unsupported}` : c.target.id);

test("the app's target table is the pack's targets.json, field for field", () => {
	assert.deepEqual(RUST_TARGETS, json);
});

test('a project without .cargo/config.toml, or without [build] target, builds for WebAssembly', () => {
	assert.equal(said(rustTargetOf(undefined)), 'wasm32-wasi');
	assert.equal(said(rustTargetOf('[target.x86_64-unknown-linux-musl]\nrunner = "qemu"\n')), 'wasm32-wasi');
});

const CASES = [
	['[build]\ntarget = "aarch64-unknown-linux-musl"\n', 'aarch64-linux'],
	['build.target = "riscv64gc-unknown-linux-musl"', 'riscv64-linux'],
	["[build]\ntarget = 'x86_64-unknown-linux-musl' # comment", 'x86_64-linux'],
	['[build]\ntarget = "wasm32-wasi"', 'wasm32-wasi'],
	['[build]\ntarget = "x86_64-linux"\ntarget = "aarch64-linux"', 'aarch64-linux'],
	['[build]\ntarget = "thumbv7em-none-eabihf"', 'unsupported thumbv7em-none-eabihf'],
	['[build]\ntarget = ["wasm32-wasip1", "x86_64-unknown-linux-musl"]', 'unsupported ["wasm32-wasip1", "x86_64-unknown-linux-musl"]'],
	['[build]\njobs = 2\n[env]\ntarget = "x86_64-unknown-linux-musl"', 'wasm32-wasi'],
];

test('the app and the runner read .cargo/config.toml alike', () => {
	for (const [text, expected] of CASES) {
		assert.equal(said(rustTargetOf(text)), expected, text);
		assert.equal(packSaid(packTargetOf(text)), expected, text);
	}
});

test('choosing a target rewrites [build] target and keeps every other line', () => {
	assert.equal(withRustTarget(undefined, 'aarch64-linux'), '[build]\ntarget = "aarch64-unknown-linux-musl"\n');
	assert.equal(withRustTarget(undefined, 'wasm32-wasi'), '', 'the default needs no file');
	const config = '[build]\njobs = 2\ntarget = "x86_64-unknown-linux-musl"\n\n[env]\nX = "1"\n';
	assert.equal(withRustTarget(config, 'riscv64-linux'), '[build]\ntarget = "riscv64gc-unknown-linux-musl"\njobs = 2\n\n[env]\nX = "1"\n');
	assert.equal(withRustTarget(config, 'wasm32-wasi'), '[build]\njobs = 2\n\n[env]\nX = "1"\n');
	assert.equal(withRustTarget('[env]\nX = "1"\n', 'x86_64-linux'), '[env]\nX = "1"\n\n[build]\ntarget = "x86_64-unknown-linux-musl"\n');
	assert.equal(withRustTarget('[build]\ntarget = "x86_64-unknown-linux-musl"\n', 'wasm32-wasi'), '');
	for (const t of RUST_TARGETS) assert.equal(rustTargetOf(withRustTarget(config, t.id)).target.id, t.id);
});
