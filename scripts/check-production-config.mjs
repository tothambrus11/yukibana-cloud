// Fails when a production value is still a placeholder, naming every one and
// where it comes from. The deploy workflow runs this first: a Worker deployed
// with REPLACE_ME_PROJECT_REF in it would start, serve pages, and fail every
// login with something that looks nothing like the cause.
//
//   node scripts/check-production-config.mjs
import { readFileSync } from "node:fs";

const WHERE = {
  REPLACE_ME_PROJECT_REF: "the Supabase project ref: the first label of the project's API URL, https://<ref>.supabase.co",
  REPLACE_ME_ACCOUNT_ID: "the Cloudflare account id: R2 → Overview → the S3 API endpoint, https://<account id>.r2.cloudflarestorage.com",
  REPLACE_ME_HYPERDRIVE_ID: "the Hyperdrive id printed by `wrangler hyperdrive create yukibana --connection-string=...`",
  REPLACE_ME_WORKERS_SUBDOMAIN: "the workers.dev subdomain, or the custom domain the app is served on",
};

const files = ["app/wrangler.jsonc", "supabase/config.toml"];
const found = [];
for (const file of files) {
  const lines = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const name of Object.keys(WHERE)) {
      if (line.includes(name)) found.push({ file, line: i + 1, name });
    }
  });
}

if (found.length === 0) {
  console.log("production configuration has no placeholders left");
  process.exit(0);
}
console.error("These production values are still placeholders:\n");
for (const name of new Set(found.map((f) => f.name))) {
  console.error(`  ${name}`);
  console.error(`    is ${WHERE[name]}`);
  for (const f of found.filter((x) => x.name === name)) console.error(`    at ${f.file}:${f.line}`);
  console.error("");
}
console.error("Fill them in and commit; docs/deploy.md says where each comes from.");
process.exit(1);
