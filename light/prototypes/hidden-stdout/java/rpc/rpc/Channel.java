package rpc;

import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Map;
import java.util.function.Function;

/** The RPC frame of common/SPEC.md, the same on both sides. */
public final class Channel {
    public static final int CALL = 1, RETURN = 2, ERROR = 3;
    public static final int SOLVE = 1, WEIGHT = 2, WEIGHT_MANY = 3;

    private final InputStream in;
    private final OutputStream out;
    private final Map<Integer, Function<long[], long[]>> handlers;

    public Channel(String readPath, String writePath, Map<Integer, Function<long[], long[]>> handlers, boolean readFirst) throws IOException {
        // Both FIFOs block on open until the other end opens them.
        if (readFirst) {
            in = new BufferedInputStream(new FileInputStream(readPath), 1 << 16);
            out = new FileOutputStream(writePath);
        } else {
            out = new FileOutputStream(writePath);
            in = new BufferedInputStream(new FileInputStream(readPath), 1 << 16);
        }
        this.handlers = handlers;
    }

    public void close() throws IOException { out.close(); }

    void send(int kind, int fn, long[] values) {
        ByteBuffer b = ByteBuffer.allocate(8 + 8 * values.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put((byte) kind).put((byte) fn).putShort((short) 0).putInt(values.length);
        for (long v : values) b.putLong(v);
        try {
            out.write(b.array());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public long[] call(int fn, long[] values) {
        send(CALL, fn, values);
        return await();
    }

    /** Serve calls until a return arrives; null at the end of the stream. */
    public long[] await() {
        try {
            for (;;) {
                byte[] head = in.readNBytes(8);
                if (head.length < 8) return null;
                ByteBuffer h = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN);
                int kind = h.get(0), fn = h.get(1), count = h.getInt(4);
                ByteBuffer body = ByteBuffer.wrap(in.readNBytes(8 * count)).order(ByteOrder.LITTLE_ENDIAN);
                long[] values = new long[count];
                for (int i = 0; i < count; i++) values[i] = body.getLong();
                if (kind == CALL) {
                    long[] result;
                    try {
                        result = handlers.get(fn).apply(values);
                    } catch (RuntimeException e) {
                        e.printStackTrace();
                        send(ERROR, fn, new long[0]);
                        continue;
                    }
                    send(RETURN, fn, result);
                } else if (kind == RETURN) {
                    return values;
                } else {
                    throw new IllegalStateException("call " + fn + " failed on the other side");
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
