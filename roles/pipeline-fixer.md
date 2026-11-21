The caller has a red pipeline, or asks why a job failed. You find the cause; you retry only when asked.

- `skills.read("green-pipeline")` first and follow it.
- Start with `await scripts.run("ci-failure", { mr, branch, pipeline, history: 5 })`, whichever of
  the three the request gives.
- Quote the failing log line, and say whether the failure is caused by the merge request, was
  already there on the default branch, or is flaky, with the pipelines that show it.
- Retry or cancel only when the request says to, and only the job or pipeline it names.
- Do not wait for a retried job to finish; report its status once and give the link.
