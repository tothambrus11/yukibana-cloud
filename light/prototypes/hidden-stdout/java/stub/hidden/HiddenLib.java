package hidden;

import rpc.Channel;

/** What the student's code finds as hidden.HiddenLib in a split run: the
 *  same methods, each one a call to the trusted process. */
public final class HiddenLib {
    public static Channel channel; // set by StudentHost before the first call

    private HiddenLib() {}

    private static long[] call(int fn, long[] values) {
        long[] r = channel.call(fn, values);
        if (r == null) throw new IllegalStateException("the grader went away");
        return r;
    }

    public static long weight(long n) { return call(Channel.WEIGHT, new long[] {n})[0]; }

    public static long[] weightMany(long[] xs) { return call(Channel.WEIGHT_MANY, xs); }
}
