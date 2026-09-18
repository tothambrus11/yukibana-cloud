import { expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

const routes = files(join(src, 'routes'), '.svelte');

// Some rules a type cannot state. They are greps because the rule is about
// the shape of the tree, and a paragraph in CLAUDE.md is a rule nobody runs.

test('there are pages to check at all, so this file cannot pass by finding nothing', () => {
  expect(routes.length).toBeGreaterThan(4);
});

test('a page says what is on it and nothing about how it looks', () => {
  // One stylesheet, styling elements rather than classes, is what keeps a
  // page plain HTML. Six pages each with a <style> block is six sets of
  // numbers for a row to shift between.
  const withStyle = routes.filter((f) => /<style[\s>]/.test(readFileSync(f, 'utf8')));
  expect(withStyle.map((f) => f.slice(src.length))).toEqual([]);
});

test('the one stylesheet is pulled in once, by the layout every page is inside', () => {
  const importers = routes.filter((f) => readFileSync(f, 'utf8').includes('app.css'));
  expect(importers.map((f) => f.slice(src.length))).toEqual(['/routes/+layout.svelte']);
});

test('both colour schemes come from one set of values, not a second block to keep in step', () => {
  const css = readFileSync(join(src, 'app.css'), 'utf8');
  expect(css).toMatch(/color-scheme:\s*light dark/);
  // A `prefers-color-scheme` block would be the second place a colour is
  // decided, and the one that falls behind.
  expect(css).not.toMatch(/prefers-color-scheme/);
});
