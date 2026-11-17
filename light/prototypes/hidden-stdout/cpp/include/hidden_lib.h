// The hidden library's interface: this header is part of the starter, the
// implementation is not. The student implements solve.
#pragma once
#include <cstdint>
#include <vector>

std::int64_t weight(std::int64_t n);
std::vector<std::int64_t> weight_many(const std::vector<std::int64_t>& xs);

std::int64_t solve(const std::vector<std::int64_t>& xs);
