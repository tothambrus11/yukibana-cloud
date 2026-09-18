// Writes app/.dev.vars for local development from what the running stack
// reports, unless one exists already. The keys are the local stack's fixed
// demo values; the GitHub App entries stay for you to fill in.
//
//   node scripts/dev-vars.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const target = new URL("../app/.dev.vars", import.meta.url);
if (existsSync(target)) {
  console.log("app/.dev.vars exists; leaving it alone");
  process.exit(0);
}
const status = JSON.parse(
  execFileSync("npx", ["--yes", "supabase", "status", "-o", "json"], { encoding: "utf8" }),
);
// The devcontainer and the Supabase containers are siblings, so "localhost"
// differs: the CLI already honours SUPABASE_SERVICES_HOSTNAME in its URLs, and
// the bucket gets the same treatment.
const host = process.env.SUPABASE_SERVICES_HOSTNAME ?? "127.0.0.1";
const example = readFileSync(new URL("../app/.dev.vars.example", import.meta.url), "utf8");
const vars = example
  .replace(/^SUPABASE_PUBLISHABLE_KEY=.*$/m, `SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY ?? status.ANON_KEY}`)
  + `\n# Where this machine reaches the stack (host.docker.internal in a devcontainer).\n`
  + `PUBLIC_SUPABASE_URL=${status.API_URL}\n`
  + `S3_ENDPOINT=http://${host}:9000\n`;
writeFileSync(target, vars);
console.log(`wrote app/.dev.vars for ${status.API_URL}`);
