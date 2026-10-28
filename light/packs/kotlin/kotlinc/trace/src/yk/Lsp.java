package yk;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Drives the language server through LanguageServerBridge on HotSpot, the way the pack's server
 * does in the browser: initialize, open the demo, then one request of each kind it forwards.
 * Prints each answer's first line. Run under native-image-agent, it traces what the server
 * reflects on. Usage: Lsp <class path> <demo dir>
 */
public final class Lsp {
    public static void main(String[] args) throws Exception {
        long t0 = System.nanoTime();
        LanguageServerBridge b = new LanguageServerBridge(args[0]);
        String uri = "file:///workspace/src/main/kotlin/Main.kt";
        String text = Files.readString(Path.of(args[1], "Main.kt")) + "\nfun more() {\n    val h = hyp\n    \"abc\".tr\n    listOf(1).ma\n}\n";
        int line = (int) text.lines().count() - 4; // the `val h = hyp` line, 0-based
        String[] messages = {
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"processId\":null,\"rootUri\":\"file:///workspace/\",\"capabilities\":{\"textDocument\":{\"completion\":{\"completionItem\":{\"snippetSupport\":true}},\"hover\":{\"contentFormat\":[\"markdown\"]}}}}}",
            "{\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{}}",
            "{\"jsonrpc\":\"2.0\",\"method\":\"workspace/didChangeConfiguration\",\"params\":{\"settings\":{\"kotlin\":{\"diagnostics\":{\"enabled\":false}}}}}",
            "{\"jsonrpc\":\"2.0\",\"method\":\"textDocument/didOpen\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\",\"languageId\":\"kotlin\",\"version\":1,\"text\":" + quote(text) + "}}}",
            request(10, "textDocument/completion", uri, line, 15),
            request(11, "textDocument/completion", uri, line + 1, 12),
            request(12, "textDocument/completion", uri, line + 2, 16),
            request(13, "textDocument/hover", uri, 5, 9),
            request(14, "textDocument/signatureHelp", uri, 5, 18),
            request(15, "textDocument/definition", uri, 8, 31),
            "{\"jsonrpc\":\"2.0\",\"id\":16,\"method\":\"textDocument/references\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\"},\"position\":{\"line\":0,\"character\":12},\"context\":{\"includeDeclaration\":true}}}",
            request(17, "textDocument/documentHighlight", uri, 5, 9),
            "{\"jsonrpc\":\"2.0\",\"id\":18,\"method\":\"textDocument/documentSymbol\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\"}}}",
            "{\"jsonrpc\":\"2.0\",\"id\":19,\"method\":\"textDocument/rename\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\"},\"position\":{\"line\":0,\"character\":12},\"newName\":\"Pt\"}}",
            "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"textDocument/codeAction\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\"},\"range\":{\"start\":{\"line\":" + line + ",\"character\":12},\"end\":{\"line\":" + line + ",\"character\":15}},\"context\":{\"diagnostics\":[]}}}",
            "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"textDocument/semanticTokens/full\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\"}}}",
            "{\"jsonrpc\":\"2.0\",\"method\":\"textDocument/didChange\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\",\"version\":2},\"contentChanges\":[{\"text\":" + quote(text + "val q = 1\n") + "}]}}",
            "{\"jsonrpc\":\"2.0\",\"id\":30,\"method\":\"shutdown\",\"params\":null}",
        };
        System.err.printf("[yk] started in %d ms%n", (System.nanoTime() - t0) / 1_000_000);
        for (String m : messages) {
            long t = System.nanoTime();
            String r = b.handle(m);
            String idle = b.idle();
            String method = m.replaceAll(".*?\"method\":\"([^\"]+)\".*", "$1");
            System.err.printf("[yk] %s: %d ms, %d chars: %s%n", method, (System.nanoTime() - t) / 1_000_000, r.length() + idle.length(), summary(r));
        }
    }

    static String request(int id, String method, String uri, int line, int character) {
        return "{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"method\":\"" + method + "\",\"params\":{\"textDocument\":{\"uri\":\"" + uri + "\"},\"position\":{\"line\":" + line + ",\"character\":" + character + "}}}";
    }

    /** The response in an answer, without log messages, cut short. */
    static String summary(String answer) {
        int at = answer.indexOf("\"id\":");
        String s = at < 0 ? answer.replaceAll("\\{\"jsonrpc\":\"2.0\",\"method\":\"window/logMessage\"[^}]*\\}\\},?", "") : answer.substring(Math.max(0, at - 1));
        return s.length() > 400 ? s.substring(0, 400) + "…" : s;
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                default -> b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
