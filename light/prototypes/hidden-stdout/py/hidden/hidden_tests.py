"""The teacher's hidden tests. `run` takes the student's `solve`, which is
either the function itself (one process) or a stub that calls it over RPC."""

import time

import hidden_lib

N = 200_000
CASES = [
    ('small', [3, 1, 424242], 1769512, 'canary-test-c0de: small mixed input'),
    ('repeat', [7, 7, 7, 7], 1945220, 'repeated input'),
    ('range', list(range(1000)), 497660294, 'the first thousand'),
]


def run(solve, report):
    for name, xs, expected, message in CASES:
        try:
            got = solve(xs)
            report(f'{name} {"pass" if got == expected else "fail"}')
        except Exception as e:  # the student's error, not the test's
            report(f'{name} error {type(e).__name__}')
    xs = list(range(N))
    expected = sum(hidden_lib.weight_many(xs))
    start = time.perf_counter()
    got = solve(xs)
    seconds = time.perf_counter() - start
    report(f'perf {"pass" if got == expected else "fail"} n={N} seconds={seconds:.6f}')
