#include <cstdio>
#include "hidden_lib.h"

static int calls = 0;

std::int64_t solve(const std::vector<std::int64_t>& xs) {
    if (++calls <= 3) {  // print debugging, the thing students should keep
        std::printf("debug: solve call %d got %zu numbers, starting", calls, xs.size());
        for (size_t i = 0; i < xs.size() && i < 3; i++) std::printf(" %lld", static_cast<long long>(xs[i]));
        std::printf("\n");
    }
    std::int64_t total = 0;
    for (auto x : xs) total += weight(x);
    return total;
}
