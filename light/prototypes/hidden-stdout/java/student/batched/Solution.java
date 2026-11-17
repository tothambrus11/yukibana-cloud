public final class Solution {
    public static long solve(long[] xs) {
        long total = 0;
        for (long w : hidden.HiddenLib.weightMany(xs)) total += w;
        return total;
    }
}
