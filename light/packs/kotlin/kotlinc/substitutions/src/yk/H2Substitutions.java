package yk;

import com.oracle.svm.core.annotate.Substitute;
import com.oracle.svm.core.annotate.TargetClass;

import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;

/*
 * H2, the database kotlin-language-server keeps its symbol index in, can open a file with an
 * AsynchronousFileChannel ("async:" paths). On Web Image that is jimfs's, whose shaded copy refers
 * to a Guava class Web Image does not ship, so the image fails to build. The index is an
 * in-memory database (jdbc:h2:mem:) that opens no file at all; this refuses the one way in.
 */
@TargetClass(className = "org.h2.store.fs.FilePathAsync")
final class Target_FilePathAsync {
    @Substitute
    @SuppressWarnings("unused")
    public FileChannel open(String mode) throws IOException {
        throw new IOException("async: files are not supported in WebAssembly");
    }
}

/*
 * H2 keeps its messages and the like in org/h2/util/data.zip, inside its jar, which it reads with
 * a ZipInputStream: zlib, which Web Image does not have. ../build.sh copies data.zip's org/h2/res/
 * into the jar as resources of their own, and this reads them from there.
 */
@TargetClass(className = "org.h2.util.Utils")
final class Target_org_h2_util_Utils {
    @Substitute
    private static byte[] loadResource(String name) throws IOException {
        try (InputStream in = ClassLoader.getSystemResourceAsStream(name.startsWith("/") ? name.substring(1) : name)) {
            return in == null ? null : in.readAllBytes();
        }
    }
}
