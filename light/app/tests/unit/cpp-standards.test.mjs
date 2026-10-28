// Unit tests of the language standard choice (src/lib/cpp-standards.ts):
// which standard compile_flags.txt puts a C or C++ project on, and how the
// Standard picker rewrites that file.
//
//   node --test tests/unit/cpp-standards.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { C_STANDARDS, CPP_STANDARDS, describeStandard, standardOf, withStandard } from '../../src/lib/cpp-standards.ts';

const said = (choice) => (choice.kind === 'other' ? { kind: 'other', value: choice.value } : { kind: choice.kind, iso: choice.standard.iso, gnu: choice.gnu });
const std = (list, iso, gnu = false) => ({ standard: list.find((s) => s.iso === iso), gnu });

test("a project without a -std= line is on clang's default, GNU C++17 or GNU C17", () => {
	assert.deepEqual(said(standardOf(undefined, 'cpp')), { kind: 'default', iso: 'c++17', gnu: true });
	assert.deepEqual(said(standardOf('-Wall\n-I.\n', 'c')), { kind: 'default', iso: 'c17', gnu: true });
});

test("each language reads its own -std= line, so one file serves a project of both", () => {
	const flags = '-std=c17\n-std=c++20\n-Wall\n';
	assert.deepEqual(said(standardOf(flags, 'cpp')), { kind: 'standard', iso: 'c++20', gnu: false });
	assert.deepEqual(said(standardOf(flags, 'c')), { kind: 'standard', iso: 'c17', gnu: false });
});

test('the spellings clang 21 takes are read as their standard, and the last line wins', () => {
	assert.deepEqual(said(standardOf('-std=c++2a\n', 'cpp')), { kind: 'standard', iso: 'c++20', gnu: false });
	assert.deepEqual(said(standardOf('-std=gnu++2c\n', 'cpp')), { kind: 'standard', iso: 'c++26', gnu: true });
	assert.deepEqual(said(standardOf('--std=c++14\n', 'cpp')), { kind: 'standard', iso: 'c++14', gnu: false });
	assert.deepEqual(said(standardOf('-std=c++11\n-O2\n  -std=c++23  \r\n', 'cpp')), { kind: 'standard', iso: 'c++23', gnu: false });
	assert.deepEqual(said(standardOf('-std=iso9899:2018\n', 'c')), { kind: 'standard', iso: 'c17', gnu: false });
	assert.deepEqual(said(standardOf('-std=gnu2x\n', 'c')), { kind: 'standard', iso: 'c23', gnu: true });
});

test('a standard clang does not have is shown as it is written, not replaced', () => {
	assert.deepEqual(said(standardOf('-std=c++2d\n', 'cpp')), { kind: 'other', value: 'c++2d' });
	assert.equal(describeStandard(standardOf('-std=c++2d\n', 'cpp')), '-std=c++2d');
});

test('choosing a standard rewrites its line in place and keeps every other line as it was', () => {
	const flags = '-Wall\n-std=c++17\n\n-I.\n';
	assert.equal(withStandard(flags, 'cpp', std(CPP_STANDARDS, 'c++23')), '-Wall\n-std=c++23\n\n-I.\n');
	assert.equal(withStandard(flags, 'cpp', std(CPP_STANDARDS, 'c++20', true)), '-Wall\n-std=gnu++20\n\n-I.\n');
});

test("choosing a C++ standard leaves the C line alone, and the other way round", () => {
	const flags = '-std=c11\n-std=c++17\n';
	assert.equal(withStandard(flags, 'cpp', std(CPP_STANDARDS, 'c++20')), '-std=c11\n-std=c++20\n');
	assert.equal(withStandard(flags, 'c', std(C_STANDARDS, 'c23')), '-std=c23\n-std=c++17\n');
});

test('without a line, the standard goes first, with the line ending the file uses', () => {
	assert.equal(withStandard('-Wall\r\n-I.\r\n', 'cpp', std(CPP_STANDARDS, 'c++20')), '-std=c++20\r\n-Wall\r\n-I.\r\n');
	assert.equal(withStandard(undefined, 'c', std(C_STANDARDS, 'c17')), '-std=c17\n');
});

test("the default removes every line of the language, duplicates included, and needs no file", () => {
	assert.equal(withStandard('-std=c++11\n-Wall\n--std=c++14\n', 'cpp', 'default'), '-Wall\n');
	assert.equal(withStandard(undefined, 'cpp', 'default'), '');
});

test('a line written in place of the last one, which had no newline, keeps the lines apart', () => {
	assert.equal(withStandard('-Wall\n-std=c++17', 'cpp', std(CPP_STANDARDS, 'c++20')), '-Wall\n-std=c++20\n');
});

test('a choice is named as people say it', () => {
	assert.equal(describeStandard(standardOf('', 'cpp')), "GNU C++17 (clang's default)");
	assert.equal(describeStandard(standardOf('-std=c++20', 'cpp')), 'C++20');
	assert.equal(describeStandard(standardOf('-std=gnu23', 'c')), 'GNU C23');
});

test('every spelling belongs to one standard only', () => {
	for (const list of [CPP_STANDARDS, C_STANDARDS]) {
		const all = list.flatMap((s) => [s.iso, s.gnu, ...s.aliases]);
		assert.equal(new Set(all).size, all.length);
	}
});
