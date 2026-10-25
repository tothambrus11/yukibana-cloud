"""Unit tests of the bytecode view (runner/bytecode.py) in the CPython that
runs them: what each line is mapped to, which code objects are listed, and
that a file that does not compile says where. The text itself differs from
one CPython to the next (the browser's is 3.14), so it is checked only for
what every version shows.

    python3 -I test-bytecode.py
"""

import json
import os
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner"))
import bytecode  # noqa: E402

SAMPLE = """import math

class Circle:
    def __init__(self, r):
        self.r = r

    def area(self):
        return math.pi * self.r ** 2

def total(shapes):
    return sum(s.area() for s in shapes if s.r > 0)

print(total([Circle(1), Circle(2)]))
"""


def listing(source, **options):
    out = json.loads(bytecode.disassemble(source, "main.py", **options))
    if "error" in out:
        return out
    return {**out, "rows": list(zip(out["text"].split("\n"), out["lines"]))}


class BytecodeView(unittest.TestCase):
    def test_every_line_of_the_text_has_one_mapping(self):
        out = listing(SAMPLE)
        self.assertEqual(len(out["lines"]), len(out["text"].split("\n")))

    def test_each_function_class_and_generator_is_listed_under_its_name_at_its_line(self):
        rows = listing(SAMPLE)["rows"]
        headings = {text[:-1]: m["line"] for text, m in rows if text.endswith(":") and not text.startswith(" ") and m and m["column"] == 0}
        self.assertEqual(headings["<module>"], 1)
        self.assertEqual(headings["Circle"], 3)
        self.assertEqual(headings["Circle.__init__"], 4)
        self.assertEqual(headings["Circle.area"], 7)
        self.assertEqual(headings["total"], 10)
        self.assertEqual(headings["total.<locals>.<genexpr>"], 11)

    def test_the_power_in_area_maps_to_its_line_and_the_column_of_its_left_operand(self):
        rows = listing(SAMPLE)["rows"]
        power = [m for text, m in rows if "BINARY_OP" in text and "(**)" in text]
        self.assertEqual(len(power), 1)
        self.assertEqual((power[0]["line"], power[0]["column"]), (8, 26))

    def test_every_mapped_line_is_in_the_file_shown(self):
        for _, m in listing(SAMPLE)["rows"]:
            if m:
                self.assertEqual(m["file"], "main.py")
                self.assertGreaterEqual(m["line"], 1)
                self.assertLessEqual(m["line"], SAMPLE.count("\n"))

    def test_code_objects_are_named_without_their_address(self):
        text = listing(SAMPLE)["text"]
        self.assertNotIn(" at 0x", text)
        self.assertIn("<code object area, line 7>", text)

    def test_the_cache_entries_are_never_listed(self):
        self.assertNotIn("CACHE", listing(SAMPLE)["text"])

    def test_offsets_put_each_instruction_s_byte_offset_first(self):
        plain = listing(SAMPLE)["text"].split("\n")
        with_offsets = listing(SAMPLE, offsets=True)["text"].split("\n")
        self.assertEqual(len(plain), len(with_offsets))
        self.assertRegex(with_offsets[1], r"^\s*(L\d+:)?\s*0 RESUME")

    def test_a_syntax_error_names_the_file_line_and_column_and_nothing_is_listed(self):
        out = listing("def f(:\n    pass\n")
        self.assertRegex(out["error"], r"^main\.py:1:\d+: SyntaxError: ")

    def test_the_module_is_compiled_and_never_run(self):
        out = listing("raise SystemExit(3)\nprint('ran')\n")
        self.assertIn("RAISE_VARARGS", out["text"])


if __name__ == "__main__":
    unittest.main()
