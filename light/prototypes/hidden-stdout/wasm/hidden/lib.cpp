// The teacher's hidden library, in an instance of its own.
#include "../abi.h"
static const i64 SECRET = 99357415;
extern "C" IMPORT("env", "fail") void fail(const char* s, size_t n);

extern "C" EXPORT("weight") i64 weight(i64 n) {
    if (n < 0) {
        static const char m[] = "canary-library-c4e1: weight of a negative number";
        fail(m, sizeof m - 1);
    }
    return ((n * 2654435761LL) ^ SECRET) % 1000003;
}
