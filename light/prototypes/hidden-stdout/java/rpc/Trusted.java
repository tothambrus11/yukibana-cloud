import rpc.Channel;
import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** Arrangement C, the trusted side. Usage:
 *  Trusted SANDBOX HIDE_DIRS(colon-separated) STUDENT_CLASSPATH VERDICTS VISIBLE */
public final class Trusted {
    public static void main(String[] args) throws Exception {
        String sandbox = args[0], hide = args[1], studentCp = args[2], verdicts = args[3], visible = args[4];
        Path dir = Files.createTempDirectory("rpc-");
        dir.toFile().setReadable(true, false);
        dir.toFile().setExecutable(true, false);
        String down = dir.resolve("down").toString(), up = dir.resolve("up").toString();
        for (String p : List.of(down, up)) new ProcessBuilder("mkfifo", "-m", "666", p).inheritIO().start().waitFor();

        List<String> cmd = new java.util.ArrayList<>();
        cmd.add(sandbox);
        cmd.addAll(List.of(hide.split(":")));
        cmd.addAll(List.of("--", ProcessHandle.current().info().command().orElseThrow(), "-Xshare:auto", "-cp", studentCp, "StudentHost", down, up));
        ProcessBuilder pb = new ProcessBuilder(cmd).redirectErrorStream(true).redirectOutput(new File(visible)).redirectInput(ProcessBuilder.Redirect.from(new File("/dev/null")));
        pb.environment().clear();
        pb.environment().put("PATH", System.getenv("PATH"));
        pb.environment().put("LEAK_ENCODING", System.getenv().getOrDefault("LEAK_ENCODING", "plain"));
        Process child = pb.start();

        Channel channel = new Channel(up, down, Map.of(
            Channel.WEIGHT, v -> new long[] {hidden.HiddenLib.weight(v[0])},
            Channel.WEIGHT_MANY, hidden.HiddenLib::weightMany), false);
        try (PrintWriter v = new PrintWriter(new FileWriter(verdicts), true)) {
            hidden.HiddenTests.run(xs -> {
                long[] r = channel.call(Channel.SOLVE, xs);
                if (r == null) throw new IllegalStateException("the student process ended");
                return r[0];
            }, v::println);
        }
        channel.close();
        child.waitFor();
    }
}
