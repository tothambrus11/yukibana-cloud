// The teacher's hidden library. Students call it; they must not read it.
#include <stdexcept>
#include "hidden_lib.h"

static constexpr std::int64_t SECRET = 99357415;

std::int64_t weight(std::int64_t n) {
    if (n < 0) throw std::invalid_argument("canary-library-c4e1: weight of a negative number");
    return ((n * 2654435761LL) ^ SECRET) % 1000003;
}

std::vector<std::int64_t> weight_many(const std::vector<std::int64_t>& xs) {
    std::vector<std::int64_t> out;
    out.reserve(xs.size());
    for (auto x : xs) out.push_back(weight(x));
    return out;
}
