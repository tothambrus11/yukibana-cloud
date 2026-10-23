# Moodle roster sync (prototype)

Status: a working prototype, run end to end against a local Moodle 5.1
(2026-10-23). It is not ready to deploy. The open decisions are at the
end. `integrations/moodle/README.md` says how to run it.

The question was how an edition gets its members from the Moodle course
it is taught in, how the two get linked, and how a change in Moodle
reaches Yukibana. The short answers are:

* **Linking.** The teacher launches Yukibana once from their Moodle course
  (LTI 1.3), logs in to Yukibana, and picks one of the editions they own.
  The database lets them do that only with a grant made from that verified
  launch.
* **The roster.** It comes from LTI's Names and Role Provisioning Service
  (NRPS), with the tool's own key and no Moodle admin token. It is applied
  only to `source = 'sis'` enrolments.
* **Changes.** A small Moodle plugin sends a contentless hint ("course 2
  changed") on every enrolment and role event. A launch refreshes the
  roster if it is more than five minutes old. A scheduled sync is the
  backstop for what Moodle sends no event for.

## What was built

| Part | Where |
| --- | --- |
| Tables `lti_platform`, `lti_link`, `lti_link_grant`, `lti_sync_run`; role `yukibana_lti`; functions to register, link, unlink and apply a roster | `supabase/migrations/20261023120000_lti_roster.sql` |
| pgTAP, written as negatives (a teacher who does not own the edition cannot link it, a roster cannot make an owner, an empty list removes nobody, …) | `supabase/tests/lti_roster.test.sql` |
| Launch claims, role mapping, member list pages: pure, tested as tables | `app/src/lib/lti.ts`, `app/tests/lti.test.ts` |
| Launch verification, service token, paging, sync | `app/src/lib/server/lti.ts` |
| `/lti/login`, `/lti/launch`, `/lti/link`, `/lti/jwks`, `/api/lti/hint`, `/api/lti/sync` | `app/src/routes/lti`, `app/src/routes/api/lti` |
| "Moodle" panel on the edition's Roster tab: what it follows, the last sync, Sync now, Unlink | `app/src/routes/editions/[edition]` |
| Moodle course, users and tool for local testing | `integrations/moodle/seed.php`, `local.mjs` |
| Moodle plugin that sends the change hints | `integrations/moodle/local_yukibana` |

The roles: the Worker becomes `yukibana_lti` for anything that comes from
Moodle (a launch, a hint, the schedule). Like `yukibana_publisher`, it has
no table grants, only the functions it needs. Linking and unlinking run as
the person, through `app.link_edition_to_lti` and
`app.unlink_edition_from_lti`, which check that the caller is an owner.

## What was verified, end to end

Moodle 5.1.8+ ran in `moodlehq/moodle-docker` (PostgreSQL 16, PHP 8.3).
Yukibana ran with `npm run dev` against the local Supabase stack. A
headless Chromium did the clicking.

1. Tess, the course's editing teacher, opened the Yukibana activity in
   Moodle. Moodle's OIDC login reached `/lti/login`, went back to Moodle's
   `auth.php`, and posted a signed `id_token` to `/lti/launch`. The Worker
   checked the token against Moodle's `certs.php`, saw Instructor and a
   course that was not linked, made a grant, and sent her to `/lti/link`.
2. She logged in to Yukibana by email code and picked "CS-101 · 2027 spring
   (Moodle)". The first sync asked `token.php` for a token (client
   credentials, assertion signed by the tool key; Moodle fetched the key
   from `/lti/jwks`), read the member list, and enrolled 3 people: Alice
   and Bob as students, and Tom, Moodle's non-editing teacher, as a
   student (see "Roles" below). The owner's own row was left as it was.
3. A script then enrolled Carol in Moodle, unenrolled Bob, and made Tom an
   editing teacher: three events. The plugin queued **one** ad hoc task
   for the course (a task with the same data is not queued twice). The
   next cron run sent one hint, and one sync followed: `4 members: 1
   added, 1 changed, 1 removed`. Carol came in as a student, Bob went,
   and Tom became an assistant.
4. Suspending Alice's enrolment in Moodle (`user_enrolment_updated`) led
   to a hint and a sync that removed her, because NRPS lists only active
   enrolments.
5. Carol, who existed only in Moodle, opened the activity. The launch sent
   her to the edition, she logged in to Yukibana with her Moodle address,
   her waiting `sis` enrolment linked to her account, and she saw the
   edition as a student.
6. `POST /api/lti/sync` refused a call without the scheduler secret (401).
   With the secret it synced every link not synced in the last 50 minutes.

Things that broke on the way, now fixed and written into the code:

* postgres.js encodes a string sent as `$1::jsonb` as a JSON *string*. The
  roster came through as one scalar, and the function rightly refused it
  as empty. It is now sent as `::text::jsonb`.
* `\curl` is not autoloaded in a Moodle ad hoc task. The first run worked
  only because something else had loaded `filelib.php`. The failing run
  showed that Moodle retries the task with back-off, which is what we want.
* SvelteKit refuses a redirect to another origin unless it is named. The
  OIDC redirect now names the platform's origin.

## Linking an edition to a Moodle course

| Option | How | Verdict |
| --- | --- | --- |
| **Launch, then pick (built)** | The teacher adds the Yukibana activity to the course and opens it once. Yukibana knows the course from the signed launch and asks which edition. | Recommended. No ids to copy. Only a teacher of that course can link it, and the database checks that (the grant). It also gives students a "Yukibana" link inside Moodle. |
| Deep Linking | Same, but the edition is chosen in Moodle's "Select content" dialog while the teacher adds the activity. | Nicer later. It needs the same grant logic plus a Deep Linking response, and Moodle shows it in a modal where third-party cookies cause trouble. |
| Paste a course id | An owner types the Moodle course id on the edition page, and Yukibana reads the roster over Moodle web services. | Needs a site-wide WS token. Nothing would prove that the person linking teaches that course: any owner could pull any course's roster. Avoid. |
| Moodle creates the edition | The plugin creates an edition when a course is made. | Couples Moodle's lifecycle to ours. Not every Moodle course is a Yukibana course. |

Why a grant, and not "owner links edition to context id": the link
decides whose names and addresses flow into an edition. Were it a plain
owner action, any teacher who owns any edition could name any Moodle
course and read its roster. The grant (`lti_link_grant`, hashed, 15
minutes, used once) can only be made by the LTI role, after an Instructor
launch from that very course.

Both directions are unique: one Moodle course, one edition. A course that
runs two editions, or the other way round, is not supported.

Practical constraints found:

* **Launch in a new window.** The launch needs two cookies (state and
  nonce, then the grant). In a frame they are third-party cookies, which
  browsers drop. `seed.php` sets the tool to "New window".
* **The cookies are `SameSite=None; Secure`.** In production the launch is
  a form POST from the Moodle origin, which is cross-site.
* **CSRF.** SvelteKit refuses cross-origin form POSTs in production, and
  `/lti/login` and `/lti/launch` are exactly that. The Moodle origin must
  go into `csrf.trustedOrigins` in `vite.config.ts` before this can run
  anywhere but a laptop. In development SvelteKit does not check.
* **Moodle's settings for the tool.** "IMS LTI Names and Role
  Provisioning" must be set to use the service, and "Share launcher's
  email" to always. Without the email, a member cannot be enrolled,
  because an enrolment is an address.

## Detecting roster changes

| Mechanism | Latency | Catches | Cost | Verdict |
| --- | --- | --- | --- | --- |
| **Plugin hint (built)**: `local_yukibana` observes `user_enrolment_created/updated/deleted` and `role_assigned/unassigned`, queues an ad hoc task, and the task POSTs `{issuer, client_id, context_id}` | Moodle cron interval (1 min is Moodle's recommendation) plus one sync | Every enrolment, unenrolment, suspension and role change made in Moodle | One plugin, installed by the Moodle admin | Recommended where the admins will install it. |
| **Launch-time sync (built)**: a launch syncs if the last sync is more than 5 minutes old | Instant for the person launching | Someone who reaches Yukibana through Moodle | None | Keep. It makes "I was just enrolled and it doesn't know me" impossible for anyone who comes through Moodle. |
| **Scheduled sync (built as an endpoint)**: `POST /api/lti/sync` with a bearer, which syncs every link older than 50 minutes | The schedule | Everything, including enrolments that **end on their date**, which Moodle fires no event for, and lost hints | One NRPS fetch per course per run | Required as the backstop, whatever else is chosen. |
| NRPS `differences` link | — | — | — | Moodle 5.1 does not implement it (only `rel="next"`), so there is nothing incremental to poll. |
| Moodle webhooks | — | — | — | Moodle core has no outbound webhooks. Third-party plugins exist, but a 60-line plugin of our own is easier to review than a general one. |
| Moodle web services polling (`core_enrol_get_enrolled_users`) | The schedule | Same as NRPS, plus groups and editing vs non-editing teachers | A site-admin token | Only if groups or the teacher distinction are needed (see Roles). |

Why the hint carries nothing: Yukibana answers a hint by fetching the
member list itself, over the authenticated LTI service. So the hint needs
no secret, and a forged one learns nothing (the answer is always `202`).
The worst it can do is cost one fetch per course every 10 seconds, which
is the hint rate limit. If that ever matters, the plugin can sign the
hint with Moodle's own LTI key (the one in `certs.php`), which Yukibana
already trusts.

On the scheduler: the SvelteKit Cloudflare adapter emits no `scheduled`
handler, so the Worker cannot be its own cron. Either a GitHub Actions
schedule or a ten-line second Worker with a cron trigger calls
`/api/lti/sync` with `LTI_CRON_SECRET`.

## What a sync may change

This is decided in `app.apply_lti_roster`. The cautious reading of each
open decision was taken:

* Only `source = 'sis'` rows belong to the sync. Someone enrolled by hand
  keeps their row and role, even when Moodle disagrees.
* The sync never creates, demotes or removes an **owner**. Moodle's
  Instructor becomes an **assistant**. An `sis` row that an owner promoted
  to owner is left alone from then on.
* Someone gone from Moodle (unenrolled, suspended, or whose enrolment
  ended) is **removed**, as `app.unenrol` would remove them. Their
  submissions stay. If they come back, so does their row.
* An **empty member list removes nobody** and is refused. A course always
  lists at least the teacher who linked it, so an empty list means a
  broken fetch. The Worker never applies a partial list: it follows every
  page or gives up.
* Members are matched by **email**, lowercased, as the rest of enrolment
  already is. A member without an email is skipped and counted.

### Roles

Moodle sends Instructor for whoever has `moodle/course:manageactivities`
in the course, and Learner for everyone else. **Non-editing teachers
therefore arrive as students** (Tom, above, until he was made an editing
teacher). LTI cannot tell them apart. The options are to promote them by
hand (which today the next sync reverts, see below), to read roles over
web services, or to have the plugin send role information.

## Open decisions (for Ambrus)

1. **Edits to synced rows.** An owner who changes the role of an `sis` row
   on the Roster tab, or removes it, is overruled at the next sync. Should
   a hand edit turn the row into `manual`, so the sync leaves it alone
   from then on (recommended), or should the page refuse to edit `sis`
   rows?
2. **Removal.** Delete, as now, or keep a "left" state so that staff can
   see who dropped out? Submissions survive either way.
3. **Non-editing teachers.** Accept them as students and promote them by
   hand (needs 1), or add web services for roles?
4. **Identity.** Email is the join key, as for every enrolment today. If
   people log in through ISC Keycloak / edu-ID with a different address
   than Moodle's, they will not link. The launch knows the person's stable
   Moodle id (`sub`). Recording (issuer, sub) for the logged-in person at
   launch would make matching exact, and would allow logging in through
   the launch itself.
5. **Groups.** NRPS in Moodle carries none. If projects need groups, that
   means web services or the plugin.
6. **Hints, schedule or both.** Recommended: both, with the schedule
   hourly.

## Running it

See `integrations/moodle/README.md`.
