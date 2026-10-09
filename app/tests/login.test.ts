import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addressOf, codeOf, landing } from '../src/lib/login.js';

test('an address is compared as the teacher enrolled it, whatever case and spaces the student typed', () => {
  assert.equal(addressOf('  Alice@School.Example '), 'alice@school.example');
  assert.equal(addressOf('alice+test@gmail.com'), 'alice+test@gmail.com');
  for (const bad of ['', 'alice', '@school.example', 'alice@', 'a@b@c', 'al ice@school.example']) assert.equal(addressOf(bad), null, bad);
});

test('a code is the digits from the mail, however they were pasted', () => {
  assert.equal(codeOf('123456'), '123456');
  assert.equal(codeOf(' 123 456 '), '123456');
  assert.equal(codeOf('123-456'), '123456');
  for (const bad of ['', 'abcdef', '12345a', '123']) assert.equal(codeOf(bad), null, bad);
});

test('after logging in, a person lands on this site and nowhere else', () => {
  assert.equal(landing('/editions/x?tab=roster'), '/editions/x?tab=roster');
  for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'editions']) assert.equal(landing(bad), '/', String(bad));
});
