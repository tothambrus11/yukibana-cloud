// swift.env and the Linux argument vectors (src/target.js,
// src/frontend-args.js): pure, so node runs it with no npm install, like
// test-emit.mjs. test-linux.mjs runs the vectors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINUX_TARGETS, linuxCompileArgs, linuxLinkArgs, linuxSysroot } from './src/frontend-args.js';
import { DEFAULT_TARGET, linuxTarget, settingsOf } from './src/target.js';

test('a project without swift.env, or with only comments, builds for WebAssembly', () => {
    assert.deepEqual(settingsOf(undefined), { target: DEFAULT_TARGET, problems: [] });
    assert.deepEqual(settingsOf('# TARGET=x86_64-linux\n\n'), { target: DEFAULT_TARGET, problems: [] });
    assert.equal(linuxTarget(DEFAULT_TARGET), null);
});

test('TARGET=aarch64-linux builds for AArch64 Linux, with the Static Linux SDK triple', () => {
    const { target, problems } = settingsOf('TARGET = aarch64-linux\n');
    assert.deepEqual(problems, []);
    assert.equal(linuxTarget(target).triple, 'aarch64-swift-linux-musl');
});

test('RISC-V, an unknown target, an unknown key and a line without = are refused, each by its line', () => {
    const { target, problems } = settingsOf('TARGET=riscv64-linux\nTARGET=arm-linux\nOPTIMIZE=-O\nnonsense\n');
    assert.equal(target, DEFAULT_TARGET);
    assert.deepEqual(problems.map((p) => p.line), [1, 2, 3, 4]);
    assert.match(problems[0].message, /no SDK for riscv64-linux/);
});

test('a Linux compile names the target sysroot and its static resources, with debug info', () => {
    const args = linuxCompileArgs(LINUX_TARGETS['aarch64-linux'], ['/workspace/main.swift'], '/build/main.o', 'main', '-O');
    const after = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(after('-target'), 'aarch64-swift-linux-musl');
    assert.equal(after('-sdk'), linuxSysroot('aarch64'));
    assert.equal(after('-resource-dir'), `${linuxSysroot('aarch64')}/usr/lib/swift_static`);
    assert.ok(args.includes('-use-static-resource-dir') && args.includes('-g') && args.includes('-O'));
});

test('the link is ld.lld: start files first, the objects and their autolink entries in one group', () => {
    const args = linuxLinkArgs(LINUX_TARGETS['x86_64-linux'], ['/build/main.o'], '/build/main', ['-lswiftCore', '-lswiftSynchronization']);
    assert.equal(args[0], 'ld.lld');
    assert.equal(args[args.indexOf('-m') + 1], 'elf_x86_64');
    assert.ok(args.indexOf(`${linuxSysroot('x86_64')}/usr/lib/crt1.o`) < args.indexOf('/build/main.o'));
    const group = args.slice(args.indexOf('--start-group'), args.indexOf('--end-group'));
    assert.ok(group.includes('/build/main.o') && group.includes('-lswiftSynchronization'));
});
