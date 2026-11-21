export const meta = {
  purpose:
    "What a merge request changes: the files with added and deleted line counts, and for one path the diff itself. Version changes in dependency files (package.json, requirements, pyproject, Cargo.toml, go.mod, pom.xml, Gradle files, Dockerfiles, CI images) are listed with the old and new version and whether the version went down.",
  params: {
    mr: "merge request number (required)",
    path: "a file path (or a part of one) whose diff to include, optional",
    max: "most diff characters returned for `path`, default 20000",
  },
  returns:
    "{mr:{iid, title, state, source, target, url}, fileCount, added, deleted, files:[{path, oldPath, change, added, deleted, collapsed}], bumps:[{file, name, from, to, direction}], downgrades:[bump], lockfiles:[path], patch?:[{path, diff}], note}",
  example: 'await scripts.run("mr-changes", { mr: 12 })',
};

const DEP_FILE = /(^|\/)(package\.json|requirements[\w.-]*\.txt|constraints[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.py|setup\.cfg|Cargo\.toml|go\.mod|pom\.xml|[\w.-]*\.gradle(\.kts)?|libs\.versions\.toml|gradle\.properties|[\w.-]*\.csproj|Directory\.Packages\.props|Gemfile|composer\.json|Dockerfile[\w.-]*|\.gitlab-ci\.ya?ml|[\w.-]*\.ya?ml|\.tool-versions|[\w.-]*\.tf)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|gradle\.lockfile|packages\.lock\.json)$/i;
const V = "(\\d[\\w.+-]*)";

// One line -> {name, version} or null.
function dep(line, ctx) {
  let m;
  if ((m = line.match(new RegExp(`^\\s*"([@\\w./-]+)"\\s*:\\s*"[\\^~>=<v\\s]*${V}"`)))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`group\\s*=\\s*"([^"]+)"\\s*,\\s*name\\s*=\\s*"([^"]+)"\\s*,\\s*version\\s*=\\s*"[\\^~=<>\\s]*${V}"`)))) return { name: `${m[1]}:${m[2]}`, version: m[3] };
  if ((m = line.match(new RegExp(`id\\(\\s*"([^"]+)"\\s*\\)\\s*version\\s*"${V}"`)))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`['"]([\\w.-]+:[\\w.-]+):${V}['"]`)))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`^\\s*([A-Za-z0-9_.\\[\\]-]+)\\s*(?:===|==|~=|>=|<=|=)\\s*['"]?[\\^~=<>\\s]*${V}['"]?\\s*(?:[;#,].*)?$`)))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`^\\s*([\\w.-]+)\\s*=\\s*\\{[^}]*version\\s*=\\s*"[\\^~=<>\\s]*${V}"`)))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`^\\s*(?:require\\s+)?([\\w./~-]+\\.[\\w./~-]+)\\s+v${V}`)))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`^\\s*(?:FROM|image:)\\s+['"]?([^\\s:@'"]+):${V}`, "i")))) return { name: m[1], version: m[2] };
  if ((m = line.match(new RegExp(`<version>${V}</version>`)))) return { name: ctx.artifact ? `${ctx.artifact}` : "(pom version)", version: m[1] };
  if ((m = line.match(new RegExp(`^\\s*([\\w.-]+)\\s+${V}\\s*$`))) && /tool-versions/.test(ctx.file)) return { name: m[1], version: m[2] };
  return null;
}

const parts = (v) => String(v).split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? +x : x));
function compare(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p < q ? -1 : 1;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

function bumpsOf(file, diff) {
  const removed = new Map();
  const added = new Map();
  const ctx = { file, artifact: null };
  for (const raw of String(diff).split("\n")) {
    if (raw.startsWith("@@")) continue;
    const sign = raw[0] === "+" || raw[0] === "-" ? raw[0] : " ";
    const line = raw.slice(1);
    const art = line.match(/<artifactId>([^<]+)<\/artifactId>/);
    if (art) ctx.artifact = art[1];
    if (sign === " ") continue;
    const d = dep(line, ctx);
    if (!d) continue;
    (sign === "-" ? removed : added).set(d.name, d.version);
  }
  const out = [];
  for (const [name, from] of removed) {
    const to = added.get(name);
    if (to == null || to === from) continue;
    const c = compare(from, to);
    out.push({ file, name, from, to, direction: c < 0 ? "up" : c > 0 ? "down" : "changed" });
  }
  for (const [name, to] of added) if (!removed.has(name)) out.push({ file, name, from: null, to, direction: "added" });
  for (const [name, from] of removed) if (!added.has(name)) out.push({ file, name, from, to: null, direction: "removed" });
  return out;
}

const count = (diff) => {
  let a = 0;
  let d = 0;
  for (const l of String(diff).split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) a++;
    else if (l.startsWith("-") && !l.startsWith("---")) d++;
  }
  return { added: a, deleted: d };
};

export default async function ({ glab }, { mr, path, max = 20000 } = {}) {
  if (!mr) throw new Error("mr-changes needs `mr`");
  const m = await glab.api(`projects/:id/merge_requests/${mr}`);
  const diffs = await glab.api(`projects/:id/merge_requests/${mr}/diffs`, { fields: { per_page: 100 }, paginate: true, maxPages: 8 });
  const files = diffs.map((f) => {
    const c = count(f.diff);
    return { path: f.new_path, oldPath: f.old_path !== f.new_path ? f.old_path : undefined, change: f.new_file ? "A" : f.deleted_file ? "D" : f.renamed_file ? "R" : "M", added: c.added, deleted: c.deleted, collapsed: !!(f.collapsed || f.too_large) || undefined };
  });
  const bumps = diffs.filter((f) => DEP_FILE.test(f.new_path) && f.diff).flatMap((f) => bumpsOf(f.new_path, f.diff));
  const out = {
    mr: { iid: m.iid, title: m.title, state: m.state, source: m.source_branch, target: m.target_branch, url: m.web_url },
    fileCount: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    deleted: files.reduce((n, f) => n + f.deleted, 0),
    files: files.slice(0, 300),
    bumps: bumps.slice(0, 100),
    downgrades: bumps.filter((b) => b.direction === "down"),
    lockfiles: diffs.filter((f) => LOCKFILE.test(f.new_path)).map((f) => f.new_path),
    note: [
      files.length > 300 ? `${files.length - 300} files not listed` : null,
      diffs.some((f) => f.collapsed || f.too_large) ? "some diffs are collapsed or too large; fetch them with glab.api(`projects/:id/repository/commits/<sha>/diff`) or read the file at the branch" : null,
      m.changes_count && String(m.changes_count).replace("+", "") != String(files.length) ? `GitLab reports ${m.changes_count} changes; ${files.length} diffs were returned` : null,
    ].filter(Boolean).join("; ") || null,
  };
  if (path) {
    const hit = diffs.filter((f) => f.new_path.includes(path) || f.old_path.includes(path));
    let budget = max;
    out.patch = hit.map((f) => {
      const d = String(f.diff ?? "");
      const cut = d.slice(0, Math.max(0, budget));
      budget -= cut.length;
      return { path: f.new_path, diff: cut + (cut.length < d.length ? `\n[cut: ${d.length - cut.length} more characters]` : "") };
    });
    if (!hit.length) out.note = [out.note, `no changed file matches ${path}`].filter(Boolean).join("; ");
  }
  return out;
}
