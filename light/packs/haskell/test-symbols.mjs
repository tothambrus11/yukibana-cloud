// Unit tests of the language server's pure parts (src/symbols.js and
// src/text.js): the nested outline from Yuki.hs's declarations, the
// workspace symbol search, the local bindings' inlay hints, and positions.
// No GHC: the inputs are what Yuki.hs answers, written out.
//
//   node --test test-symbols.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingHints, hasTypeVariables, matchScore, outlineSymbols, searchSymbols, SymbolKind } from './src/symbols.js';
import { characterOf, columnOf, lineMap, spanText } from './src/text.js';

const GEOMETRY = `module Geometry where

data Point = Point {px :: Double, py :: Double}
  deriving (Eq)

instance Show Point where
  show (Point x y) = show x ++ ", " ++ show y

class Shape a where
  area :: a -> Double
  area _ = 0
  name :: a -> String

norm :: Point -> Double
norm (Point x y) = sqrt (x * x + y * y)
`;
const span = (sl, sc, el, ec) => ({ file: '/workspace/Geometry.hs', sl, sc, el, ec });
// What Yuki.hs's 'outline' answers for GEOMETRY (in no particular order),
// with the method a deriving clause generates, at the clause.
const OUTLINE = [
    { name: 'norm', kind: 'value', span: span(15, 1, 15, 40), sel: span(15, 1, 15, 5) },
    { name: 'Point', kind: 'data', span: span(3, 1, 4, 17), sel: span(3, 6, 3, 11) },
    { name: 'Point', kind: 'constructor', span: span(3, 14, 3, 48), sel: span(3, 14, 3, 19) },
    { name: 'px', kind: 'field', span: span(3, 21, 3, 33), sel: span(3, 21, 3, 23) },
    { name: 'py', kind: 'field', span: span(3, 35, 3, 47), sel: span(3, 35, 3, 37) },
    { name: '==', kind: 'method', span: span(4, 13, 4, 15), sel: span(4, 13, 4, 15) },
    // What GHC also records as plain value bindings: the fields' selectors,
    // the instance's method, and a derived method at its deriving clause.
    { name: 'px', kind: 'value', span: span(3, 21, 3, 33), sel: span(3, 21, 3, 23) },
    { name: 'show', kind: 'value', span: span(7, 3, 7, 45), sel: span(7, 3, 7, 7) },
    { name: '==', kind: 'value', span: span(4, 13, 4, 15), sel: span(4, 13, 4, 15) },
    { name: '', kind: 'instance', span: span(6, 1, 7, 45), sel: span(6, 1, 7, 45) },
    { name: 'show', kind: 'method', span: span(7, 3, 7, 45), sel: span(7, 3, 7, 7) },
    { name: 'Shape', kind: 'class', span: span(9, 1, 12, 22), sel: span(9, 7, 9, 12) },
    { name: 'area', kind: 'signature', span: span(10, 3, 10, 22), sel: span(10, 3, 10, 7) },
    { name: 'area', kind: 'value', span: span(11, 3, 11, 13), sel: span(11, 3, 11, 7) },
    { name: 'name', kind: 'signature', span: span(12, 3, 12, 22), sel: span(12, 3, 12, 7) },
];
const TOPS = [
    { name: 'Point', kind: 'constructor', type: 'Point :: Double -> Double -> Point', span: span(3, 14, 3, 19) },
    { name: 'norm', kind: 'value', type: 'norm :: Point -> Double', span: span(15, 1, 15, 5) },
    { name: 'area', kind: 'value', type: 'area :: Shape a => a -> Double', span: span(10, 3, 10, 7) },
];
/** GHC spans as LSP ranges, as the server's rangeOf makes them for an unedited document. */
const range = (s) => ({ start: { line: s.sl - 1, character: s.sc - 1 }, end: { line: s.el - 1, character: s.ec - 1 } });
const outline = () => outlineSymbols(OUTLINE, TOPS, GEOMETRY, range);
/** A tree of symbols as `name` and `name [children]` strings. */
const shape = (list) => list.map((s) => (s.children ? `${s.name} [${shape(s.children).join(', ')}]` : s.name));

test('the outline nests constructors under their type, fields under their constructor, methods under their class and instance', () => {
    assert.deepEqual(shape(outline()), ['Point [Point [px, py]]', 'instance Show Point [show]', 'Shape [area, name]', 'norm']);
});

test('a type is a struct, a constructor a constructor with its type, a field a field with its type as written', () => {
    const [point] = outline();
    assert.equal(point.kind, SymbolKind.Struct);
    const con = point.children[0];
    assert.deepEqual([con.kind, con.detail], [SymbolKind.Constructor, 'Double -> Double -> Point']);
    assert.deepEqual(con.children.map((f) => [f.name, f.kind, f.detail]), [
        ['px', SymbolKind.Field, 'Double'],
        ['py', SymbolKind.Field, 'Double'],
    ]);
});

test("a function's detail is its type, and its selection is its name inside the whole binding", () => {
    const norm = outline().at(-1);
    assert.deepEqual([norm.kind, norm.detail], [SymbolKind.Function, 'Point -> Double']);
    assert.deepEqual(norm.selectionRange, { start: { line: 14, character: 0 }, end: { line: 14, character: 4 } });
    assert.deepEqual(norm.range.end, { line: 14, character: 39 });
});

test("a class's default method is listed once, as the method's signature", () => {
    const shapeClass = outline()[2];
    assert.deepEqual(shapeClass.children.map((m) => [m.name, m.kind, m.detail]), [
        ['area', SymbolKind.Method, 'Shape a => a -> Double'],
        ['name', SymbolKind.Method, ''],
    ]);
});

test('the bindings a deriving clause generates are not in the outline', () => {
    const names = JSON.stringify(outline());
    assert.ok(!names.includes('"=="'));
});

test('an instance is named by its head as written, over several lines too', () => {
    const text = 'instance\n  (Show a) =>\n    Show (Box a) where\n  show = undefined\n';
    const [inst] = outlineSymbols([{ name: '', kind: 'instance', span: span(1, 1, 4, 19), sel: span(1, 1, 4, 19) }], [], text, range);
    assert.equal(inst.name, 'instance (Show a) => Show (Box a)');
    assert.equal(inst.kind, SymbolKind.Interface);
});

test('every selection range is inside its range', () => {
    const inside = (s) => (s.range.start.line < s.selectionRange.start.line || (s.range.start.line === s.selectionRange.start.line && s.range.start.character <= s.selectionRange.start.character)) && (s.children ?? []).every(inside);
    assert.ok(outline().every(inside));
});

test('workspace symbols: the best match first, nested ones with their container, a miss left out', () => {
    const files = [{ uri: 'file:///workspace/Geometry.hs', symbols: outline() }];
    assert.deepEqual(
        searchSymbols(files, 'p').map((s) => [s.name, s.containerName ?? null]),
        [
            ['px', 'Point'],
            ['py', 'Point'],
            ['Point', null],
            ['Point', 'Point'],
            ['Shape', null],
            ['instance Show Point', null],
        ],
    );
    assert.deepEqual(searchSymbols(files, 'nrm').map((s) => s.name), ['norm']);
    assert.deepEqual(searchSymbols(files, 'zzz'), []);
    const [norm] = searchSymbols(files, 'norm');
    assert.deepEqual(norm.location, { uri: 'file:///workspace/Geometry.hs', range: range(span(15, 1, 15, 40)) });
});

test('workspace symbols: an empty query lists everything, up to the limit', () => {
    const files = [{ uri: 'file:///workspace/Geometry.hs', symbols: outline() }];
    assert.equal(searchSymbols(files, '').length, 10);
    assert.equal(searchSymbols(files, '', 3).length, 3);
});

test('a match is scored: exact, then ignoring case, prefix, part, letters in order', () => {
    assert.deepEqual(['distance', 'Distance', 'dist', 'DIST', 'tan', 'dst', 'xyz'].map((q) => matchScore(q, 'distance')), [0, 1, 2, 3, 4, 5, null]);
});

const MAIN = `main :: IO ()
main = do
  let a = Point 0 0
      b = Point 3 4
  line <- getLine
  print (go 3)
  where
    go k = k * 2
    sq :: Int -> Int
    sq x = x * x
`;
const at = (l, sc, ec) => ({ file: '/workspace/Main.hs', sl: l, sc, el: l, ec });
// What Yuki.hs's 'binds' answers for MAIN (sq has a signature, so it is
// not there): `line <- getLine` is an "arg", as GHC type checks the do
// block as `getLine >>= \line -> ...`, and so are go's and sq's arguments.
const BINDS = [
    { name: 'a', kind: 'let', sel: at(3, 7, 8), type: 'Point' },
    { name: 'b', kind: 'let', sel: at(4, 7, 8), type: 'Point' },
    { name: 'line', kind: 'arg', sel: at(5, 3, 7), type: 'String' },
    { name: 'go', kind: 'let', sel: at(8, 5, 7), type: 'Integer -> Integer' },
    { name: 'k', kind: 'arg', sel: at(8, 8, 9), type: 'Integer' },
    { name: 'x', kind: 'arg', sel: at(10, 8, 9), type: 'Int' },
];

test("inlay hints show a local binding's type after its name", () => {
    const hints = bindingHints(BINDS, MAIN, MAIN);
    assert.deepEqual(
        hints.map((h) => [h.position.line, h.position.character, h.label]),
        [
            [2, 7, ':: Point'],
            [3, 7, ':: Point'],
            [4, 6, ':: String'],
            [7, 6, ':: Integer -> Integer'],
        ],
    );
    assert.ok(hints.every((h) => h.kind === 1 && h.paddingLeft));
});

test("a let or where binding's hint writes the signature above it, in the binding's layout block; a <- binding's does not", () => {
    const hints = bindingHints(BINDS, MAIN, MAIN);
    assert.deepEqual(hints[0].textEdits, [{ range: { start: { line: 2, character: 6 }, end: { line: 2, character: 6 } }, newText: 'a :: Point\n      ' }]);
    assert.deepEqual(hints[3].textEdits, [{ range: { start: { line: 7, character: 4 }, end: { line: 7, character: 4 } }, newText: 'go :: Integer -> Integer\n    ' }]);
    assert.equal(hints[2].textEdits, undefined);
});

test("a lambda's or a case alternative's argument has no hint; a guard's <- binding has", () => {
    const text = 'f m = \\y -> case y of\n  Just z -> z\n  _ | Just w <- m -> w\n';
    const binds = [
        { name: 'y', kind: 'arg', sel: at(1, 8, 9), type: 'Maybe Int' },
        { name: 'z', kind: 'arg', sel: at(2, 8, 9), type: 'Int' },
        { name: 'w', kind: 'bind', sel: at(3, 12, 13), type: 'Int' },
    ];
    assert.deepEqual(bindingHints(binds, text, text).map((h) => h.label), [':: Int']);
});

test('no signature edit for a type with type variables, an operator, or a name defined infix', () => {
    const text = 'f = r\n  where\n    xs = []\n    x <+> y = x\n    a `op` b = a\n';
    const binds = [
        { name: 'xs', kind: 'let', sel: at(3, 5, 7), type: '[a]' },
        { name: '<+>', kind: 'let', sel: at(4, 7, 10), type: 'Int -> Int -> Int' },
        { name: 'op', kind: 'let', sel: at(5, 8, 10), type: 'Int -> Int -> Int' },
    ];
    const hints = bindingHints(binds, text, text);
    assert.equal(hints.length, 3);
    assert.ok(hints.every((h) => h.textEdits === undefined));
});

test('a hint follows its line when lines are added above, is dropped where the name is no longer written, and only the asked lines are answered', () => {
    const edited = MAIN.replace('main = do\n', 'main = do\n  print 1\n').replace('line <- getLine', 'ln <- getLine');
    const hints = bindingHints(BINDS, MAIN, edited);
    assert.deepEqual(hints.map((h) => [h.position.line, h.label]), [
        [8, ':: Integer -> Integer'],
    ]);
    // Lines 3 to 6 changed (the edit is in between): only `go`, after them, is placed.
    const moved = MAIN + '\nextra = 1\n';
    assert.deepEqual(bindingHints(BINDS, MAIN, moved, 3, 4).map((h) => h.position.line), [3, 4]);
});

test('type variables are told from type constructors, qualified names and literals', () => {
    assert.deepEqual(['a -> a', 'Map k v', '[Char]', 'Map.Map Int String', 'IO ()', "Maybe (Either String Int')", 'Proxy "x"'].map(hasTypeVariables), [true, true, false, false, false, false, false]);
});

test("positions: GHC's columns count code points and tab stops, LSP's characters UTF-16 units", () => {
    assert.equal(characterOf('\tx', 9), 1);
    assert.equal(columnOf('\tx', 1), 9);
    assert.equal(characterOf('😀x', 2), 2);
    assert.equal(columnOf('😀x', 2), 2);
});

test('the text of a span, on one line or over several', () => {
    assert.equal(spanText(GEOMETRY, span(3, 21, 3, 33)), 'px :: Double');
    assert.equal(spanText(GEOMETRY, span(9, 1, 10, 7)), 'class Shape a where\n  area');
    assert.equal(spanText(GEOMETRY, span(99, 1, 99, 2)), '');
});

test('line maps: unchanged lines keep or shift their number, changed ones have none', () => {
    const map = lineMap('a\nb\nc\nd', 'a\nB\nB2\nc\nd');
    assert.deepEqual([0, 1, 2, 3].map(map.forward), [0, -1, 3, 4]);
});
