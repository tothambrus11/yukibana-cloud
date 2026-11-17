#pragma once
#include <cstdio>
#include <functional>
#include "hidden_lib.h"

using Solve = std::function<std::int64_t(const std::vector<std::int64_t>&)>;
void run_tests(const Solve& solve, std::FILE* verdicts);
