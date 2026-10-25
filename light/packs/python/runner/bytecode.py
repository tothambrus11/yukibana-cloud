"""The Python pack's bytecode view (README, "The bytecode view";
../../CONTRACT.md, "Showing compiler output"): a file of the project
compiled by CPython, the interpreter Run runs, and its bytecode listed code
object by code object, each instruction mapped to the source position
CPython records for it (``co_positions``, PEP 657).

Pure: a function of the source text, no files read and nothing run (the
module is compiled, never executed). runner/explorer.js calls
``disassemble`` in Pyodide; test-bytecode.py calls it in the CPython it runs
under. Written for CPython 3.13 and later, whose ``dis`` names jump targets
by labels (``L1``); Pyodide 314 is CPython 3.14. 3.12 works too, with jumps
to offsets and no labels.
"""

import dis
import json
import re
import sys
import types

# A code object's repr, `<code object area at 0x7f…, file "main.py", line 7>`:
# its address changes with every compile, and its file is the one listed.
_CODE_REPR = re.compile(r'<code object (\S+) at 0x[0-9a-f]+, file "[^"]*", line (\d+)>')


def _code_objects(code):
    """``code`` and every code object nested in it (functions, classes,
    lambdas, comprehensions), depth first, in the order they appear in the
    source."""
    yield code
    nested = [c for c in code.co_consts if isinstance(c, types.CodeType)]
    for c in sorted(nested, key=lambda c: (c.co_firstlineno, c.co_qualname)):
        yield from _code_objects(c)


def _title(code):
    """What a code object's listing is headed with: ``<module>``, ``area``,
    ``Circle.area``, ``main.<locals>.<lambda>``."""
    return code.co_qualname


def disassemble(source, path, offsets=False):
    """The bytecode of ``source`` (the text of project file ``path``), as a
    JSON string ``{"text": ..., "lines": [...]}`` or, when it does not
    compile, ``{"error": ...}``.

    ``text`` lists each code object under its name (``Circle.area:``) and
    then its instructions, one a line: a jump target's label (``L1:``), the
    opcode and its argument as ``dis`` shows it (``LOAD_FAST 0 (self)``);
    with ``offsets``, each instruction's byte offset first. The inline
    caches (``CACHE``) are never shown: they are not instructions.

    ``lines`` has one entry per line of ``text``: ``{"file", "line",
    "column"}`` with ``column`` 1-based (0: CPython recorded none), or null.
    A code object's heading maps to its first line, column 0; an
    instruction to the position CPython records for it, which is null for
    the ones it makes up (a ``RESUME`` of a generator, the implicit
    ``return None``'s cleanup)."""
    try:
        code = compile(source, path, "exec", dont_inherit=True)
    except SyntaxError as e:
        where = f"{path}:{e.lineno or 0}:{e.offset or 0}"
        return json.dumps({"error": f"{where}: {type(e).__name__}: {e.msg}\n"})
    except ValueError as e:  # a null byte in the source
        return json.dumps({"error": f"{path}: ValueError: {e}\n"})
    text = []
    lines = []
    for i, co in enumerate(_code_objects(code)):
        if i:
            text.append("")
            lines.append(None)
        text.append(f"{_title(co)}:")
        lines.append({"file": path, "line": co.co_firstlineno, "column": 0} if co.co_firstlineno else None)
        for ins in dis.get_instructions(co):
            # `label` is 3.13's; 3.12 (CI's unit tests) has none and shows offsets in jumps.
            label = f"L{ins.label}:" if getattr(ins, "label", None) is not None else ""
            arg = "" if ins.arg is None else str(ins.arg)
            row = f"{label:<6}{ins.offset:>4} " if offsets else f"{label:<6}"
            shown = _CODE_REPR.sub(r"<code object \1, line \2>", ins.argrepr)
            row += f"{ins.opname:<24}{arg:>4}" + (f" ({shown})" if shown else "")
            text.append(row.rstrip())
            pos = ins.positions
            if pos is not None and pos.lineno:
                column = pos.col_offset + 1 if pos.col_offset is not None else 0
                lines.append({"file": path, "line": pos.lineno, "column": column})
            else:
                lines.append(None)
    return json.dumps({"text": "\n".join(text), "lines": lines, "version": "%d.%d" % sys.version_info[:2]})
