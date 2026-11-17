#include <numeric>
#include "hidden_lib.h"

std::int64_t solve(const std::vector<std::int64_t>& xs) {
    auto ws = weight_many(xs);
    return std::accumulate(ws.begin(), ws.end(), std::int64_t{0});
}
