/** The project every mode runs: a small library, its GoogleTest suite, and a main.cpp. */
export const FILES: Record<string, string> = {
	'compile_flags.txt': '-std=c++20\n-Wall\n-Wextra\n-I.\n',
	'bits.h': `#pragma once

/// The number of bits set in x.
int popcount(unsigned x);
/// Whether x is a power of two (0 is not).
bool is_power_of_two(unsigned x);
/// The smallest power of two not less than x (1 for 0).
unsigned next_power_of_two(unsigned x);
`,
	'bits.cpp': `#include "bits.h"

int popcount(unsigned x) {
    int n = 0;
    for (; x != 0; x &= x - 1) ++n;
    return n;
}

bool is_power_of_two(unsigned x) { return x != 0 && (x & (x - 1)) == 0; }

unsigned next_power_of_two(unsigned x) {
    unsigned p = 1;
    while (p < x) p <<= 1;
    return p;
}
`,
	'main.cpp': `#include <iostream>
#include <string>
#include <vector>

#include "bits.h"

int main() {
    std::vector<unsigned> xs{11, 64, 1000};
    for (unsigned x : xs) {
        std::cout << x << ": " << popcount(x) << " bits set"
                  << (is_power_of_two(x) ? ", a power of two" : "")
                  << ", next power of two " << next_power_of_two(x) << "\\n";
    }
}
`,
	'tests/bits_test.cpp': `#include <gtest/gtest.h>

#include "bits.h"

TEST(Bits, ZeroHasNoBits) { EXPECT_EQ(popcount(0), 0); }

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
};

/** A main.cpp printing about `megabytes` MB of output in 64-byte lines, for the throughput of a run's output. */
export const loud = (megabytes: number): string => `#include <cstdio>

int main() {
    for (long i = 0; i < ${megabytes} * 16384L; ++i) std::printf("%08ld the quick brown fox jumps over the lazy dog 0123456789\\n", i);
}
`;
