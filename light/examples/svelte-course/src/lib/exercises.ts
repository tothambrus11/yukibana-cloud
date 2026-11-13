/**
 * The lesson the page shows: five graded exercises, one per language, each
 * written as its language's tests are written for real (pytest, node:test
 * with fast-check, libtest's #[test], GoogleTest, XCTest), so the hidden
 * tests a Check runs are the files a grader would run too.
 *
 * An exercise is data: what to do, the file the student edits (its
 * starter and a model solution), the files Run needs beside it, the
 * hidden test files only Check adds, and the checks those tests are, in
 * the order the checklist shows them. Every starter compiles and passes
 * some checks but not all, so a first Check shows a partial checklist.
 */
import { pathOf, type Files, type Path } from '@yukibana/core';
import type { CourseLanguage } from './languages.ts';

/** One check of an exercise: a test of its hidden files, by the name its framework reports. */
export interface CheckSpec {
	/** The test's name as its framework prints it, or the end of that name (report.ts `matches`). */
	readonly id: string;
	/** What it checks, for the student. */
	readonly label: string;
}

/** One graded exercise. */
export interface ExerciseSpec {
	/** Unique in the lesson, stable across versions of the page: progress is kept under it. */
	readonly id: string;
	readonly title: string;
	readonly language: CourseLanguage;
	/** The instructions, one paragraph each; `code` between backticks (inline.ts). */
	readonly instructions: readonly string[];
	/** The file the student edits. */
	readonly file: Path;
	/** Its text before the student starts. */
	readonly starter: string;
	/** A model solution of it, which passes every check. */
	readonly solution: string;
	/** The other files of the project, which Run and Check both send and the student does not edit (the program's entry, a manifest). */
	readonly support: Files;
	/** The hidden test files, sent by Check only. */
	readonly tests: Files;
	/** The file Run starts from: one of `support`, or `file`. */
	readonly entry: Path;
	/** What the stdin box holds at first: input the program's entry reads. */
	readonly stdin: string;
	/** The checks, in the order shown. */
	readonly checks: readonly CheckSpec[];
}

/** The lesson's id, under which the browser keeps its progress (progress.ts). */
export const LESSON_ID = 'functions-and-tests';

/** The lesson's title and its one-paragraph introduction. */
export const LESSON = {
	title: 'Functions that pass their tests',
	kicker: 'Lesson 3 · Testing',
	intro:
		'Each exercise below has a function to finish. Run it with your own input to see what it does, then press Check: the hidden tests run in your browser, and the checklist says which passed. Your code and your progress stay in this browser.',
} as const;

const python: ExerciseSpec = {
	id: 'python-top-words',
	title: 'The most frequent words',
	language: 'python',
	instructions: [
		'Finish `top_words(text, n)` in `words.py`: it returns the `n` most frequent words of `text` as `(word, count)` pairs, most frequent first.',
		'A word is a run of letters; case does not matter (`The` and `the` are one word, reported in lower case). Words with the same count come in alphabetical order.',
		'Run reads the text from standard input and prints the top three.',
	],
	file: pathOf('words.py'),
	starter: `def top_words(text: str, n: int) -> list[tuple[str, int]]:
    """The n most frequent words of text, with their counts."""
    # Split the text into words, count them, and sort the counts.
    return []
`,
	solution: `import re
from collections import Counter


def top_words(text: str, n: int) -> list[tuple[str, int]]:
    """The n most frequent words of text, with their counts."""
    counts = Counter(re.findall(r"[a-z]+", text.lower()))
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:n]
`,
	support: {
		'main.py': `import sys

from words import top_words

for word, count in top_words(sys.stdin.read(), 3):
    print(f"{word}: {count}")
`,
		'pyproject.toml': `[tool.pytest.ini_options]
addopts = "-v"
`,
	},
	tests: {
		'tests/test_words.py': `from words import top_words


def test_counts_words():
    assert top_words("a b a", 1) == [("a", 2)]


def test_ignores_case_and_punctuation():
    assert top_words("The cat. the CAT, the!", 2) == [("the", 3), ("cat", 2)]


def test_ties_are_alphabetical():
    assert top_words("b a c b a c", 3) == [("a", 2), ("b", 2), ("c", 2)]


def test_n_larger_than_vocabulary():
    assert top_words("one", 5) == [("one", 1)]


def test_empty_text():
    assert top_words("", 3) == []
`,
	},
	entry: pathOf('main.py'),
	stdin: 'the quick brown fox jumps over the lazy dog\nThe dog sleeps; the fox runs.\n',
	checks: [
		{ id: 'test_counts_words', label: 'Counts each word' },
		{ id: 'test_ignores_case_and_punctuation', label: 'Ignores case and punctuation' },
		{ id: 'test_ties_are_alphabetical', label: 'Breaks ties alphabetically' },
		{ id: 'test_n_larger_than_vocabulary', label: 'Copes with n larger than the vocabulary' },
		{ id: 'test_empty_text', label: 'Returns nothing for empty text' },
	],
};

const javascript: ExerciseSpec = {
	id: 'javascript-run-length',
	title: 'Run-length encoding',
	language: 'javascript',
	instructions: [
		'Finish `encode` and `decode` in `rle.js`. `encode("aaabcc")` is `"3a1b2c"`: each run of one letter becomes its length and the letter. `decode` turns the code back into the text, counts of more than one digit included.',
		'Two of the checks are properties tested with fast-check on hundreds of random strings: `decode(encode(s))` is `s`, and an encoding is never more than twice as long as its text.',
		'Run encodes each line of standard input and decodes it again.',
	],
	file: pathOf('rle.js'),
	starter: `/** Returns text with each run of one letter written as its length and the letter: "aaab" is "3a1b". */
export function encode(text) {
  // Walk the text, counting how many times each letter repeats.
  return '';
}

/** Returns the text that encode turned into code. */
export function decode(code) {
  return '';
}
`,
	solution: `/** Returns text with each run of one letter written as its length and the letter: "aaab" is "3a1b". */
export function encode(text) {
  let code = '';
  for (let at = 0; at < text.length; ) {
    let end = at;
    while (end < text.length && text[end] === text[at]) end += 1;
    code += \`\${end - at}\${text[at]}\`;
    at = end;
  }
  return code;
}

/** Returns the text that encode turned into code. */
export function decode(code) {
  return code.replace(/(\\d+)(\\D)/g, (_, count, letter) => letter.repeat(Number(count)));
}
`,
	support: {
		'main.js': `import { createInterface } from 'node:readline';
import { decode, encode } from './rle.js';

const lines = createInterface({ input: process.stdin, output: process.stdout });
lines.on('line', (line) => {
  const code = encode(line);
  console.log(\`\${line} -> \${code} -> \${decode(code)}\`);
});
`,
	},
	tests: {
		'rle.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { decode, encode } from './rle.js';

const letters = fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 40 }).map((chars) => chars.join(''));

test('encodes runs as count and letter', () => {
  assert.equal(encode('aaabcc'), '3a1b2c');
});

test('encodes the empty string as empty', () => {
  assert.equal(encode(''), '');
});

test('decodes counts of more than one digit', () => {
  assert.equal(decode('12x1y'), 'xxxxxxxxxxxxy');
});

test('decode undoes encode', () => {
  fc.assert(fc.property(letters, (text) => decode(encode(text)) === text));
});

test('an encoding is at most twice as long', () => {
  fc.assert(fc.property(letters, (text) => encode(text).length <= 2 * text.length));
});
`,
	},
	entry: pathOf('main.js'),
	stdin: 'aaabccdddd\nwwwwwwwwwwwwbx\n',
	checks: [
		{ id: 'encodes runs as count and letter', label: 'Encodes runs as count and letter' },
		{ id: 'encodes the empty string as empty', label: 'Encodes the empty string as empty' },
		{ id: 'decodes counts of more than one digit', label: 'Decodes counts of more than one digit' },
		{ id: 'decode undoes encode', label: 'Property: decode undoes encode' },
		{ id: 'an encoding is at most twice as long', label: 'Property: an encoding is at most twice as long' },
	],
};

const rust: ExerciseSpec = {
	id: 'rust-roman',
	title: 'Roman numerals',
	language: 'rust',
	instructions: [
		'Finish `to_roman` and `from_roman` in `src/lib.rs`. `to_roman(1994)` is `"MCMXCIV"`: the subtractive forms `IV`, `IX`, `XL`, `XC`, `CD` and `CM` come before the symbols they replace.',
		'`from_roman` reads a numeral back, and returns `None` for anything that is not one. The last check writes and reads every number from 1 to 3999.',
		'Run reads one number per line from standard input and prints its numeral.',
	],
	file: pathOf('src/lib.rs'),
	starter: `/// The Roman numeral of \`n\`, for 1 to 3999.
pub fn to_roman(n: u32) -> String {
    // Start from the largest symbols, and remember IV, IX, XL, XC, CD and CM.
    "I".repeat(n as usize)
}

/// The number \`numeral\` writes, or \`None\` if it is not a Roman numeral.
pub fn from_roman(numeral: &str) -> Option<u32> {
    let _ = numeral;
    None
}
`,
	solution: `const SYMBOLS: [(u32, &str); 13] = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
    (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
    (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
];

/// The Roman numeral of \`n\`, for 1 to 3999.
pub fn to_roman(mut n: u32) -> String {
    let mut numeral = String::new();
    for (value, symbol) in SYMBOLS {
        while n >= value {
            numeral.push_str(symbol);
            n -= value;
        }
    }
    numeral
}

/// The number \`numeral\` writes, or \`None\` if it is not a Roman numeral.
pub fn from_roman(numeral: &str) -> Option<u32> {
    let mut rest = numeral;
    let mut n = 0;
    for (value, symbol) in SYMBOLS {
        while let Some(after) = rest.strip_prefix(symbol) {
            n += value;
            rest = after;
        }
    }
    // Only the canonical spelling counts: "IIII" and "VX" are not numerals.
    (rest.is_empty() && n > 0 && to_roman(n) == numeral).then_some(n)
}
`,
	support: {
		'Cargo.toml': `[package]
name = "roman"
version = "0.1.0"
edition = "2021"
`,
		'src/main.rs': `use std::io::{self, BufRead};

fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.expect("standard input is text");
        match line.trim().parse::<u32>() {
            Ok(n) => println!("{n} = {}", roman::to_roman(n)),
            Err(_) => println!("{line:?} is not a number"),
        }
    }
}
`,
	},
	tests: {
		'tests/roman.rs': `use roman::{from_roman, to_roman};

#[test]
fn small_numbers() {
    assert_eq!(to_roman(3), "III");
}

#[test]
fn subtractive_forms() {
    assert_eq!(to_roman(4), "IV");
    assert_eq!(to_roman(9), "IX");
    assert_eq!(to_roman(1994), "MCMXCIV");
}

#[test]
fn reads_numerals_back() {
    assert_eq!(from_roman("MMXXVI"), Some(2026));
}

#[test]
fn rejects_non_numerals() {
    assert_eq!(from_roman("ABC"), None);
    assert_eq!(from_roman(""), None);
}

#[test]
fn round_trips_every_number() {
    for n in 1..4000 {
        assert_eq!(from_roman(&to_roman(n)), Some(n), "{n}");
    }
}
`,
	},
	entry: pathOf('src/main.rs'),
	stdin: '3\n1994\n2026\n',
	checks: [
		{ id: 'small_numbers', label: 'Writes small numbers' },
		{ id: 'subtractive_forms', label: 'Uses the subtractive forms' },
		{ id: 'reads_numerals_back', label: 'Reads a numeral back' },
		{ id: 'rejects_non_numerals', label: 'Rejects what is not a numeral' },
		{ id: 'round_trips_every_number', label: 'Round-trips 1 to 3999' },
	],
};

const cpp: ExerciseSpec = {
	id: 'cpp-bits',
	title: 'Counting bits',
	language: 'cpp',
	instructions: [
		'Finish the three functions of `bits.h`. `popcount(x)` is how many bits of `x` are 1; `is_power_of_two(x)` says whether exactly one is; `next_power_of_two(x)` is the smallest power of two that is at least `x` (and 1 for 0).',
		'Use only integer operations: `x & (x - 1)` clears the lowest bit that is set.',
		'Run reads numbers from standard input and describes each.',
	],
	file: pathOf('bits.h'),
	starter: `#pragma once

// How many bits of x are 1.
inline int popcount(unsigned x) {
    int count = 0;
    // Clear the lowest set bit until none is left, counting.
    (void)x;
    return count;
}

// Whether exactly one bit of x is 1.
inline bool is_power_of_two(unsigned x) {
    return x == 1;
}

// The smallest power of two that is at least x (1 for 0).
inline unsigned next_power_of_two(unsigned x) {
    return x;
}
`,
	solution: `#pragma once

// How many bits of x are 1.
inline int popcount(unsigned x) {
    int count = 0;
    for (; x != 0; x &= x - 1) ++count;
    return count;
}

// Whether exactly one bit of x is 1.
inline bool is_power_of_two(unsigned x) {
    return x != 0 && (x & (x - 1)) == 0;
}

// The smallest power of two that is at least x (1 for 0).
inline unsigned next_power_of_two(unsigned x) {
    unsigned power = 1;
    while (power < x) power <<= 1;
    return power;
}
`,
	support: {
		// The flags clang reads, as Light's C++ sample has them: -I. is what
		// lets tests/bits_test.cpp include "bits.h" from the project root.
		'compile_flags.txt': `-std=c++23
-Wall
-Wextra
-I.
`,
		'main.cpp': `#include <iostream>

#include "bits.h"

int main() {
    unsigned x;
    while (std::cin >> x) {
        std::cout << x << ": " << popcount(x) << " bits set"
                  << (is_power_of_two(x) ? ", a power of two" : "")
                  << ", next power of two " << next_power_of_two(x) << "\\n";
    }
}
`,
	},
	tests: {
		'tests/bits_test.cpp': `#include <gtest/gtest.h>

#include "bits.h"

TEST(Bits, ZeroHasNoBits) {
    EXPECT_EQ(popcount(0), 0);
}

TEST(Bits, CountsEveryBit) {
    EXPECT_EQ(popcount(0b1011), 3);
    EXPECT_EQ(popcount(0xFFFFFFFFu), 32);
}

TEST(Bits, PowersOfTwo) {
    EXPECT_TRUE(is_power_of_two(1));
    EXPECT_TRUE(is_power_of_two(64));
    EXPECT_FALSE(is_power_of_two(0));
    EXPECT_FALSE(is_power_of_two(12));
}

TEST(Bits, NextPowerOfTwo) {
    EXPECT_EQ(next_power_of_two(0), 1u);
    EXPECT_EQ(next_power_of_two(5), 8u);
    EXPECT_EQ(next_power_of_two(64), 64u);
}
`,
	},
	entry: pathOf('main.cpp'),
	stdin: '11\n64\n1000\n',
	checks: [
		{ id: 'Bits.ZeroHasNoBits', label: 'Zero has no bits set' },
		{ id: 'Bits.CountsEveryBit', label: 'Counts every bit' },
		{ id: 'Bits.PowersOfTwo', label: 'Knows the powers of two' },
		{ id: 'Bits.NextPowerOfTwo', label: 'Rounds up to a power of two' },
	],
};

const swift: ExerciseSpec = {
	id: 'swift-brackets',
	title: 'Balanced brackets',
	language: 'swift',
	instructions: [
		'`isBalanced(_:)` in `Brackets.swift` should say whether every `(`, `[` and `{` of a text is closed by its partner, in the right order. Other characters do not matter.',
		'The starter only compares how many brackets open and close, so `([)]` passes when it should not. Keep a stack of the brackets still open.',
		'Run reads lines from standard input and says whether each is balanced.',
	],
	file: pathOf('Brackets.swift'),
	starter: `/// Whether every bracket of \`text\` is closed by its partner, in order.
func isBalanced(_ text: String) -> Bool {
    let opened = text.filter { "([{".contains($0) }.count
    let closed = text.filter { ")]}".contains($0) }.count
    return opened == closed
}
`,
	solution: `/// Whether every bracket of \`text\` is closed by its partner, in order.
func isBalanced(_ text: String) -> Bool {
    let partners: [Character: Character] = [")": "(", "]": "[", "}": "{"]
    var stack: [Character] = []
    for character in text {
        if "([{".contains(character) {
            stack.append(character)
        } else if let partner = partners[character] {
            guard stack.popLast() == partner else { return false }
        }
    }
    return stack.isEmpty
}
`,
	support: {
		'main.swift': `while let line = readLine() {
    print("\\(line) -> \\(isBalanced(line) ? "balanced" : "not balanced")")
}
`,
	},
	tests: {
		'Tests/BracketsTests.swift': `import XCTest
@testable import App

final class BracketsTests: XCTestCase {
    func testEmptyIsBalanced() {
        XCTAssertTrue(isBalanced(""))
    }

    func testNestedPairs() {
        XCTAssertTrue(isBalanced("([]{()})"))
    }

    func testWrongOrder() {
        XCTAssertFalse(isBalanced("([)]"))
    }

    func testUnclosed() {
        XCTAssertFalse(isBalanced("(("))
    }

    func testIgnoresOtherCharacters() {
        XCTAssertTrue(isBalanced("let a = f(x[0]) { y }"))
    }
}
`,
	},
	entry: pathOf('main.swift'),
	stdin: '([]{})\n([)]\nf(x[0]) { y }\n',
	checks: [
		{ id: 'BracketsTests.testEmptyIsBalanced', label: 'The empty text is balanced' },
		{ id: 'BracketsTests.testNestedPairs', label: 'Nested pairs are balanced' },
		{ id: 'BracketsTests.testWrongOrder', label: 'Closing in the wrong order is not' },
		{ id: 'BracketsTests.testUnclosed', label: 'An unclosed bracket is not' },
		{ id: 'BracketsTests.testIgnoresOtherCharacters', label: 'Other characters are ignored' },
	],
};

/** The lesson's exercises, in the order the page shows them. */
export const EXERCISES: readonly ExerciseSpec[] = [python, javascript, rust, cpp, swift];
