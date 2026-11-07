/**
 * C's and C++'s bodies: what a host loads when the language is first used
 * (Light imports them with the page): the sample projects, which refer to
 * each other's files on purpose, the server's settings, the build settings
 * (properties.ts) and the configuration files the app's own controls edit
 * (Build settings rewrites compile_flags.txt, the clang-tidy rules
 * .clang-tidy), which a beginner never needs to open.
 */
import type { PackLanguageBody } from '../std/index.ts';
import { cFamilyModel } from './properties.ts';

/**
 * The C++ sample's clang-tidy checks, which the editor runs as you type
 * (packs/cpp README, "clang-tidy"): the C++ Core Guidelines
 * (cppcoreguidelines-*), the checks that find bugs (bugprone-*), and the
 * modernize, performance and readability families, as Jason Turner's
 * cpp-best-practices starter project enables them, less the checks that are
 * noise in a small program or a lesson: swappable parameters, magic
 * numbers, do-while, recursion, public data members, [[nodiscard]] on every
 * getter, trailing return types, gsl::owner, printf's varargs (the samples
 * print with printf), indexing with a variable, short names, uppercase
 * literal suffixes, parentheses around arithmetic, and designated
 * initializers for every aggregate (`Point{.x = 1, .y = 2}` for a pair).
 * The sample is C++23, so modernize-use-std-print would move printf to
 * std::println; it is off because <print> costs a compile in the browser
 * about 3.5 s more at -O2 (1.2 s at -O0) and the object 170 KB, on every
 * Run (measured with the pack's clang 21). A check that needs a newer
 * standard than the project's is skipped by clang-tidy itself
 * (isLanguageVersionSupported), so these rules suit any -std=. Each line is a glob,
 * the last one that matches a check deciding, as clang-tidy reads them; the
 * rule editor (tidy.ts) rewrites the list and keeps the rest of the
 * file.
 */
export const CPP_TIDY = `# clang-tidy's checks: the editor runs them as you type. Change them with
# Build settings > clang-tidy rules, or here: each line is a glob, and the
# last one that matches a check decides (- turns it off).
Checks: >-
  -*,
  bugprone-*,
  -bugprone-easily-swappable-parameters,
  concurrency-*,
  -concurrency-mt-unsafe,
  cppcoreguidelines-*,
  -cppcoreguidelines-avoid-do-while,
  -cppcoreguidelines-avoid-magic-numbers,
  -cppcoreguidelines-non-private-member-variables-in-classes,
  -cppcoreguidelines-owning-memory,
  -cppcoreguidelines-pro-bounds-constant-array-index,
  -cppcoreguidelines-pro-type-vararg,
  misc-*,
  -misc-no-recursion,
  -misc-non-private-member-variables-in-classes,
  modernize-*,
  -modernize-use-designated-initializers,
  -modernize-use-nodiscard,
  -modernize-use-std-print,
  -modernize-use-trailing-return-type,
  performance-*,
  portability-*,
  readability-*,
  -readability-identifier-length,
  -readability-magic-numbers,
  -readability-math-missing-parentheses,
  -readability-uppercase-literal-suffix
`;

/**
 * The C sample's clang-tidy checks: as C++'s, with the SEI CERT C coding
 * standard (cert-*) in place of the C++ families, less unchecked printf
 * results (cert-err33-c) and implicit conversions to bool (`if (p)` is how
 * C says it).
 */
export const C_TIDY = `# clang-tidy's checks: the editor runs them as you type. Change them with
# Build settings > clang-tidy rules, or here: each line is a glob, and the
# last one that matches a check decides (- turns it off).
Checks: >-
  -*,
  bugprone-*,
  -bugprone-easily-swappable-parameters,
  cert-*,
  -cert-err33-c,
  concurrency-*,
  -concurrency-mt-unsafe,
  misc-*,
  -misc-no-recursion,
  performance-*,
  portability-*,
  readability-*,
  -readability-identifier-length,
  -readability-implicit-bool-conversion,
  -readability-magic-numbers,
  -readability-math-missing-parentheses,
  -readability-uppercase-literal-suffix
`;

/** How Format Document lays out C and C++ (clang-format, which clangd has built in): LLVM's style with the samples' four-space indent. */
export const CLANG_FORMAT = `# How Format Document lays out the code (clang-format's options:
# https://clang.llvm.org/docs/ClangFormatStyleOptions.html).
BasedOnStyle: LLVM
IndentWidth: 4
`;

/** C and C++ projects' configuration files: clangd's, clang-tidy's and clang-format's. */
export const C_FAMILY_CONFIG: readonly string[] = ['compile_flags.txt', 'compile_commands.json', '.clangd', '.clang-tidy', '.clang-format'];

/** C's body: the files of a new project, its server's settings and its build settings. */
const C: PackLanguageBody = {
	sample: {
		'main.c': `#include <stdio.h>

#include "geometry.h"

int main(void) {
    const struct point a = {0.0, 0.0};
    const struct point b = {3.0, 4.0};
    printf("%f\\n", point_distance(a, b));
    printf("%f\\n", point_norm(b));
    return 0;
}
`,
		'geometry.h': `#ifndef GEOMETRY_H
#define GEOMETRY_H

/// A point in the plane.
struct point {
    double x;
    double y;
};

/// Distance from the origin.
double point_norm(struct point p);

/// Euclidean distance between two points.
double point_distance(struct point a, struct point b);

#endif
`,
		'geometry.c': `#include "geometry.h"

#include <math.h>

double point_norm(struct point p) { return hypot(p.x, p.y); }

double point_distance(struct point a, struct point b) {
    return hypot(a.x - b.x, a.y - b.y);
}
`,
		'compile_flags.txt': `-std=c23
-Wall
-Wextra
-I.
`,
		'.clang-tidy': C_TIDY,
		'.clang-format': CLANG_FORMAT,
	},
	serverSettings: {},
	properties: cFamilyModel('c'),
	configFiles: C_FAMILY_CONFIG,
};

/** C++'s body: the files of a new project, its server's settings and its build settings. */
const CPP: PackLanguageBody = {
	sample: {
		'main.cpp': `#include <cstdio>
#include <vector>

#include "geometry.h"

int main() {
    std::vector<Point> points{{0, 0}, {3, 4}};
    std::printf("%f\\n", distance(points[0], points[1]));
    std::printf("%f\\n", points[1].norm());
    return 0;
}
`,
		'geometry.h': `#pragma once

/// A point in the plane.
struct Point {
    double x;
    double y;

    /// Distance from the origin.
    double norm() const;
};

/// Euclidean distance between two points.
double distance(const Point &a, const Point &b);
`,
		'geometry.cpp': `#include "geometry.h"

#include <cmath>

double Point::norm() const { return std::hypot(x, y); }

double distance(const Point &a, const Point &b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}
`,
		'tests/geometry_test.cpp': `#include <gtest/gtest.h>

#include "geometry.h"

TEST(Geometry, NormOfThreeFourIsFive) {
    const Point p{3, 4};
    EXPECT_DOUBLE_EQ(p.norm(), 5.0);
}

TEST(Geometry, DistanceIsSymmetric) {
    const Point a{1, 2};
    const Point b{-2, 6};
    EXPECT_DOUBLE_EQ(distance(a, b), distance(b, a));
    EXPECT_DOUBLE_EQ(distance(a, b), 5.0);
}

TEST(Geometry, DistanceToItselfIsZero) {
    const Point a{1.5, -2.5};
    EXPECT_EQ(distance(a, a), 0.0);
}
`,
		'compile_flags.txt': `-std=c++23
-Wall
-Wextra
-I.
`,
		'.clang-tidy': CPP_TIDY,
		'.clang-format': CLANG_FORMAT,
	},
	serverSettings: {},
	properties: cFamilyModel('cpp'),
	configFiles: C_FAMILY_CONFIG,
};

/** Every language of the package's body, by key. */
export const BODIES = { c: C, cpp: CPP } as const;
