// Writes docs/yukibana.schema.json from the zod schema the parser checks
// with. Run `npm run schema` after changing a field; the schema test fails
// until the committed file matches.
import { writeFile } from 'node:fs/promises';
import { configJSONSchema } from '../dist/lib/yukibana.js';

await writeFile(new URL('../../docs/yukibana.schema.json', import.meta.url), `${JSON.stringify(configJSONSchema(), null, 2)}\n`);
