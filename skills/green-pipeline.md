Get a red pipeline green: find the failing job and line, decide whether it is flaky, retry only when asked

1. Find the failure: `await scripts.run("ci-failure", { mr, history: 5 })` for a merge request, or
   with `branch` or `pipeline`. With a branch, the script picks the latest failed pipeline and says
   when a newer one exists.
2. Read each failed job. `errors` holds the failing lines of its log and `tail` its last lines.
   `reason` is GitLab's failure reason: `script_failure` means a command in the job exited non-zero;
   `runner_system_failure`, `stuck_or_timeout_failure`, `scheduler_failure` and
   `api_failure` mean the job did not run or was cut off, and the log does not explain it.
3. Quote the line that failed. A test failure names the test and the assertion; a build failure
   names the file and line; a lint failure names the rule. When `errors` is empty or the log is
   long, search it: `await glab.trace(jobId, { grep: "error|FAILED|Exception", tail: 60 })`.
4. Decide flaky or broken from `history`: the same job on the last pipelines of the default
   branch. Failed in most of them: broken on the default branch already, not caused by this change.
   Passed in all of them and failed only here: the change causes it. Failed in some and passed in
   others with no change to the job: flaky. If `history` was not asked for, run
   `ci-failure` again with `history: 5`.
5. A failure in a child pipeline shows in `downstream`; run `ci-failure` with that `pipeline` id.
   A `manual` job is waiting for a person and is not a failure. A job with `allowFailure` true does
   not block the pipeline.
6. Say what to change. Name the file and line when the log shows them. If the cause is a version
   or a dependency, `mr-changes` shows what the merge request changed there.
7. Retry only when the request says retry. A single job: `await glab.run("ci", "retry", String(jobId))`.
   A pipeline's failed jobs: `glab.api("projects/:id/pipelines/" + id + "/retry", { method: "POST" })`.
   Cancel: `glab.api("projects/:id/pipelines/" + id + "/cancel", { method: "POST" })`. Never retry
   a job that failed on a real error; it fails the same way.
8. After a retry, read the new status once with `glab.api("projects/:id/jobs/" + jobId)` and report
   it. Do not wait for it to finish; say that the pipeline is running and where to look.
9. The answer: the failing job and stage, the failing line, the verdict (caused by this change,
   already red on the default branch, or flaky, with the pipelines that show it), and what you did.
