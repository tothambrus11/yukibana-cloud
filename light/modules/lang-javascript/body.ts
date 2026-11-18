/**
 * The bodies of JavaScript, TypeScript and the web languages: what a host
 * loads when a language is first used (Light imports them with the page):
 * the sample projects, whose files refer to each other on purpose, the
 * server's settings and the build settings, of which there are none.
 */
import { NO_PROPERTIES, type PackLanguageBody } from '../std/index.ts';

/** JavaScript's body: the files of a new project, its server's settings and its build settings. */
const JAVASCRIPT: PackLanguageBody = {
	sample: {
		'main.js': `// @ts-check
import { Point, distance } from './geometry.js';

const a = new Point(0, 0);
const b = new Point(3, 4);
console.log(\`\${a} to \${b}: \${distance(a, b)}\`);
console.log(a.norm().toFixed(2));
`,
		'geometry.js': `// @ts-check

/** A point in the plane. */
export class Point {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /** Distance from the origin. */
  norm() {
    return Math.hypot(this.x, this.y);
  }

  toString() {
    return \`(\${this.x}, \${this.y})\`;
  }
}

/**
 * Euclidean distance between two points.
 * @param {Point} a
 * @param {Point} b
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
`,
		'tests/geometry.test.js': `// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Point, distance } from '../geometry.js';

const coordinate = fc.double({ min: -1e9, max: 1e9, noNaN: true });
const point = fc.tuple(coordinate, coordinate).map(([x, y]) => new Point(x, y));

describe('Point', () => {
  it('has norm 5 at (3, 4)', () => {
    assert.equal(new Point(3, 4).norm(), 5);
  });

  it('prints as a pair', () => {
    assert.equal(String(new Point(1, 2)), '(1, 2)');
  });
});

describe('distance', () => {
  it('is symmetric', () => {
    fc.assert(fc.property(point, point, (a, b) => distance(a, b) === distance(b, a)));
  });

  it('is 0 from a point to itself', () => {
    const p = new Point(7, -3);
    assert.equal(distance(p, p), 0);
  });
});
`,
		'jsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "es2022",
    "checkJs": true,
    "strict": true
  }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** TypeScript's body: the files of a new project, its server's settings and its build settings. */
const TYPESCRIPT: PackLanguageBody = {
	sample: {
		'main.ts': `import { Point, distance, type Shape, area } from './geometry.ts';

const a = new Point(0, 0);
const b = new Point(3, 4);
console.log(\`\${a} to \${b}: \${distance(a, b)}\`);

const shapes: Shape[] = [
  { kind: 'circle', radius: 1 },
  { kind: 'square', side: 2 },
];
for (const shape of shapes) console.log(shape.kind, area(shape).toFixed(2));
`,
		'geometry.ts': `/** A point in the plane. */
export class Point {
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** Distance from the origin. */
  norm(): number {
    return Math.hypot(this.x, this.y);
  }

  toString(): string {
    return \`(\${this.x}, \${this.y})\`;
  }
}

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A shape, told apart by its \`kind\`. */
export type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number };

/** The area of a shape; the switch covers every kind, which TypeScript checks. */
export function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius ** 2;
    case 'square':
      return shape.side ** 2;
  }
}
`,
		'tests/geometry.test.ts': `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Point, area, distance } from '../geometry.ts';

const coordinate = fc.double({ min: -1e9, max: 1e9, noNaN: true });
const point = fc.tuple(coordinate, coordinate).map(([x, y]) => new Point(x, y));

describe('Point', () => {
  it('has norm 5 at (3, 4)', () => {
    assert.equal(new Point(3, 4).norm(), 5);
  });

  it('prints as a pair', () => {
    assert.equal(String(new Point(1, 2)), '(1, 2)');
  });
});

describe('distance and area', () => {
  it('distance is symmetric', () => {
    fc.assert(fc.property(point, point, (a, b) => distance(a, b) === distance(b, a)));
  });

  it('a square of side 3 has area 9', () => {
    assert.equal(area({ kind: 'square', side: 3 }), 9);
  });
});
`,
		'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true
  }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Web (HTML, CSS, TypeScript)'s body: the files of a new project, its server's settings and its build settings. */
const WEB: PackLanguageBody = {
	sample: {
		'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Counter</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main>
      <h1>Hello from TypeScript</h1>
      <p>You clicked <output id="count">0</output> times.</p>
      <button id="increment" type="button">Click me</button>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`,
		'style.css': `:root {
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
}

main {
  max-width: 32rem;
  margin: 3rem auto;
  padding: 0 1rem;
}

h1 {
  color: #2f7d5b;
}

button {
  font: inherit;
  padding: 0.4rem 1rem;
}
`,
		'main.ts': `import { Counter } from './counter.ts';

const output = document.querySelector<HTMLOutputElement>('#count')!;
const button = document.querySelector<HTMLButtonElement>('#increment')!;
const counter = new Counter();

button.addEventListener('click', () => {
  output.value = String(counter.increment());
  console.log(\`clicked \${counter.value} times\`);
});
console.log('page ready');
`,
		'counter.ts': `/** Counts clicks. */
export class Counter {
  #value = 0;

  /** How many times \`increment\` was called. */
  get value(): number {
    return this.#value;
  }

  /** Adds one and returns the new value. */
  increment(): number {
    return ++this.#value;
  }
}
`,
		'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true
  }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Web: p5.js sketch (TypeScript)'s body: the files of a new project, its server's settings and its build settings. */
const P5: PackLanguageBody = {
	sample: {
		'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>p5.js sketch</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`,
		'style.css': `/* The canvas fills the page: no margin, no scroll bars. */
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

/* A canvas is inline by default, which leaves a gap below it. */
canvas {
  display: block;
}
`,
		'main.ts': `import p5 from 'p5';

new p5((p: p5) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    p.background('black');
    p.fill(0, 255, 255);
    p.circle(p.mouseX, p.mouseY, 100);
  };
});
`,
		'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Web: p5.js sketch, global mode (TypeScript)'s body: the files of a new project, its server's settings and its build settings. */
const P5_GLOBAL: PackLanguageBody = {
	sample: {
		'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>p5.js sketch</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <!-- A classic script, not a module, so that setup() and draw() are globals. -->
    <script src="./sketch.ts"></script>
    <!-- p5.js in global mode: once the page has loaded, it calls setup() and draw(). -->
    <script type="module">
      import p5 from 'p5';
      window.p5 = p5; // as p5.min.js would, for p5.Vector and the like
    </script>
  </body>
</html>
`,
		'style.css': `/* The canvas fills the page: no margin, no scroll bars. */
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

/* A canvas is inline by default, which leaves a gap below it. */
canvas {
  display: block;
}
`,
		'sketch.ts': `function setup() {
  createCanvas(windowWidth, windowHeight);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  background('black');
  fill(0, 255, 255);
  circle(mouseX, mouseY, 100);
}
`,
		'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["p5/global"]
  }
}
`,
	},
	serverSettings: {},
	properties: NO_PROPERTIES,
	configFiles: [],
};

/** Every language of the package's body, by key. */
export const BODIES = { javascript: JAVASCRIPT, typescript: TYPESCRIPT, web: WEB, p5: P5, 'p5-global': P5_GLOBAL } as const;
