package yk;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.jetbrains.kotlin.library.abi.*;

/**
 * Writes a klib's public API as kotlinc's ABI dump (the text the Binary Compatibility Validator
 * keeps), followed by one "// deprecated: <signature>" line per declaration annotated
 * @Deprecated, which the dump leaves out. ../../../scripts/stdlib-index.mjs turns the standard
 * library's and kotlin.test's into the index the language server completes their names from.
 * Usage: DumpAbi <klib> <out>
 */
public final class DumpAbi {
    static final AbiSignatureVersion V2 = AbiSignatureVersion.Companion.resolveByVersionNumber(2);

    public static void main(String[] a) throws IOException {
        LibraryAbi abi = LibraryAbiReader.INSTANCE.readAbiInfo(new File(a[0]), List.of());
        try (Writer out = new OutputStreamWriter(new FileOutputStream(a[1]), StandardCharsets.UTF_8)) {
            LibraryAbiRenderer.INSTANCE.render(abi, out, new AbiRenderingSettings(V2, false, true, "    ", (d, v) -> ""));
            deprecated(abi.getTopLevelDeclarations(), out);
        }
    }

    static void deprecated(AbiDeclarationContainer c, Writer out) throws IOException {
        for (AbiDeclaration d : c.getDeclarations()) {
            for (AbiAnnotation an : d.annotatedWith()) {
                if (an.getQualifiedName().toString().equals("kotlin/Deprecated")) out.write("// deprecated: " + d.getSignatures().get(V2) + "\n");
            }
            if (d instanceof AbiDeclarationContainer inner) deprecated(inner, out);
        }
    }
}
