// The worker tests/fixtures/gen.mjs runs: explorer.js's own compile, which
// answers with GHC's dumps as they are, before any filter.
import { compile, flagsFor } from '/packs/haskell/explorer.js';

self.onmessage = async ({ data: { files, path, options } }) => {
    const { dumps, error } = await compile(files, path, flagsFor(options));
    self.postMessage({ dumps, error });
};
