import rpc.Channel;
import java.util.Map;

/** Arrangement C, the student's side, inside the sandbox; `hidden.HiddenLib`
 *  on its class path is the stub. Usage: StudentHost DOWN UP */
public final class StudentHost {
    public static void main(String[] args) throws Exception {
        Channel channel = new Channel(args[0], args[1], Map.of(Channel.SOLVE, xs -> new long[] {Solution.solve(xs)}), true);
        hidden.HiddenLib.channel = channel;
        channel.await();
        System.out.flush();
    }
}
