// Runs the wasm arrangement. mono: tests, library and student linked into
// one module with one memory. split: three instances, each with a memory of
// its own; the student can import nothing but lib.weight and env.print.
// Usage: node host.mjs mono|split HIDDEN_BUILD STUDENT_BUILD STUDENT VERDICTS VISIBLE
import fs from 'node:fs';
const [mode, hiddenBuild, studentBuild, student, verdicts, visible] = process.argv.slice(2);
const vfd = fs.openSync(verdicts, 'w');
const ofd = fs.openSync(visible, 'w');
const text = (mem, p, n) => Buffer.from(mem.buffer, p, Number(n)).toString('latin1');
const now = () => performance.now();
const compile = (dir, f) => new WebAssembly.Module(fs.readFileSync(`${dir}/${f}`));

let out = '';
const flush = () => { fs.writeSync(ofd, out); out = ''; };
const printTo = getMem => (p, n) => { out += text(getMem(), p, n); if (out.length > 1 << 16) flush(); };

if (mode === 'mono') {
  let mem;
  const inst = new WebAssembly.Instance(compile(hiddenBuild, `mono-${student}.wasm`), {
    env: {
      print: printTo(() => mem),
      report: (p, n) => fs.writeSync(vfd, text(mem, p, n) + '\n'),
      fail: (p, n) => { throw new Error(text(mem, p, n)); },
      now,
    },
  });
  mem = inst.exports.memory;
  inst.exports.run();
} else {
  const lib = new WebAssembly.Instance(compile(hiddenBuild, 'lib.wasm'), { env: { fail: () => { throw new Error('weight failed'); } } });
  let smem;
  const stu = new WebAssembly.Instance(compile(studentBuild, `student-${student}.wasm`), { lib: { weight: lib.exports.weight }, env: { print: printTo(() => smem) } });
  smem = stu.exports.memory;
  let tmem;
  const tests = new WebAssembly.Instance(compile(hiddenBuild, 'tests.wasm'), {
    lib: { weight: lib.exports.weight },
    env: { report: (p, n) => fs.writeSync(vfd, text(tmem, p, n) + '\n'), now, print: () => {} },
    // The one place an argument crosses: copied from the tests' memory into
    // the student's, as the component model's canonical ABI would.
    student: {
      solve: (p, n) => {
        stu.exports.reset();
        const bytes = Number(n) * 8;
        const q = stu.exports.alloc(bytes);
        new Uint8Array(smem.buffer, q, bytes).set(new Uint8Array(tmem.buffer, p, bytes));
        return stu.exports.solve(q, n);
      },
    },
  });
  tmem = tests.exports.memory;
  tests.exports.run();
}
flush();
