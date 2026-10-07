# `yukibana.json`

The contract between a course repository and Yukibana. It lives at the
project root, and it is read by two programs: the student's IDE (our Theia
fork), for how the workspace looks and which files are read-only, and the
CLI, for what a student must never receive and what a submission holds.
`docs/yukibana.schema.json` is the JSON Schema.

```json
{
  "version": 1,
  "kind": "scala-sbt",
  "features": { "codeSuggestions": true, "squiggles": true, "ai": false },
  "layout": {
    "widgets": { "files": false, "search": false, "vcs": false, "debug": false, "testing": false, "outline": false, "aiChat": false },
    "containers": { "metals-explorer": false }
  },
  "openFiles": ["README.md", "src/main/scala/Main.scala"],
  "readOnly": ["src/test/**", "README.md", "yukibana.json"],
  "hidden": ["src/test/scala/hidden"],
  "submission": { "exclude": ["notes"] }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Always `1` for now. A future shape gets a new number, not a silent reinterpretation. |
| `kind` | yes | `rust-cargo` or `scala-sbt`. Chooses the build output no archive carries (`target/`, `project/target/`, `.bsp`, `.metals`, …) and the manifest checks below. |
| `features`, `layout`, `openFiles` | no | For the IDE. Checked for their types and copied into the starter as they are. |
| `readOnly` | no | Globs of files the student receives and may not change. The IDE stops them being edited; an assembly replaces whatever a submission holds under them with the teacher's version, and reports every change. |
| `hidden` | no | Globs of files the student never receives. Removed from the starter and from the starter's copy of this file; put back by an assembly. |
| `submission.include` | no | When present, only matching paths are submitted (and `yukibana.json`, always). |
| `submission.exclude` | no | Globs never submitted. |
| `submission.filename` | no | What a packed submission is called on disk. Default `submission.tar.zst`. The bytes are always a zstandard-compressed tar, whatever the name. |
| `submission.maxBytes` | no | The largest submission this project expects. Default 32 MiB; the registry has its own cap above which this cannot go. |
| `projectId` | no | Written by `publish` (or `build --project`) into the starter's copy, so `yukibana submit` and the IDE know where a submission from that folder goes without the student choosing. A course repository leaves it out; a starter built without a project has none, and its students name the project when they submit. The registry does not trust it: a submission is accepted only where the student's enrolment allows. |

Globs are relative to the project root. `*` stays inside a path segment, `**`
crosses segments, `?` is one character, and a pattern that names a directory
covers everything under it, so `tests/*` covers `tests/a/b.rs` too. There is
no negation. A field this version does not know is passed through to the
starter with a warning, so a misspelt `"hiden"` is printed rather than
shipping the tests in silence.

Never in any archive or submission, whatever the file says: `.git/`, and
`.theia/`, because everything the IDE is set up with is declared here.

## What a release is

`yukibana build` (or the GitHub Action, or `publish`) reads the checkout and
produces two archives, each unpacking into one folder (`--folder`, by
default the directory's name; make it the project's slug):

* **the teacher archive**: the project as it is, hidden tests and this file
  included, minus `.git/`, `.theia/` and the build output. Staff download it
  from the release list, and assemblies take the read-only and hidden files
  from it; students never can;
* **the starter**: the same minus `.github/` and everything `hidden`
  matches, plus a copy of `yukibana.json` with `hidden` removed and
  `projectId` added.

The build fails, with every reason on the terminal and a non-zero exit, when:

* there is no `yukibana.json`, or it does not parse, or a field is wrong;
* `hidden` names paths and none of them matches anything (a typo would
  otherwise ship the tests);
* `Cargo.toml` names a hidden path in a `path = "…"` or a workspace member,
  or the kind's manifest (`Cargo.toml`, `build.sbt`) is missing. Hidden tests
  must be auto-discovered, because deleting a file a manifest points at
  leaves a starter that does not build;
* a symlink points outside the repository (it could carry a hidden file out
  under another name).

## What a submission is

A `.tar.zst` of the student's project folder, paths relative to its root,
`yukibana.json` at the top, holding what the rules above let through. The
CLI's `submit` and the IDE extension make it with the same library function,
so both send the same files. It is sent as the body of
`POST /api/projects/{projectId}/submissions` with `Content-Type:
application/zstd` and a `Content-Length`, authenticated by an
`Authorization: Bearer <access token>` header (or the session cookie). The
response is `201` with the submission id, size and SHA-256. Every submission
is kept and the newest is the one that counts. Submissions are accepted
while the project's window is open (from `available_after` until
`closes_at`, both set on the project page); one that arrives after the
deadline is accepted and listed as late.

## What an assembly is

What a teacher grades: the student's files, except that `yukibana.json`,
every `readOnly` path and every `hidden` path are deleted from the
submission and taken from the teacher archive of the project's newest
release. The teacher's `yukibana.json` decides what is protected, never the
student's copy. An assembly reports, per student:

* **modified**: a read-only file (or `yukibana.json`, `projectId` and
  formatting aside) with contents other than the starter had;
* **deleted**: a read-only file (or `yukibana.json`) the starter had and the
  submission does not;
* **added**: a file under a read-only or hidden path that the teacher's
  project does not have, such as a test written into the hidden folder.

Each is undone in the assembled folder either way.
