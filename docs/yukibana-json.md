# `yukibana.json`

The contract between a course repository and Yukibana. It lives at the
repository root and is the only thing the builder reads about a project
besides the files themselves.

```json
{
  "version": 1,
  "kind": "rust-cargo",
  "hidden": ["tests/hidden"],
  "submission": { "maxBytes": 33554432 }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Always `1` for now. A future shape gets a new number, not a silent reinterpretation. |
| `kind` | yes | The build system: `rust-cargo` or `scala-sbt`. Chooses what is always stripped from the starter (`target/`, `project/target/`, editor state) and, later, how a submission is packed and checked. |
| `hidden` | no | Globs, relative to the root, of what students must never receive. Removed from the starter and from the starter's copy of this file. A pattern naming a directory hides everything under it. `*` stays inside a path segment, `**` crosses segments, `?` is one character. No negation. |
| `submission.maxBytes` | no | The largest `.tar.zst` accepted for this project. Default 32 MiB; the service has its own cap above which this cannot go. |

## What a release is

`yukibana build` (or the GitHub Action, or `publish`) reads the checkout and
produces two archives, each unpacking into one folder (`--folder`, by
default the directory's name; make it the project's slug):

* **the teacher archive**: the project as it is, hidden tests and this file
  included, minus `.git/` and the build system's output. Staff download it
  from the release list; students never can;
* **the starter**: the same minus `.github/` and everything `hidden`
  matches, plus a copy of `yukibana.json` with `hidden` removed and
  `projectId` added, so an IDE extension knows where a submission goes.

The build fails, with every reason on the terminal and a non-zero exit, when:

* there is no `yukibana.json`, or it does not parse, or a field is wrong;
* `hidden` names paths and none of them matches anything (a typo would
  otherwise ship the tests);
* `Cargo.toml` names a hidden path in a `path = "…"` or a workspace member.
  Hidden tests must be auto-discovered (`tests/*.rs`, `src/test/scala/**`),
  because deleting a file a manifest points at leaves a starter that does not
  build. Rewriting manifests is the per-kind extension this rule will grow
  into;
* a symlink points outside the repository (it could carry a hidden file out
  under another name).

The registry stores what it is given and checks only that each archive is
gzip and under its size cap; what is in them is the CLI's job, and a wrong
release is followed by a right one.

## What a submission is

A `.tar.zst` of the student's project folder, sent as the body of
`POST /api/projects/{projectId}/submissions` with `Content-Type:
application/zstd` and a `Content-Length`, authenticated by the session
cookie or an `Authorization: Bearer <access token>` header. The response is
`201` with the submission id, size and SHA-256. Every submission before the
deadline is kept; the newest is the one that counts.
