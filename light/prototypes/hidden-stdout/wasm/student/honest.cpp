#include "../abi.h"
static int calls = 0;

extern "C" EXPORT("solve") i64 solve(const i64* xs, size_t n) {
    if (++calls <= 3) {
        print_str("debug: solve got ");
        print_i64(n);
        print_str(" numbers, starting");
        for (size_t i = 0; i < n && i < 3; i++) print_str(" "), print_i64(xs[i]);
        print_str("\n");
    }
    i64 total = 0;
    for (size_t i = 0; i < n; i++) total += weight(xs[i]);
    return total;
}
