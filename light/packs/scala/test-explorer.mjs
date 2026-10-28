// Headless test of the tree views' worker (explorer.js), run the way the app
// runs it: app/static served over http, `new Worker('/packs/scala/explorer.js',
// { type: 'module' })` in Chromium, the CONTRACT.md "Showing compiler output"
// messages. Checks that the typed tree shows what typer filled in, that the
// lowered tree is erased, that each printed line points at the source line it
// was printed from, and how errors and other files are answered.
//
//   node test-explorer.mjs        (after ./build.sh; needs playwright-core)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><link rel=icon href="data:,"><title>scala explorer test</title>');
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length }).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

await stat(join(STATIC, 'packs/scala/explorer.js')).catch(() => {
    console.error(`no ${join(STATIC, 'packs/scala/explorer.js')}: run ./build.sh first`);
    process.exit(2);
});

const MAIN = `@main def run(): Unit =
  val xs = List(1, 2, 3)
  for x <- xs do println(s"x = $x")
  val total = xs.map(_ * 2).sum
  println(total)
`;
const SHAPES = `trait Shape:
  def area: Double

case class Circle(r: Double) extends Shape:
  def area: Double = math.Pi * r * r

def biggest[T <: Shape](shapes: List[T]): Option[T] =
  shapes.maxByOption(_.area)
`;
const FILES = { 'Main.scala': MAIN, 'Shapes.scala': SHAPES };

const browser = await chromium.launch({ executablePath: CHROMIUM });
let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n${detail}`}`);
    if (!ok) failures++;
};

try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('[page error]', e.message));
    await page.goto(`${origin}/__test.html`);
    await page.evaluate(() => {
        const worker = new Worker('/packs/scala/explorer.js', { type: 'module' });
        const waiting = new Map();
        worker.onmessage = ({ data }) => {
            if (data.type === 'result') waiting.get(data.id)?.(data);
        };
        let id = 0;
        window.emitTree = (emit, files, path) => new Promise((done) => {
            waiting.set(++id, done);
            worker.postMessage({ type: 'emit', id, emit, files, path, options: {} });
        });
    });
    const emit = (kind, files, path) => page.evaluate(({ kind, files, path }) => window.emitTree(kind, files, path), { kind, files, path });
    /** The output lines that came from source line `line` of `file`. */
    const from = (r, file, line) => r.text.split('\n').filter((_, i) => r.lines[i]?.file === file && r.lines[i].line === line);

    const typed = await emit('typed', FILES, 'Main.scala');
    check('the typed tree of a file compiles', typed.ok, typed.error);
    check('the typed tree has one line mapping per line of text', typed.ok && typed.lines.length === typed.text.split('\n').length - 1);
    check('the typed tree shows the for loop as the foreach it is, on its source line',
        typed.ok && from(typed, 'Main.scala', 3).some((l) => /\.foreach/.test(l)), typed.text);
    check('the typed tree shows the inferred type of a val, on its source line',
        typed.ok && from(typed, 'Main.scala', 2).some((l) => /val xs: List\[Int\]/.test(l)), typed.text);
    check('the typed tree shows the string interpolator as a call',
        typed.ok && /StringContext/.test(typed.text), typed.text);
    check('the typed tree shows only the asked file', typed.ok && !/Circle/.test(typed.text));
    check('the typed tree names its phase in the flags', typed.ok && typed.flags.includes('-Vprint:typer'), JSON.stringify(typed.flags));

    const shapes = await emit('typed', FILES, 'Shapes.scala');
    check('the typed tree of a case class shows the members typer adds', shapes.ok && /def copy\(/.test(shapes.text), shapes.text);

    const lowered = await emit('lowered', FILES, 'Shapes.scala');
    check('the lowered tree compiles', lowered.ok, lowered.error);
    check('the lowered tree is erased: no type parameter is left on biggest',
        lowered.ok && /def biggest\(/.test(lowered.text) && !/def biggest\[/.test(lowered.text), lowered.text);
    check('the lowered tree maps the method to its source line',
        lowered.ok && from(lowered, 'Shapes.scala', 7).some((l) => /def biggest/.test(l)), lowered.text);

    const broken = await emit('typed', { 'Main.scala': '@main def run(): Unit =\n  val n: Int = "five"\n' }, 'Main.scala');
    check('a type error is answered with the compiler message, as the runner prints it',
        !broken.ok && /^Main\.scala:2:\d+: error: .*Found:.*String/s.test(broken.error), broken.error);

    const other = await emit('typed', { ...FILES, 'build.sbt': '' }, 'build.sbt');
    check('a file that is not Scala is refused, naming what to open', !other.ok && /open a \.scala file/.test(other.error), other.error);

    const unknown = await emit('asm', FILES, 'Main.scala');
    check('an output the pack does not make is refused', !unknown.ok && /Unknown output/.test(unknown.error), unknown.error);
} finally {
    await browser.close();
    server.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
