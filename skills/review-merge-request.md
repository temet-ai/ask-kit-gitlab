Review a merge request: read what it says and changes, report findings with file and line, comment only when asked

1. Get the state: `await scripts.run("mr-status", { mr })`. Note the target branch, whether it is a
   draft, the pipeline status, the failed jobs, the open threads and `mergeable.conflicts`.
2. Read the description: `(await glab.api("projects/:id/merge_requests/" + mr)).description`. It
   says what the author meant. Findings compare the diff with that, not with your own idea of the
   task.
3. List what changes: `await scripts.run("mr-changes", { mr })`. Read `downgrades` and `bumps`
   first: a dependency version that goes down, or a lockfile changed with no manifest change, is
   a finding. Note which files are tests, which are configuration, which are code.
4. Read the diff file by file, the code files first:
   `await scripts.run("mr-changes", { mr, path: "<part of the path>" })`. For each file look for a
   changed condition or default, an error that is swallowed, a removed check, a hard-coded value, a
   name that no longer matches what it does, and a change with no test. A file shown as collapsed
   or too large: read the file at the branch with
   `glab.api("projects/:id/repository/files/" + encodeURIComponent(path) + "/raw", { fields: { ref: source } })`
   (the response is text, so use `glab.run("api", ...)` and read `.out`).
5. If the pipeline failed, run `await scripts.run("ci-failure", { mr })` and say whether the
   failure comes from this change or from something already red on the target branch (the
   `history` parameter compares with it).
6. Read the open threads from `mr-status`. Say which are still unanswered and whether the diff
   already addresses them.
7. Answer with: a verdict line (what the merge request does, whether the pipeline is green, what
   blocks the merge), then the findings, each as `path:line`, what is wrong, and what you would
   change. Order them by how much they matter. Say what you did not read.
8. Comment on the merge request only when the request asks for it. Then post one comment with the
   findings: `await glab.run("mr", "note", String(mr), "-m", text)`. A comment on one line of one
   file: `await glab.run("mr", "note", "create", String(mr), "-m", text, "--file", path, "--line", String(line))`.
   Approve with `glab.run("mr", "approve", String(mr))` only when the request says approve. Never
   add attribution of any kind to the comment: no "Generated with", no Co-Authored-By, no mention
   of an AI tool.
