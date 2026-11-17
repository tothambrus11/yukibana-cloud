// Arrangement A: hidden tests, hidden library and the student's code in one
// binary, stripped. Usage: inproc VERDICTS
#include "hidden_tests.h"

int main(int, char** argv) {
    std::FILE* v = std::fopen(argv[1], "w");
    run_tests(solve, v);
    std::fclose(v);
}
