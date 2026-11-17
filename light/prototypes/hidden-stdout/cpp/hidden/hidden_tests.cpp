// The teacher's hidden tests. run_tests takes the student's solve, which is
// either the function itself (one process) or a stub that calls it over RPC.
#include <chrono>
#include <numeric>
#include "hidden_tests.h"

namespace {
struct Case {
    const char* name;
    std::vector<std::int64_t> xs;
    std::int64_t expected;
    const char* message;
};

std::vector<std::int64_t> range(std::int64_t n) {
    std::vector<std::int64_t> v(n);
    std::iota(v.begin(), v.end(), 0);
    return v;
}

constexpr std::int64_t N = 200000;
}  // namespace

void run_tests(const Solve& solve, std::FILE* v) {
    const Case cases[] = {
        {"small", {3, 1, 424242}, 1769512, "canary-test-c0de: small mixed input"},
        {"repeat", {7, 7, 7, 7}, 1945220, "repeated input"},
        {"range", range(1000), 497660294, "the first thousand"},
    };
    for (const auto& c : cases) {
        try {
            std::fprintf(v, "%s %s\n", c.name, solve(c.xs) == c.expected ? "pass" : "fail");
        } catch (const std::exception&) {
            std::fprintf(v, "%s error\n", c.name);
        }
        std::fflush(v);
    }
    auto xs = range(N);
    auto ws = weight_many(xs);
    auto expected = std::accumulate(ws.begin(), ws.end(), std::int64_t{0});
    auto start = std::chrono::steady_clock::now();
    auto got = solve(xs);
    std::chrono::duration<double> seconds = std::chrono::steady_clock::now() - start;
    std::fprintf(v, "perf %s n=%lld seconds=%.6f\n", got == expected ? "pass" : "fail", static_cast<long long>(N), seconds.count());
}
