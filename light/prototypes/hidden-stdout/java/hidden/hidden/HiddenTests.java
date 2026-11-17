package hidden;

import java.util.function.Consumer;
import java.util.function.ToLongFunction;
import java.util.stream.LongStream;

/** The teacher's hidden tests. `run` takes the student's solve, which is
 *  either the method itself (one JVM) or a stub that calls it over RPC. */
public final class HiddenTests {
    static final int N = 200_000;

    record Case(String name, long[] xs, long expected, String message) {}

    static final Case[] CASES = {
        new Case("small", new long[] {3, 1, 424242}, 1769512L, "canary-test-c0de: small mixed input"),
        new Case("repeat", new long[] {7, 7, 7, 7}, 1945220L, "repeated input"),
        new Case("range", LongStream.range(0, 1000).toArray(), 497660294L, "the first thousand"),
    };

    public static void run(ToLongFunction<long[]> solve, Consumer<String> report) {
        for (Case c : CASES) {
            try {
                report.accept(c.name() + (solve.applyAsLong(c.xs()) == c.expected() ? " pass" : " fail"));
            } catch (RuntimeException e) {
                report.accept(c.name() + " error " + e.getClass().getSimpleName());
            }
        }
        long[] xs = LongStream.range(0, N).toArray();
        long expected = LongStream.of(HiddenLib.weightMany(xs)).sum();
        long start = System.nanoTime();
        long got = solve.applyAsLong(xs);
        double seconds = (System.nanoTime() - start) / 1e9;
        report.accept(String.format("perf %s n=%d seconds=%.6f", got == expected ? "pass" : "fail", N, seconds));
    }
}
