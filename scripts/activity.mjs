export const meta = {
  purpose:
    "What happened in the project in a time window: merge requests merged, opened and closed, issues opened and closed, releases, and pipelines by result on a branch (with the failing ones named).",
  params: { days: "how far back, default 7", branch: "only pipelines on this branch, optional" },
  returns:
    "{since, merged:[{iid, title, author, at, commit}], opened:[...], closed:[...], issuesOpened:[...], issuesClosed:[...], releases:[{tag, name, at}], pipelines:{total, complete, byStatus, failed:[{id, ref, source, at}]}}",
  example: 'await scripts.run("activity", { days: 7 })',
};

export default async function ({ glab }, { days = 7, branch } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const pull = (path, fields) => glab.api(`projects/:id/${path}`, { fields: { per_page: 100, order_by: "updated_at", sort: "desc", ...fields }, paginate: true, maxPages: 3 });
  const row = (x, at) => ({ iid: x.iid, title: x.title, author: x.author?.username, at: String(x[at] ?? "").slice(0, 16) });
  const [updatedMrs, createdMrs, createdIssues, updatedIssues, releases, pipes] = await Promise.all([
    pull("merge_requests", { updated_after: since, scope: "all" }),
    pull("merge_requests", { created_after: since, scope: "all" }),
    pull("issues", { created_after: since, scope: "all" }),
    pull("issues", { updated_after: since, state: "closed", scope: "all" }),
    glab.api("projects/:id/releases", { fields: { per_page: 20 } }).catch(() => []),
    pull("pipelines", { updated_after: since, order_by: "id", ...(branch ? { ref: branch } : {}) }),
  ]);
  const merged = updatedMrs.filter((m) => m.state === "merged" && m.merged_at >= since);
  const closed = updatedMrs.filter((m) => m.state === "closed" && m.closed_at >= since);
  const byStatus = {};
  for (const p of pipes) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  return {
    since: since.slice(0, 10),
    merged: merged.map((m) => ({ ...row(m, "merged_at"), commit: (m.merge_commit_sha ?? m.squash_commit_sha)?.slice(0, 10) ?? null })),
    opened: createdMrs.map((m) => row(m, "created_at")),
    closed: closed.map((m) => row(m, "closed_at")),
    issuesOpened: createdIssues.map((i) => row(i, "created_at")),
    issuesClosed: updatedIssues.filter((i) => i.closed_at >= since).map((i) => row(i, "closed_at")),
    releases: releases.filter((r) => (r.released_at ?? r.created_at) >= since).map((r) => ({ tag: r.tag_name, name: r.name, at: (r.released_at ?? r.created_at)?.slice(0, 10) })),
    pipelines: {
      total: pipes.length,
      complete: pipes.length < 300,
      byStatus,
      failed: pipes.filter((p) => p.status === "failed").slice(0, 20).map((p) => ({ id: p.id, ref: p.ref, source: p.source, at: p.created_at?.slice(0, 16) })),
    },
  };
}
