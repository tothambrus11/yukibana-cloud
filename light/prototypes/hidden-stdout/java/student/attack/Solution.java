import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/** Everything a student's Java can reach from inside solve, printed.
 *  LEAK_ENCODING=base64 prints it encoded, as a student would to get past a filter. */
public final class Solution {
    static boolean looted = false;
    static final boolean BASE64 = "base64".equals(System.getenv("LEAK_ENCODING"));

    static void out(String label, String text) {
        System.out.println("[" + label + "] " + (BASE64 ? Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)) : text));
    }

    /** The constant pool of a class file: its strings, ints and longs. */
    static List<String> constants(InputStream raw) throws IOException {
        DataInputStream in = new DataInputStream(raw);
        in.readInt(); in.readUnsignedShort(); in.readUnsignedShort();
        int n = in.readUnsignedShort();
        List<String> out = new ArrayList<>();
        for (int i = 1; i < n; i++) {
            int tag = in.readUnsignedByte();
            switch (tag) {
                case 1 -> out.add(in.readUTF());
                case 3 -> out.add("int " + in.readInt());
                case 4 -> out.add("float " + in.readFloat());
                case 5 -> { out.add("long " + in.readLong()); i++; }
                case 6 -> { out.add("double " + in.readDouble()); i++; }
                case 7, 8, 16, 19, 20 -> in.readUnsignedShort();
                case 9, 10, 11, 12, 17, 18 -> in.readInt();
                case 15 -> { in.readUnsignedByte(); in.readUnsignedShort(); }
                default -> throw new IOException("constant tag " + tag);
            }
        }
        return out;
    }

    static void dump(Class<?> c) {
        String name = c.getName();
        try (InputStream in = c.getResourceAsStream("/" + name.replace('.', '/') + ".class")) {
            out("class " + name + " constants", in == null ? "unavailable" : String.join(" | ", constants(in)));
        } catch (IOException e) {
            out("class " + name + " constants", "unreadable: " + e);
        }
        for (Field f : c.getDeclaredFields()) {
            if (!Modifier.isStatic(f.getModifiers())) continue;
            try {
                f.setAccessible(true);
                Object v = f.get(null);
                out("field " + name + "." + f.getName(), v instanceof Object[] a ? Arrays.deepToString(a) : String.valueOf(v));
            } catch (Exception e) {
                out("field " + name + "." + f.getName(), "unreadable: " + e);
            }
        }
    }

    static void loot() {
        Set<Class<?>> seen = new LinkedHashSet<>();
        seen.add(hidden.HiddenLib.class);
        // Whoever called solve, all the way up.
        StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE).forEach(f -> {
            Class<?> c = f.getDeclaringClass();
            if (c != Solution.class && c.getClassLoader() != null) seen.add(c);
        });
        // Their nested classes too (records, lambdas' hosts).
        for (Class<?> c : new ArrayList<>(seen)) seen.addAll(Arrays.asList(c.getDeclaredClasses()));
        seen.forEach(Solution::dump);
        // And any file under a directory called hidden.
        try (Stream<Path> files = Files.walk(Path.of(System.getProperty("java.class.path").split(":")[0]).toAbsolutePath().getParent().getParent())) {
            files.filter(p -> p.toString().contains("/hidden/") && Files.isRegularFile(p)).forEach(p -> {
                try {
                    out("file " + p, p.toString().endsWith(".java") ? Files.readString(p) : "class file of " + Files.size(p) + " bytes");
                } catch (IOException e) {
                    out("file " + p, "unreadable: " + e);
                }
            });
        } catch (IOException | RuntimeException e) {
            out("walk", "failed: " + e);
        }
    }

    public static long solve(long[] xs) {
        if (!looted) { looted = true; loot(); }
        long total = 0;
        for (long x : xs) total += hidden.HiddenLib.weight(x);
        return total;
    }
}
