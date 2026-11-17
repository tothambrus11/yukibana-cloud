# The exercise every language implements

The same exercise in every language, so that the leak matrix and the
timings compare like with like.

**Hidden library** `hidden_lib` (the teacher's, never shipped to students):

* `weight(n: i64) -> i64` = `((n * 2654435761) ^ SECRET) mod 1000003`, with
  `SECRET = 99357415` (`0x5ec12e7`), and an error message that holds the
  string `canary-library-c4e1` for `n < 0`.
* `weight_many(xs: i64[]) -> i64[]`, the same for many at once: the batched
  form of the API that a teacher can offer when calls are many.

**Student** `solve(xs: i64[]) -> i64` = the sum of `weight(x)`. `honest`
calls `weight` once per element, `batched` calls `weight_many` once,
`attack` tries to print everything hidden it can reach.

**Hidden tests** (the teacher's), each a call to `solve` compared with a
literal:

| test | input | expected |
|---|---|---|
| `small` | `[3, 1, 424242]` | `1769512`, message `canary-test-c0de` |
| `repeat` | `[7, 7, 7, 7]` | `1945220` |
| `range` | `0..999` | `497660294` |
| `perf` | `0..N-1`, `N = 200000` | computed by the harness from the library, timed |

## The canaries

What `measure.py` looks for in what the student can see (stdout and
stderr of the student's code, also after decoding any base64 in it):

| canary | what it stands for |
|---|---|
| `canary-library-c4e1` | the hidden library's source or binary |
| `99357415` or `5ec12e7` | a constant inside the hidden library (its secret) |
| `canary-test-c0de` | the hidden tests' source or binary |
| `1769512` or its little-endian bytes | an expected value of a hidden test |
| `424242` | an input of a hidden test |

## The RPC frame (split runs)

Both directions use the same frame, little-endian, over two FIFOs:
`u8 kind` (1 call, 2 return, 3 error), `u8 fn` (1 `solve`, 2 `weight`,
3 `weight_many`), two zero bytes, `u32 count`, then `count` × `i64`. An
error frame has no payload: the side that failed prints its own error where
its own output goes, which for the student is what they can see. Either side may call while it waits for a return (the tests
call `solve`, which calls `weight` back), so waiting means: read frames,
serve every call, until the return arrives.
