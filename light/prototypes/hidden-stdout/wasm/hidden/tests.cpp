// The teacher's hidden tests, in an instance of their own.
#include "../abi.h"
extern "C" {
IMPORT("env", "report") void report(const char* s, size_t n);
IMPORT("env", "now") double now();  // milliseconds
}

struct Case { const char* name; const i64* xs; size_t n; i64 expected; const char* message; };
static const i64 SMALL[] = {3, 1, 424242};
static const i64 REPEAT[] = {7, 7, 7, 7};
static i64 RANGE[1000];
static const Case CASES[] = {
    {"small", SMALL, 3, 1769512, "canary-test-c0de: small mixed input"},
    {"repeat", REPEAT, 4, 1945220, "repeated input"},
    {"range", RANGE, 1000, 497660294, "the first thousand"},
};
static const size_t N = 200000;
static i64 BIG[N];

static void say(const char* a, const char* b) {
    char line[128]; size_t k = 0;
    for (const char* p = a; *p; p++) line[k++] = *p;
    line[k++] = ' ';
    for (const char* p = b; *p && k < sizeof line; p++) line[k++] = *p;
    report(line, k);
}

extern "C" EXPORT("run") void run() {
    for (size_t i = 0; i < 1000; i++) RANGE[i] = i;
    for (const Case& c : CASES) say(c.name, solve(c.xs, c.n) == c.expected ? "pass" : c.message);
    i64 expected = 0;
    for (size_t i = 0; i < N; i++) BIG[i] = i, expected += weight(i);
    double start = now();
    i64 got = solve(BIG, N);
    double ms = now() - start;
    char line[64] = "perf pass n=200000 us=";
    if (got != expected) memcpy(line + 5, "fail", 4);
    size_t k = length(line);
    long long us = (long long)(ms * 1000);
    char d[24]; int i = 23; do { d[--i] = '0' + us % 10; us /= 10; } while (us);
    while (i < 23) line[k++] = d[i++];
    report(line, k);
}

#ifdef MONO
// One module: the tests' run is the entry point, everything shares one memory.
#endif
