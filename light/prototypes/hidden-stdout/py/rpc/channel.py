"""The RPC frame of common/SPEC.md, the same on both sides."""

import os
import struct
import sys
import traceback

HEADER = struct.Struct('<BBxxI')
CALL, RETURN, ERROR = 1, 2, 3
SOLVE, WEIGHT, WEIGHT_MANY = 1, 2, 3


class RemoteError(Exception):
    """The other side failed; it printed why where its own output goes."""


class Channel:
    def __init__(self, read_path: str, write_path: str, handlers, read_first: bool):
        # Both FIFOs block on open until the other end opens them, so the
        # two sides open them in the same order.
        if read_first:
            self.r = open(read_path, 'rb', buffering=1 << 16)
            self.w = os.open(write_path, os.O_WRONLY)
        else:
            self.w = os.open(write_path, os.O_WRONLY)
            self.r = open(read_path, 'rb', buffering=1 << 16)
        self.handlers = handlers

    def send(self, kind: int, fn: int, values) -> None:
        data = HEADER.pack(kind, fn, len(values)) + struct.pack(f'<{len(values)}q', *values)
        view = memoryview(data)
        while view:
            view = view[os.write(self.w, view):]

    def call(self, fn: int, values):
        self.send(CALL, fn, values)
        return self.wait()

    def wait(self):
        """Serve calls until a return arrives; None at the end of the stream."""
        while True:
            head = self.r.read(HEADER.size)
            if len(head) < HEADER.size:
                return None
            kind, fn, count = HEADER.unpack(head)
            values = list(struct.unpack(f'<{count}q', self.r.read(8 * count))) if count else []
            if kind == CALL:
                try:
                    result = self.handlers[fn](values)
                except Exception:
                    traceback.print_exc()
                    sys.stderr.flush()
                    self.send(ERROR, fn, [])
                else:
                    self.send(RETURN, fn, result)
            elif kind == RETURN:
                return values
            else:
                raise RemoteError(f'call {fn} failed on the other side')
