export const meta = {
  purpose:
    "Where a merge request stands: state, whether it merged and by which commit, mergeable or conflicts, the pipeline with each job's result, approvals given and still needed, the discussion threads still unresolved with their last note, and how many files it changes. Without `mr`, the merge request of the current branch (or of `branch`).",
  params: { mr: "merge request number (iid), optional", branch: "source branch, optional (default: the current branch's)" },
  returns:
    "{iid, title, state, draft, author, source, target, url, merged:{by, at, commit, squashCommit}|null, mergeable:{status, conflicts, blockingDiscussionsResolved}, pipeline:{id, status, url, jobs:{total, byStatus, failed:[{id, name, stage, allowFailure}], running:[name]}}|null, approvals:{required, left, approvedBy:[name], rules:[{name, approved, needs}]}|null, unresolved:[{id, path, line, author, last}], changesCount, labels, updated}",
  example: 'await scripts.run("mr-status", { mr: 12 })',
};

export default async function ({ glab }, { mr, branch } = {}) {
  let iid = mr ? String(mr) : null;
  if (!iid) {
    const found = branch
      ? await glab.api("projects/:id/merge_requests", { fields: { source_branch: branch, state: "all", order_by: "updated_at", per_page: 1 } })
      : [await glab.json("mr", "view")];
    iid = found?.[0]?.iid ? String(found[0].iid) : null;
    if (!iid) return { note: `no merge request found for ${branch ?? "the current branch"}` };
  }
  const m = await glab.api(`projects/:id/merge_requests/${iid}`);
  const name = (u) => u?.name ?? u?.username ?? null;

  const hp = m.head_pipeline ?? m.pipeline;
  const jobsP = hp?.id ? glab.api(`projects/:id/pipelines/${hp.id}/jobs`, { fields: { per_page: 100 }, paginate: true }).catch(() => []) : null;
  const discussionsP = glab.api(`projects/:id/merge_requests/${iid}/discussions`, { paginate: true }).catch(() => []);
  const approvalsP = glab.api(`projects/:id/merge_requests/${iid}/approvals`).then((a) => ({ a }), (e) => ({ e }));
  const rulesP = glab.api(`projects/:id/merge_requests/${iid}/approval_state`).then((r) => r.rules ?? [], () => []);

  let pipeline = null;
  if (hp?.id) {
    const jobs = await jobsP;
    const byStatus = {};
    for (const j of jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    pipeline = {
      id: hp.id,
      status: hp.status,
      url: hp.web_url,
      jobs: {
        total: jobs.length,
        byStatus,
        failed: jobs.filter((j) => j.status === "failed").map((j) => ({ id: j.id, name: j.name, stage: j.stage, allowFailure: !!j.allow_failure })),
        running: jobs.filter((j) => ["running", "pending"].includes(j.status)).map((j) => j.name).slice(0, 15),
      },
    };
  }

  // Approvals are a paid feature on some tiers; a refusal is reported, not fatal.
  let approvals = null;
  const ar = await approvalsP;
  if (ar.e) approvals = { note: `approvals not available: ${ar.e.message.slice(0, 120)}` };
  else {
    const a = ar.a;
    const rules = await rulesP;
    approvals = {
      required: a.approvals_required ?? null,
      left: a.approvals_left ?? null,
      approved: a.approved ?? null,
      approvedBy: (a.approved_by ?? []).map((x) => name(x.user)),
      rules: rules.map((r) => ({ name: r.name, approved: r.approved, needs: r.approvals_required, by: (r.approved_by ?? []).map(name) })).slice(0, 15),
    };
  }

  const discussions = await discussionsP;
  const unresolved = discussions
    .filter((d) => d.notes?.some((n) => n.resolvable) && !d.notes.filter((n) => n.resolvable).every((n) => n.resolved))
    .map((d) => {
      const first = d.notes[0];
      const last = d.notes[d.notes.length - 1];
      return {
        id: d.id,
        path: first.position?.new_path ?? null,
        line: first.position?.new_line ?? first.position?.old_line ?? null,
        author: first.author?.username,
        last: `${last.author?.username}: ${String(last.body ?? "").replace(/\s+/g, " ").slice(0, 200)}`,
        notes: d.notes.length,
      };
    });

  return {
    iid: m.iid,
    title: m.title,
    state: m.state,
    draft: !!m.draft,
    author: m.author?.username,
    source: m.source_branch,
    target: m.target_branch,
    url: m.web_url,
    merged: m.state === "merged" ? { by: name(m.merged_by ?? m.merge_user), at: m.merged_at, commit: m.merge_commit_sha?.slice(0, 10) ?? null, squashCommit: m.squash_commit_sha?.slice(0, 10) ?? null } : null,
    closedAt: m.state === "closed" ? m.closed_at : null,
    mergeable: { status: m.detailed_merge_status ?? m.merge_status, conflicts: !!m.has_conflicts, blockingDiscussionsResolved: m.blocking_discussions_resolved ?? null },
    pipeline,
    approvals,
    unresolved,
    changesCount: m.changes_count ?? null,
    labels: m.labels,
    updated: m.updated_at,
  };
}
