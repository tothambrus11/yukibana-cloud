import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;

/** Arrangement A: hidden tests, hidden library and the student's code in
 *  one JVM. Usage: InProc VERDICTS */
public final class InProc {
    public static void main(String[] args) throws IOException {
        try (PrintWriter v = new PrintWriter(new FileWriter(args[0]), true)) {
            hidden.HiddenTests.run(Solution::solve, v::println);
        }
    }
}
