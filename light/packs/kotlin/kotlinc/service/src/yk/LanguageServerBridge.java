package yk;

import org.eclipse.lsp4j.jsonrpc.RemoteEndpoint;
import org.eclipse.lsp4j.jsonrpc.json.JsonRpcMethod;
import org.eclipse.lsp4j.jsonrpc.json.MessageJsonHandler;
import org.eclipse.lsp4j.jsonrpc.services.ServiceEndpoints;
import org.eclipse.lsp4j.services.LanguageClient;
import org.javacs.kt.KotlinLanguageServer;
import org.javacs.kt.util.SingleThread;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * fwcd/kotlin-language-server (../kls/, patched there to start no thread) behind a function call:
 * one JSON-RPC message in, the messages it answers with out, all on the caller's thread. A
 * request's response is among what the call that delivered it returns, because the server's async
 * work runs at once (SingleThread); debounced work (re-analysing a changed file) waits for
 * {@link #idle}. Requests the server sends the client (none it needs answered: the client's
 * capabilities ask for no progress or configuration) go out like any other message.
 *
 * The server analyses for the JVM against the class path it is given, without a JDK: what a
 * Kotlin/Wasm program sees is the common standard library, whose JVM jar is the nearest thing a
 * JVM analysis can read. kotlinc's Kotlin/Wasm checks stay the diagnostics of record.
 */
public final class LanguageServerBridge {
    private final MessageJsonHandler json;
    private final RemoteEndpoint endpoint;
    private final KotlinLanguageServer server;
    /**
     * Whether the index of the class path's declarations (what completion offers with an import)
     * has been built. The server builds it when initialize finds files on disk; here the files
     * arrive by didOpen, so the first idle() after one builds it.
     */
    private boolean indexed;
    /** The messages the current call has produced, as a JSON array's elements. */
    private final StringBuilder out = new StringBuilder();

    /** Starts a server that analyses against classPath (paths separated by ':'). */
    public LanguageServerBridge(String classPath) {
        System.setProperty("kotlinLanguageServer.singleThreaded", "true");
        System.setProperty("kotlinLanguageServer.noJdk", "true");
        System.setProperty("kotlinLanguageServer.classPath", classPath);
        if (!SingleThread.getEnabled()) throw new IllegalStateException("SingleThread was initialised before the bridge set its property");
        server = new KotlinLanguageServer();
        Map<String, JsonRpcMethod> methods = new LinkedHashMap<>(ServiceEndpoints.getSupportedMethods(LanguageClient.class));
        methods.putAll(ServiceEndpoints.getSupportedMethods(server.getClass()));
        json = new MessageJsonHandler(methods);
        endpoint = new RemoteEndpoint(message -> {
            if (out.length() > 0) out.append(',');
            out.append(json.serialize(message));
        }, ServiceEndpoints.toEndpoint(server));
        json.setMethodProvider(endpoint);
        server.connect(ServiceEndpoints.toServiceObject(endpoint, LanguageClient.class));
    }

    /** Delivers one message; returns what the server sent meanwhile, as a JSON array. */
    public String handle(String message) {
        out.setLength(0);
        endpoint.consume(json.parseMessage(message));
        return "[" + out + "]";
    }

    /** Runs the work the server deferred; returns what it sent meanwhile, as a JSON array. */
    public String idle() {
        out.setLength(0);
        SingleThread.runPending();
        if (!indexed && !server.getSourcePath().all(false).isEmpty()) {
            indexed = true;
            SingleThread.runLogged(() -> { server.getSourcePath().refreshDependencyIndexes(); return kotlin.Unit.INSTANCE; });
        }
        return "[" + out + "]";
    }
}
