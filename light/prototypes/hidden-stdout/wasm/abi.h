// The functions the three parts share. In the monolithic build (MONO) they
// are ordinary functions of one module and one memory; in the split build
// each part is its own instance, and what crosses is an import the host
// links: student -> lib.weight directly (wasm to wasm, no JS in between),
// tests -> student.solve through the host, which copies the array.
#pragma once
typedef long long i64;
typedef unsigned long size_t;

#ifdef MONO
#define IMPORT(module, name)
#define EXPORT(name)
#else
#define IMPORT(module, name) __attribute__((import_module(module), import_name(name)))
#define EXPORT(name) __attribute__((export_name(name)))
#endif

extern "C" {
IMPORT("lib", "weight") i64 weight(i64 n);
IMPORT("env", "print") void print(const char* s, size_t n);  // the student's stdout
IMPORT("student", "solve") i64 solve(const i64* xs, size_t n);
void* memcpy(void* d, const void* s, size_t n);
void* memset(void* d, int c, size_t n);
}

inline size_t length(const char* s) { size_t n = 0; while (s[n]) n++; return n; }
inline void print_str(const char* s) { print(s, length(s)); }
inline void print_i64(i64 v) {
    char b[24]; int i = 23; b[i] = 0; bool neg = v < 0; unsigned long long u = neg ? -(unsigned long long)v : v;
    do { b[--i] = '0' + u % 10; u /= 10; } while (u);
    if (neg) b[--i] = '-';
    print_str(b + i);
}
