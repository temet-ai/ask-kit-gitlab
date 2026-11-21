interface GlabResult { code: number; out: string; err: string; timedOut?: boolean }

declare const glab: {
  repo: string | null; // "group/subgroup/project": the project every call is about; null when glab works it out from the folder
  act: boolean;        // true when this ask may change things

  // Any glab subcommand, no shell: pass each argument separately. `-R <project>` is added to project-scoped
  // commands (mr, ci, issue, release, label, milestone, schedule) unless you give one.
  // Reads: run("mr", "view", "12"), run("mr", "list", "--source-branch", "x"), run("ci", "get", "-p", "123"), run("issue", "view", "7").
  // Never throws on a non-zero exit. It throws for:
  //  - a call that changes something (mr note/approve/merge/create/close, ci retry/cancel/run, issue create/close, api with POST/PUT/PATCH/DELETE or a
  //    GraphQL mutation, ...) when glab.act is false;
  //  - what prints the login's token or CI secrets: `auth token`, `--show-token`, `config`, `variable`, and API endpoints for variables, access tokens,
  //    deploy tokens and secure files;
  //  - what never ends or waits for a person: --watch, --live, -w, `ci view` (interactive) and `ci trace` (follows a running job; use glab.trace).
  // Token shapes (glpat-...), PRIVATE-TOKEN and Authorization headers and URL passwords are masked in all output; values of keys named
  // token, secret or password in API JSON are replaced with "***".
  run(...args: string[]): Promise<GlabResult>;

  // As run, with --output json added where glab has it, parsed. Throws with glab's error on failure.
  json(...args: string[]): Promise<any>;

  // The REST API for this project: api("projects/:id/merge_requests/12/discussions"). ":id" becomes this project's id (works in any folder
  // once GITLAB_REPO is set). A GET carries `fields` as query parameters ({state: "opened", per_page: 50}). paginate: all pages (100 each, at most
  // maxPages, default 10), flattened into one array. Another method (POST, PUT, PATCH, DELETE) needs glab.act and sends `fields` as the body.
  // Throws on failure. Useful endpoints: projects/:id/merge_requests/<iid> (head_pipeline, detailed_merge_status, merge_commit_sha, changes_count),
  // .../merge_requests/<iid>/{discussions,approvals,approval_state,diffs,commits,pipelines}, projects/:id/pipelines/<id>/{jobs,bridges},
  // projects/:id/jobs/<id>, projects/:id/pipelines?ref=<branch>, projects/:id/releases, projects/:id/repository/commits/<sha>/{diff,merge_requests}.
  api(endpoint: string, o?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; fields?: Record<string, unknown>; paginate?: boolean; maxPages?: number }): Promise<any>;

  // A job's log read once and reduced to what matters. A running job returns the log so far (running: true); nothing is followed.
  // grep: a regex, matching lines come back in `matches`. errors: error lines kept (default 30). tail: closing lines kept (default 40).
  // ANSI codes and section markers are removed; passwords, tokens and keys printed in the log are masked.
  trace(jobId: string | number, o?: { grep?: string; errors?: number; tail?: number }): Promise<{
    job: { id: number; name: string; stage: string; status: string; failure_reason: string | null; url: string };
    lines: number; running: boolean; errors: string[]; tail: string[]; matches?: string[];
  }>;

  // The argument list glab would run for these arguments (after the act check, -R and :id filling), without running it.
  plan(args: string[]): { args: string[]; changing: boolean };
};
