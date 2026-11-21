export const meta = {
  purpose:
    "Why a pipeline failed: finds the pipeline for a merge request, a branch or a pipeline id, lists its failed jobs with stage and failure reason, and reduces each failed job's log to the failing lines and its last lines. Failed downstream (child) pipelines are listed. With `history`, the same jobs on the last pipelines of the default branch are compared, to tell a flaky job from a broken one.",
  params: {
    mr: "merge request number, optional (its latest pipeline)",
    branch: "branch name, optional (latest failed pipeline on it)",
    pipeline: "pipeline id, optional",
    lines: "error lines kept per job, default 20",
    history: "how many recent pipelines of the default branch to check each failed job against, default 0 (none)",
    jobs: "most failed jobs whose log is read, default 6",
  },
  returns:
    "{pipeline:{id, status, ref, sha, source, url, created}, failedJobs:[{id, name, stage, reason, allowFailure, url, runner, errors:[line], tail:[line], lines, history?:[{pipeline, status}]}], skippedLogs, downstream:[{pipeline, status, project, url}], defaultBranch, note}",
  example: 'await scripts.run("ci-failure", { mr: 12, history: 5 })',
};

const BAD = new Set(["failed"]);

export default async function ({ glab }, { mr, branch, pipeline, lines = 20, history = 0, jobs: maxJobs = 6 } = {}) {
  let id = pipeline ? String(pipeline) : null;
  let note = null;
  if (!id && mr) {
    const m = await glab.api(`projects/:id/merge_requests/${mr}`);
    id = String(m.head_pipeline?.id ?? m.pipeline?.id ?? "");
    branch ??= m.source_branch;
    if (!id) {
      const ps = await glab.api(`projects/:id/merge_requests/${mr}/pipelines`);
      id = ps?.[0]?.id ? String(ps[0].id) : null;
    }
    if (!id) return { pipeline: null, failedJobs: [], note: `merge request ${mr} has no pipeline` };
  }
  if (!id && branch) {
    const ps = await glab.api("projects/:id/pipelines", { fields: { ref: branch, order_by: "id", sort: "desc", per_page: 20 } });
    const f = ps.find((p) => BAD.has(p.status));
    if (!f) return { pipeline: null, failedJobs: [], note: `no failed pipeline among the last ${ps.length} on ${branch}${ps[0] ? `; the latest is ${ps[0].status} (pipeline ${ps[0].id})` : ""}` };
    id = String(f.id);
    if (ps[0].id !== f.id) note = `the latest pipeline on ${branch} is ${ps[0].status} (${ps[0].id}); this is the latest failed one`;
  }
  if (!id) throw new Error("ci-failure needs `mr`, `branch` or `pipeline`");

  const p = await glab.api(`projects/:id/pipelines/${id}`);
  const all = await glab.api(`projects/:id/pipelines/${id}/jobs`, { fields: { per_page: 100 }, paginate: true });
  const failed = all.filter((j) => j.status === "failed");
  if (p.status !== "failed" && !failed.length) note = [note, `pipeline ${id} is ${p.status}; it has no failed jobs`].filter(Boolean).join("; ");

  const bridges = await glab.api(`projects/:id/pipelines/${id}/bridges`, { fields: { per_page: 50 } }).catch(() => []);
  const downstream = bridges.filter((b) => b.downstream_pipeline && b.downstream_pipeline.status === "failed").map((b) => ({ pipeline: b.downstream_pipeline.id, status: b.downstream_pipeline.status, project: b.downstream_pipeline.project_id, url: b.downstream_pipeline.web_url, bridge: b.name }));

  let defaultBranch = null;
  let recent = [];
  if (history > 0 && failed.length) {
    defaultBranch = (await glab.api("projects/:id")).default_branch;
    const ps = (await glab.api("projects/:id/pipelines", { fields: { ref: defaultBranch, order_by: "id", sort: "desc", per_page: history + 1 } })).filter((x) => String(x.id) !== id).slice(0, history);
    recent = await Promise.all(ps.map(async (x) => ({ id: x.id, status: x.status, jobs: await glab.api(`projects/:id/pipelines/${x.id}/jobs`, { fields: { per_page: 100 }, paginate: true }).catch(() => []) })));
  }

  const failedJobs = [];
  for (const j of failed.slice(0, maxJobs)) {
    let t = { errors: [], tail: [], lines: 0 };
    try {
      t = await glab.trace(j.id, { errors: lines, tail: 12 });
    } catch (e) {
      t.error = e.message.slice(0, 200);
    }
    const row = { id: j.id, name: j.name, stage: j.stage, reason: j.failure_reason ?? null, allowFailure: !!j.allow_failure, url: j.web_url, runner: j.runner?.description ?? null, errors: t.errors, tail: t.tail, lines: t.lines };
    if (t.error) row.logError = t.error;
    if (recent.length) row.history = recent.map((r) => ({ pipeline: r.id, status: r.jobs.find((x) => x.name === j.name)?.status ?? "absent" }));
    failedJobs.push(row);
  }
  return {
    pipeline: { id: p.id, status: p.status, ref: p.ref, sha: p.sha?.slice(0, 10), source: p.source, url: p.web_url, created: p.created_at },
    failedJobs,
    skippedLogs: Math.max(0, failed.length - maxJobs),
    downstream,
    defaultBranch,
    note,
  };
}
