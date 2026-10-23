// Wires a local Moodle (moodlehq/moodle-docker, see README.md here) to the
// local registry (PROTOTYPE, docs/moodle-sync.md): seeds the Moodle course,
// users and LTI tool with seed.php, then registers that Moodle as an LTI
// platform in the local database, as its admin, and makes an empty edition
// to link the course to.
//
//   node integrations/moodle/local.mjs [moodle web container]
//
// Needs the Supabase stack and Moodle running, and the local admin made
// (`npm run local:admin -- teacher@yukibana.local`).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = process.argv[2] ?? "moodle-webserver-1";
const here = dirname(fileURLToPath(import.meta.url));

// seed.php runs from Moodle's root, which is where config.php is.
execFileSync("docker", ["cp", join(here, "seed.php"), `${web}:/tmp/yukibana-seed.php`]);
const out = execFileSync("docker", ["exec", "-w", "/var/www/html", web, "php", "/tmp/yukibana-seed.php"], { encoding: "utf8" });
const moodle = JSON.parse(out.slice(out.indexOf("{")));
console.log(`Moodle course ${moodle.course_id}, LTI client id ${moodle.client_id}, deployment ${moodle.deployment_id}`);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `
begin;
select tests.authenticate((select app_user.user_id from public.app_user join auth.users u on u.id = app_user.user_id
                           where app_user.role = 'admin' order by u.created_at limit 1));
select app.register_lti_platform(${q(moodle.issuer)}, ${q(moodle.client_id)}, ${q(moodle.deployment_id)}, 'Local Moodle',
  ${q(moodle.auth_url)}, ${q(moodle.token_url)}, ${q(moodle.jwks_url)});
select tests.authenticate(tests.uid('teacher@yukibana.local'));
select app.create_edition((select course_id from public.course where code = 'CS-101'), '2027 spring (Moodle)')
where not exists (select 1 from public.course_edition where label = '2027 spring (Moodle)');
commit;`;
execFileSync("docker", ["exec", "-i", "supabase_db_yukibana", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-tA"], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
console.log("Registered. Log in to Moodle at http://localhost:8000 as teacher / Test-1234 and open the Yukibana activity.");
