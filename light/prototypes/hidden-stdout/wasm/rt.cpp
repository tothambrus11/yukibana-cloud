#include "abi.h"
extern "C" void* memcpy(void* d, const void* s, size_t n) { auto* a = (char*)d; auto* b = (const char*)s; while (n--) *a++ = *b++; return d; }
extern "C" void* memset(void* d, int c, size_t n) { auto* a = (char*)d; while (n--) *a++ = (char)c; return d; }

// A bump allocator, so the host can put arguments in this instance's memory.
extern "C" char __heap_base;
static char* top = &__heap_base;
extern "C" EXPORT("alloc") void* alloc(size_t n) {
    char* p = top;
    top += (n + 15) & ~(size_t)15;
    unsigned long need = ((unsigned long)top + 65535) / 65536;
    unsigned long have = __builtin_wasm_memory_size(0);
    if (need > have) __builtin_wasm_memory_grow(0, need - have);
    return p;
}
extern "C" EXPORT("reset") void reset() { top = &__heap_base; }
