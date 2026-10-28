// Unit tests of the bytecode view's class file listing (src/classfile.js)
// on class files a desktop javac wrote for tests/fixtures/sample.json
// (classes.jar), against what that JDK's javap printed for them
// (javap.txt; tests/fixtures/gen.sh makes both). No javac here.
//
//   node --test test-classfile.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { jarClasses, listClasses, methodType, parseClass, sourcePathOf } from './src/classfile.js';

const fixture = (name) => readFileSync(new URL(`tests/fixtures/${name}`, import.meta.url));
const files = Object.keys(JSON.parse(fixture('sample.json').toString()));
const classes = [...(await jarClasses(new Uint8Array(fixture('classes.jar')))).values()].map(parseClass);
const SHAPES = 'src/main/java/shapes/Shapes.java';
const rows = (out) => out.text.split('\n').map((text, i) => ({ text, map: out.lines[i] }));
/** The instruction lines of a listing or of javap's, spaces collapsed, switches left out (javap spreads them over lines). */
const instructions = (text) =>
    text
        .split('\n')
        .filter((l) => /^\s+\d+: /.test(l) && !/switch/.test(l) && !/^\s+-?\d+: \d+$/.test(l))
        .map((l) => l.replace(/\s+/g, ' ').trim());

test('with details, every instruction reads as javap -c -p prints it', () => {
    const ours = files.flatMap((p) => instructions(listClasses(classes, p, files, { details: true }).text));
    const javap = instructions(fixture('javap.txt').toString());
    assert.deepEqual([...ours].sort(), [...javap].sort());
});

test('every listing has one mapping per line, and maps only to the file shown', () => {
    for (const path of files)
        for (const details of [false, true]) {
            const out = listClasses(classes, path, files, { details });
            assert.equal(out.lines.length, out.text.split('\n').length, path);
            for (const m of out.lines) if (m) assert.equal(m.file, path);
        }
});

test('a file lists its own classes, nested and record classes included, and no other file’s', () => {
    const text = listClasses(classes, SHAPES, files).text;
    for (const c of ['shapes.Shapes {', 'shapes.Shapes$Circle {', 'shapes.Shapes$Square {', 'interface shapes.Shapes$Shape {']) assert.ok(text.includes(c), c);
    assert.ok(!text.includes('geometry.'));
    assert.match(listClasses(classes, 'src/main/java/geometry/Point.java', files).text, /^public final record geometry\.Point \{$/m);
});

test('each instruction maps to its source line by the LineNumberTable, a method to its first line', () => {
    const out = rows(listClasses(classes, SHAPES, files));
    const at = (pattern) => out.find((r) => pattern.test(r.text))?.map?.line;
    assert.equal(at(/static java\.lang\.String day\(int\);/), 20);
    assert.equal(at(/ldc\s+"Tue"/), 22);
    assert.equal(at(/iinc\s+2, 1/), 38);
    assert.equal(at(/multianewarray/), 44);
    assert.equal(at(/lambda\$twice\$0\(double\)/), 50);
});

test('without details a constant is shown by what it is, own members without their class', () => {
    const text = listClasses(classes, SHAPES, files).text;
    assert.match(text, /invokestatic\s+area:\(Lshapes\/Shapes\$Shape;\)D/);
    assert.match(text, /getstatic\s+java\/lang\/System\.out:Ljava\/io\/PrintStream;/);
    assert.match(text, /ldc2_w\s+3\.141592653589793d/);
    assert.match(text, /tableswitch\s+\{ 1: 28, 2: 31, 3: 34, default: 37 \}/);
    assert.doesNotMatch(text, /#\d+\s/);
    assert.doesNotMatch(text, /stack=/);
});

test('class files are found back to their source by package and name', () => {
    const point = classes.find((c) => c.name === 'geometry/Point');
    assert.equal(sourcePathOf(point, files), 'src/main/java/geometry/Point.java');
    assert.equal(sourcePathOf(point, ['Point.java']), 'Point.java');
    assert.equal(sourcePathOf(point, ['a/Point.java', 'b/Point.java']), null);
});

test('method descriptors read as Java types', () => {
    assert.deepEqual(methodType('(DD)V'), { params: ['double', 'double'], result: 'void' });
    assert.deepEqual(methodType('([Ljava/lang/String;[[I)Ljava/util/List;'), { params: ['java.lang.String[]', 'int[][]'], result: 'java.util.List' });
});

test('what is not a class file is refused', () => {
    assert.throws(() => parseClass(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /not a class file/);
});
