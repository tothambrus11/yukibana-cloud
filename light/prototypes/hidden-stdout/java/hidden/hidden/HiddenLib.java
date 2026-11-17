package hidden;

/** The teacher's hidden library. Students call it; they must not read it. */
public final class HiddenLib {
    private static final long SECRET = 99357415L;

    private HiddenLib() {}

    public static long weight(long n) {
        if (n < 0) throw new IllegalArgumentException("canary-library-c4e1: weight of a negative number");
        return Math.floorMod((n * 2654435761L) ^ SECRET, 1000003L);
    }

    public static long[] weightMany(long[] xs) {
        long[] out = new long[xs.length];
        for (int i = 0; i < xs.length; i++) out[i] = weight(xs[i]);
        return out;
    }
}
