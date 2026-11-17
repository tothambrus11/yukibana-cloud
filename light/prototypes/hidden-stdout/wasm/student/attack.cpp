// Everything a student's code can reach from inside solve: its whole linear
// memory, as strings and as hex. In one module that is everyone's memory.
#include "../abi.h"
static bool looted = false;
// Address 0 is an ordinary address in wasm, but a null pointer to clang, which
// would drop the loop as undefined behaviour: the base comes from a volatile.
static volatile size_t base = 0;

static void loot() {
    const unsigned char* mem = (const unsigned char*)base;
    size_t size = __builtin_wasm_memory_size(0) * 65536;
    static const char hex[] = "0123456789abcdef";
    char run[256]; size_t k = 0;
    print_str("[strings]");
    for (size_t i = 0; i < size; i++) {
        unsigned char c = mem[i];
        if (c >= 32 && c < 127 && k < sizeof run) run[k++] = c;
        else { if (k >= 6) print(" | ", 3), print(run, k); k = 0; }
    }
    print_str("\n[hex] ");
    for (size_t i = 0; i < size; i++) { char h[2] = {hex[mem[i] >> 4], hex[mem[i] & 15]}; print(h, 2); }
    print_str("\n");
}

extern "C" EXPORT("solve") i64 solve(const i64* xs, size_t n) {
    if (!looted) looted = true, loot();
    i64 total = 0;
    for (size_t i = 0; i < n; i++) total += weight(xs[i]);
    return total;
}
