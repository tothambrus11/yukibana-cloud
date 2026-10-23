# Moodle, locally, next to the registry

PROTOTYPE (2026-10). `docs/moodle-sync.md` explains what this is and what
was learned from it. This page is how to run it.

| | |
| --- | --- |
| `seed.php` | Seeds Moodle with a course `CS-101-2026`, the users `teacher` (editing teacher), `ta` (non-editing teacher), `alice` and `bob` (students), and `carol` (not enrolled). Every password is `Test-1234`, every address `<username>@yukibana.local`, the same addresses the registry's own seed uses. It also adds an LTI 1.3 tool "Yukibana (local)" and the activity that opens it. Prints the platform's values. |
| `local.mjs` | Runs `seed.php` in the Moodle container, registers that Moodle as an LTI platform in the local database, and makes an empty edition, "CS-101 · 2027 spring (Moodle)", to link the course to. |
| `local_yukibana/` | The Moodle plugin that tells the registry when a course's members change. Copy it to `public/local/yukibana` in Moodle. |

## Moodle in Docker

This uses [moodlehq/moodle-docker](https://github.com/moodlehq/moodle-docker),
Moodle HQ's own development stack. Bitnami's image is no longer free.

```bash
git clone --depth 1 https://github.com/moodlehq/moodle-docker.git
git clone --depth 1 -b MOODLE_501_STABLE https://github.com/moodle/moodle.git moodle
cp moodle-docker/config.docker-template.php moodle/config.php
cp -r <this repo>/integrations/moodle/local_yukibana moodle/public/local/yukibana

# So the Moodle container can reach the registry on the host.
cat > moodle-docker/local.yml <<'EOF'
services:
  webserver:
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF

export MOODLE_DOCKER_WWWROOT=$PWD/moodle MOODLE_DOCKER_DB=pgsql MOODLE_DOCKER_DB_VERSION=16 \
       MOODLE_DOCKER_PHP_VERSION=8.3-bookworm MOODLE_DOCKER_WEB_PORT=8000 COMPOSE_PROJECT_NAME=moodle
moodle-docker/bin/moodle-docker-compose up -d webserver db
moodle-docker/bin/moodle-docker-compose exec webserver php admin/cli/install_database.php \
  --agree-license --fullname="Moodle Local" --shortname=moodle --adminpass=test --adminemail=admin@example.com
```

The install takes about two minutes. Moodle is then at
http://localhost:8000 (admin / test). If Docker Hub rate-limits you, pull
`mirror.gcr.io/moodlehq/moodle-php-apache:8.3-bookworm` and
`mirror.gcr.io/library/postgres:16`, tag them with their Docker Hub names,
and pass `--pull never`.

## The registry as a tool

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out tool.pem
# .dev.vars (at the repository root), on one line each:
#   LTI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
#   LTI_CRON_SECRET="local-cron-secret"

# Vite answers only the hosts it knows. Moodle fetches the tool's keys at
# host.docker.internal.
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=host.docker.internal npm run dev

npm run local:admin -- teacher@yukibana.local
node integrations/moodle/local.mjs            # Moodle's web container: moodle-webserver-1

# Tell the plugin where to send hints, and which tool this site's client is.
moodle-docker/bin/moodle-docker-compose exec webserver php admin/cli/upgrade.php --non-interactive
moodle-docker/bin/moodle-docker-compose exec webserver php admin/cli/cfg.php \
  --component=local_yukibana --name=hinturl --set=http://host.docker.internal:5173/api/lti/hint
moodle-docker/bin/moodle-docker-compose exec webserver php admin/cli/cfg.php \
  --component=local_yukibana --name=clientid --set=<client_id printed by local.mjs>
```

`seed.php` clears Moodle's `curlsecurityblockedhosts` and
`curlsecurityallowedport` so that Moodle may reach a private address on
port 5173. That is right for a laptop and wrong anywhere else.

The tool URLs are `http://127.0.0.1:5173`, the address Auth's `site_url`
uses. Use that address in the browser too: `localhost` would be a
different site for cookies.

## Trying it

1. Log in to Moodle as `teacher`, open the course, and open "Yukibana". A
   new window opens the registry. Log in there as `teacher@yukibana.local`
   (the code arrives at http://127.0.0.1:54324), pick "2027 spring
   (Moodle)", and press Link. The Roster tab now shows the Moodle panel and
   the course's members, marked `sis`.
2. Change the course in Moodle: enrol `carol`, unenrol `bob`, suspend
   someone, or make `ta` an editing teacher. Then run Moodle's cron, which
   in moodle-docker does not run by itself:
   `moodle-docker/bin/moodle-docker-compose exec webserver php admin/cli/adhoc_task.php --execute`.
   The plugin's task sends one hint per course, and the roster follows.
3. Log in to Moodle as `carol` and open "Yukibana". She lands in the
   edition and, once she has logged in to Yukibana, sees it as a student.
4. The scheduled sync:
   `curl -X POST -H 'Authorization: Bearer local-cron-secret' http://127.0.0.1:5173/api/lti/sync`.
