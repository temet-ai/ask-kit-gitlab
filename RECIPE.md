# Recipe: gitlab kit

## What it answers

GitLab state for one project: merge requests, pipelines and jobs, issues, releases. Where a merge
request stands, why a job failed, what a merge request changes, which merge request or issue
covers a topic, what happened in a time window. It changes things when asked: comment, approve,
merge, retry, cancel, create, close, label, resolve a thread.

## What it needs

- `glab` on PATH, logged in. Every call runs with that login's rights.
- Nothing else: no keys of its own, no build step.

## What it reads and runs

- Runs `glab` (no shell, a timeout on every call) through `glab.mjs`: any subcommand and
  `glab api`. `-R <project>` is added to project-scoped subcommands and `:id` in an endpoint
  becomes the project's encoded path.
- The project comes from `GITLAB_REPO`, else the `origin` remote of the caller's folder
  (`git remote get-url origin`).
- A call is classified as reading (a list of subcommands, `glab api` with GET, a GraphQL query) or
  changing; changing needs `act`. `acts` in `ask-kit.toml` is written as prose because the host
  matches a command phrase anywhere in a call's arguments, and `glab api` reads and writes the same
  endpoints.
- Refuses `auth` (except `status`), `config`, `variable`, token and variable endpoints, `--watch`,
  `--live`, `-w`, `ci view`, `ci trace` and fields read from files. Masks token shapes, auth
  headers and URL passwords in all output, and key=value secrets in job logs.

## Rebuild it from an empty folder

Write `ask-kit.toml` with one `module` source named `glab`, a `GITLAB_REPO` setting detected by
`git remote get-url origin`, and `state_key = "${GITLAB_REPO}"`. The module exports
`make({settings, push, cwd, act})` returning a client with `run(...args)`, `json(...args)`,
`api(endpoint, {method, fields, paginate})` (GET fields go in the query string; pages are fetched
one by one), `trace(jobId, {grep, tail, errors})` (the job's log read once, with ANSI codes and
section markers removed, reduced to error lines and a tail) and `plan(args)` (the argument list
without running it, for tests). The executor is injectable. Describe it exactly in `api.d.ts`.

Scripts: `mr-status` (merge request JSON, pipeline jobs, approvals and approval rules, discussions
with unresolved ones), `ci-failure` (pipeline for a merge request, branch or id; failed jobs, log
lines, downstream failures, same-job history on the default branch), `mr-changes` (merge request
diffs, line counts, version changes in dependency files), `find` (search on merge requests and
issues), `activity` (merged, opened, closed, releases, pipelines in N days).

Skills in `skills/`: review-merge-request, green-pipeline, open-merge-request. Roles in `roles/`:
reviewer, pipeline-fixer.

## Bench

`bench/questions.json`: six questions of the kinds agents answer by hand with `glab`,
written as "in this project" with patterns that check shape, and two script runs.
