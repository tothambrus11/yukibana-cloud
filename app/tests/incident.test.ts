import { describe, expect, test } from 'vitest';
import { framesOf, incidentOf, incidentText, serverMessage, type Occurrence } from '../src/lib/incident';

const ID = '0199f0c2-6b1e-7d3a-9c41-5a2b8e7f1d03';
const at = (side: Occurrence['side'], url = 'https://cloud.yukibana.dev/editions/e1?tab=projects&code=secret'): Occurrence => ({
  id: ID,
  at: new Date('2026-10-30T09:15:00Z'),
  side,
  version: 'abc123def456',
  method: side === 'server' ? 'POST' : null,
  url: new URL(url),
  route: '/editions/[id]',
});

/** An error as postgres.js throws one: a message that quotes a row. */
function leaky(): Error {
  const e = new Error('duplicate key value violates unique constraint "app_user_email_key"\nDETAIL:  Key (email)=(student@school.example) already exists.');
  e.name = 'PostgresError';
  e.stack = `${e.name}: ${e.message}\n    at enrol (file:///app/.svelte-kit/output/server/chunks/db.js:41:9)\n    at async Object.default (file:///app/.svelte-kit/output/server/entries/pages/_page.server.js:12:3)`;
  return e;
}

describe('an incident from the server', () => {
  test('names the error and where in the code it was thrown, but never repeats its message, which may quote someone', () => {
    const incident = incidentOf(leaky(), at('server'));
    const text = incidentText(incident);
    expect(incident.error).toBe('PostgresError');
    expect(incident.stack.split('\n')).toEqual([
      'at enrol (file:///app/.svelte-kit/output/server/chunks/db.js:41:9)',
      'at async Object.default (file:///app/.svelte-kit/output/server/entries/pages/_page.server.js:12:3)',
    ]);
    expect(text).not.toMatch(/student@school\.example|duplicate key|DETAIL/);
  });

  test('says which request it was without its query, which can carry a login code', () => {
    const incident = incidentOf(leaky(), at('server'));
    expect(incident.where).toBe('POST /editions/e1');
    expect(incidentText(incident)).not.toMatch(/secret|tab=/);
  });

  test('a thrown value that is not an Error is named by its type and not quoted', () => {
    const incident = incidentOf('password=hunter2', at('server'));
    expect(incident.error).toBe('string');
    expect(incident.stack).toBe('');
    expect(incidentText(incident)).not.toMatch(/hunter2/);
  });

  test('the sentence for the caller carries the id, so the CLI and the IDE, which show only the sentence, can report it', () => {
    expect(serverMessage(ID)).toContain(ID);
  });
});

describe('an incident from the page', () => {
  test('keeps the message, made in the browser of the person reading it', () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'title')");
    e.stack = `TypeError: ${e.message}\n    at render (https://cloud.yukibana.dev/_app/immutable/nodes/3.js:1:2048)`;
    const incident = incidentOf(e, at('browser'));
    expect(incident.error).toBe("TypeError: Cannot read properties of undefined (reading 'title')");
    expect(incident.where).toBe('/editions/e1');
    expect(incident.stack).toBe('at render (https://cloud.yukibana.dev/_app/immutable/nodes/3.js:1:2048)');
  });
});

describe('a stack', () => {
  test("is read in Firefox's and Safari's form as well as V8's", () => {
    expect(framesOf('render@https://cloud.yukibana.dev/_app/immutable/nodes/3.js:1:2048\n@https://cloud.yukibana.dev/_app/start.js:4:10\n')).toBe(
      'render@https://cloud.yukibana.dev/_app/immutable/nodes/3.js:1:2048\n@https://cloud.yukibana.dev/_app/start.js:4:10',
    );
  });

  test('loses every line that is not a frame, however many lines the message ran to', () => {
    expect(framesOf('Error: one\ntwo with an address a@b.example\n    at f (x.js:1:1)')).toBe('at f (x.js:1:1)');
    expect(framesOf(undefined)).toBe('');
  });
});

describe('the text to copy', () => {
  test('has the id, the time, the request, the route, the version and the frames, each labelled', () => {
    const text = incidentText(incidentOf(leaky(), at('server')));
    expect(text).toContain(`Yukibana incident ${ID}`);
    expect(text).toContain('when:    2026-10-30T09:15:00.000Z');
    expect(text).toContain('where:   POST /editions/e1 (server, route /editions/[id])');
    expect(text).toContain('version: abc123def456');
    expect(text).toContain('error:   PostgresError');
    expect(text).toMatch(/\n\nat enrol /);
  });
});
