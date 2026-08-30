# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on **`lbacik/jsonhub-sdk-generator`**. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Related repositories

This repo generates SDKs from another repo's API Contract and publishes them into a third set of repos. Issues stay here unless they are genuinely about one of the others:

- **`lbacik/globaldb`** (private) — the JsonHub API. Owns the API Contract. File issues there when the fix belongs to the API itself.
- **`lbacik/jsonhub-sdk-ts`** — the TypeScript SDK Target's published output. Generated; do not file implementation issues there.
- **`lbacik/jsonhub-sdk-python`** — the Python SDK Target's published output. Generated; same.
- **`lbacik/jsonhub-sdk`** — the hand-written PHP SDK. Not an SDK Target; out of scope here.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_
