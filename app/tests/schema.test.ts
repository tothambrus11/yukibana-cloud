import { describe, expect, test } from 'vitest';
import { GET } from '../src/routes/schema/yukibana.json/+server.js';

describe('the yukibana.json schema', () => {
  test('is served at the URL it names as its id, to anyone, as a JSON Schema', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.headers.get('content-type')).toBe('application/schema+json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const schema = (await response.json()) as { $id: string; required: string[] };
    expect(schema.$id).toBe('https://cloud.yukibana.dev/schema/yukibana.json');
    expect(schema.required).toEqual(['version', 'kind']);
  });
});
