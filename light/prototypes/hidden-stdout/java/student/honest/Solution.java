import java.util.Arrays;

public final class Solution {
    static int calls = 0;

    public static long solve(long[] xs) {
        calls++;
        if (calls <= 3) // print debugging, the thing students should keep
            System.out.println("debug: solve call " + calls + " got " + xs.length + " numbers, starting " + Arrays.toString(Arrays.copyOf(xs, Math.min(3, xs.length))));
        long total = 0;
        for (long x : xs) total += hidden.HiddenLib.weight(x);
        return total;
    }
}
