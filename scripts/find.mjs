export const meta = {
  purpose:
    "Which merge requests and issues are about something: GitLab search over titles and descriptions in the project, open and closed, newest first, with the line that matched.",
  params: {
    query: "a few distinctive words, e.g. 'rate limit'",
    kind: "'mr', 'issue' or both (default)",
    state: "'opened', 'closed', 'merged' (merge requests only) or all (default)",
    author: "a username, optional",
    max: "results per kind, default 15",
  },
  returns: "{query, items:[{kind, iid, title, state, author, updated, url, labels, source?, match}], counts:{mr, issue}}",
  example: 'await scripts.run("find", { query: "rate limit" })',
};

export default async function ({ glab }, { query, kind, state, author, max = 15 } = {}) {
  if (!query) throw new Error("find needs `query`");
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const matchOf = (body) => {
    const line = String(body ?? "").split("\n").find((l) => words.some((w) => l.toLowerCase().includes(w)));
    return line ? line.trim().slice(0, 200) : null;
  };
  const fields = (extra) => ({ search: query, in: "title,description", scope: "all", order_by: "updated_at", sort: "desc", per_page: Math.min(100, max), ...(author ? { author_username: author } : {}), ...extra });
  const [mrs, issues] = await Promise.all([
    kind === "issue" ? [] : glab.api("projects/:id/merge_requests", { fields: fields(state && state !== "all" ? { state } : {}) }),
    kind === "mr" || state === "merged" ? [] : glab.api("projects/:id/issues", { fields: fields(state && state !== "all" ? { state } : {}) }),
  ]);
  const row = (k) => (x) => ({
    kind: k,
    iid: x.iid,
    title: x.title,
    state: x.state,
    author: x.author?.username,
    updated: x.updated_at?.slice(0, 10),
    url: x.web_url,
    labels: x.labels,
    ...(k === "mr" ? { source: x.source_branch, mergeCommit: x.merge_commit_sha?.slice(0, 10) ?? null } : {}),
    match: matchOf(x.description) ?? (words.some((w) => String(x.title).toLowerCase().includes(w)) ? "(in the title)" : null),
  });
  const items = [...mrs.slice(0, max).map(row("mr")), ...issues.slice(0, max).map(row("issue"))].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return { query, items, counts: { mr: mrs.length, issue: issues.length } };
}
