// A client for GitLab through the `glab` command: merge requests, pipelines and jobs, issues,
// releases and the REST API, for one project by default. It reads and, when the caller asked for a
// change, acts (comment, approve, merge, retry, cancel, create, close, label): whatever glab can do
// with the user's login.
//
// Three checks. A call that changes anything on GitLab or on the local checkout needs `act` (the
// caller asked for a change); answers go to a cloud model, so output never carries a credential
// (token shapes, auth headers and URL passwords are masked, token and CI variable endpoints and
// commands that print a token are refused); and what never ends or waits for a person (--watch,
// --live, the interactive pipeline view, a log that is still being followed) is refused.
import { execFile } from "node:child_process";

const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};
const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};

// glab subcommands that only read, as "<group> <sub>" (or "<group>" alone when every use reads).
const READS = new Set([
  "mr list", "mr view", "mr diff", "mr issues", "mr approvers", "mr note list",
  "ci list", "ci status", "ci get", "ci lint", "ci config compile",
  "issue list", "issue view", "release list", "release view",
  "repo view", "repo list", "repo contributors", "repo search",
  "label list", "milestone list", "schedule list", "snippet list", "snippet view",
  "user events", "version", "help", "auth status",
]);

const flag = (rest, ...names) => rest.some((x) => names.some((n) => x === n || x.startsWith(n + "=")));
const valueOf = (rest, ...names) => {
  for (let i = 0; i < rest.length; i++) {
    for (const n of names) {
      if (rest[i] === n) return rest[i + 1];
      if (rest[i].startsWith(n + "=")) return rest[i].slice(n.length + 1);
    }
  }
  return undefined;
};

// Endpoints that hold credentials: tokens, CI variables, secure files, registration data.
const SECRET_ENDPOINT = /(^|\/)(variables|access_tokens|personal_access_tokens|impersonation_tokens|deploy_tokens|secure_files|runners\/[^/]+\/reset_authentication_token|runners\/reset_registration_token|registration_token|trigger)(\/|\?|$)/i;

/** Pull the endpoint, method and body flags out of a `glab api` argument list. */
function apiParts(rest) {
  const pos = [];
  let method = null;
  let hasBody = false;
  const fields = [];
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i];
    if (x === "-X" || x === "--method") method = rest[++i];
    else if (x.startsWith("--method=")) method = x.slice(9);
    else if (x === "-F" || x === "--field" || x === "-f" || x === "--raw-field") {
      hasBody = true;
      fields.push(rest[++i] ?? "");
    } else if (/^--(field|raw-field)=/.test(x)) {
      hasBody = true;
      fields.push(x.replace(/^[^=]+=/, ""));
    } else if (x === "--input" || x.startsWith("--input=")) {
      hasBody = true;
      fields.push("@input");
      if (x === "--input") i++;
    } else if (x === "-H" || x === "--header") fields.push(`header:${rest[++i] ?? ""}`);
    else if (["--hostname", "--placeholder", "--jq", "-q"].includes(x)) i++;
    else if (!x.startsWith("-")) pos.push(x);
  }
  const m = (method ?? (hasBody ? "POST" : "GET")).toUpperCase();
  return { endpoint: pos[0] ?? "", method: m, explicitMethod: method != null, fields };
}

/** Does `glab <args>` change anything? Throws for what is never allowed. */
function classify(a) {
  const [g, s = "", ...more] = a;
  const rest = a.slice(1);
  if (!g) deny("no glab subcommand");
  if (flag(a, "--live", "--watch")) deny("it follows a pipeline or job and never ends; poll with `glab ci get` or glab.api instead");
  if (a.includes("-w") && ["mr", "ci", "issue", "release", "repo"].includes(g)) deny("-w opens a browser or watches; neither ends here");
  if (flag(a, "--web")) deny("--web opens a browser");
  if (g === "config") deny("glab config can print the login's token");
  if (g === "auth" && s !== "status") deny("glab auth prints or changes the login's credentials");
  if (g === "auth" && (flag(a, "--show-token", "-t") || a.includes("-t"))) deny("it prints the login's token");
  if (g === "variable" || g === "securefile" || g === "token") deny(`glab ${g} holds CI secrets or tokens`);
  if (g === "ssh-key" || g === "gpg-key" || g === "deploy-key") deny(`glab ${g} is not needed to answer a question`);
  if (g === "ci" && s === "view") deny("glab ci view is interactive and never ends; use the ci-failure script or `glab ci get`");
  if (g === "ci" && s === "trace") deny("glab ci trace follows a job until it ends; use glab.trace(jobId, { tail, grep }) which reads the log once");
  if (g === "ci" && s === "status" && flag(more, "--live")) deny("--live never ends");
  if (g === "api") {
    const { endpoint, method, fields } = apiParts(rest);
    if (!endpoint) deny("glab api needs an endpoint");
    if (SECRET_ENDPOINT.test(endpoint)) deny("that endpoint holds tokens or CI variable values, and answers go to a cloud model");
    if (/\/artifacts$/.test(endpoint.split("?")[0]) || /\/repository\/archive/.test(endpoint)) deny("that endpoint returns a binary archive");
    for (const f of fields) {
      if (f.startsWith("header:") && /token|authorization|cookie/i.test(f)) deny("auth headers are not needed: glab adds the login itself");
      if (/^[^=]+=@/.test(f)) deny("a field read from a file or stdin could send a local file to GitLab");
    }
    if (/^graphql$/i.test(endpoint)) {
      const q = fields.filter((f) => /^query=/.test(f)).join(" ");
      return fields.includes("@input") || !q || /\b(mutation|subscription)\b/i.test(q);
    }
    return method !== "GET";
  }
  if (g === "mr" && s === "note" && more[0] === "list") return false;
  return !(READS.has(`${g} ${s}`) || READS.has(g));
}

// ---- masking: what reaches the model never carries a credential ----

const TOKEN_PREFIX = /\b(?:glpat|gldt|glptt|glrt|glrtr|glcbt|glimt|glagent|glsoat|glffct|gloas|glft|glwt)-[A-Za-z0-9_-]{6,}/g;
const MASKS = [
  [TOKEN_PREFIX, (m) => m.split("-")[0] + "-***"],
  [/\bGR1348941[A-Za-z0-9_-]{10,}/g, "GR1348941***"],
  [/\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/g, "gh***"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***"],
  [/((?:PRIVATE|JOB|DEPLOY|PROJECT|PIPELINE)-TOKEN|Authorization|Proxy-Authorization|Cookie)(\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;]+/gi, "$1$2***"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:'"]+(?::[^\s/@'"]*)?@/gi, "$1***@"],
  [/("(?:[\w-]*(?:token|secret|password|passwd|private_key)[\w-]*)"\s*:\s*")[^"]+(")/gi, "$1***$2"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "-----BEGIN PRIVATE KEY----- *** -----"],
];
// Environment-style assignments printed in a job log: DB_PASSWORD=..., export API_KEY: ...
const ASSIGN = /(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)[A-Za-z0-9_]*\b)(\s*[=:]\s*)(?!\*\*\*)("[^"]*"|'[^']*'|[^\s"']+)/gi;

const envSecrets = () => ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "GITLAB_API_TOKEN", "OAUTH_TOKEN", "CI_JOB_TOKEN", "GLAB_TOKEN"].map((k) => process.env[k]).filter((v) => v && v.length >= 8);

export function mask(s, { assignments = false } = {}) {
  let t = String(s ?? "");
  for (const v of envSecrets()) t = t.split(v).join("***");
  for (const [re, to] of MASKS) t = t.replace(re, to);
  if (assignments) t = t.replace(ASSIGN, "$1$2***");
  return t;
}

const SECRET_KEY = /token|secret|password|passwd|private_key/i;
/** Mask credential-looking values in parsed JSON, and the values of CI variables. */
export function redact(x, parent) {
  if (Array.isArray(x)) return x.map((v) => redact(v, parent));
  if (x && typeof x === "object") {
    const o = {};
    const isVar = typeof x.key === "string" && "value" in x && ("variable_type" in x || "masked" in x || "protected" in x);
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === "string" && v && (SECRET_KEY.test(k) || (isVar && k === "value"))) o[k] = "***";
      else o[k] = redact(v, k);
    }
    return o;
  }
  return typeof x === "string" ? mask(x) : x;
}

// ---- the program ----

function exec(args, { cwd, timeoutMs = 120_000 } = {}) {
  const env = { ...process.env, NO_COLOR: "1", NO_PROMPT: "true", GLAB_NO_PROMPT: "true", GLAB_PAGER: "cat", PAGER: "cat", GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", EDITOR: "true", VISUAL: "true", GIT_EDITOR: "true", BROWSER: "true", GIT_TERMINAL_PROMPT: "0" };
  for (const k of ["DEBUG", "GLAB_DEBUG", "LOG_LEVEL", "GITLAB_DEBUG"]) delete env[k]; // debug output prints request headers
  return new Promise((resolve) => {
    execFile("glab", args, { cwd, timeout: timeoutMs, maxBuffer: 64 << 20, encoding: "utf8", env }, (err, stdout, stderr) => {
      if (err?.code === "ENOENT") resolve({ code: 127, out: "", err: "glab is not installed: https://gitlab.com/gitlab-org/cli" });
      else resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout ?? "", err: stderr ?? "", ...(err?.killed ? { timedOut: true } : {}) });
    });
  });
}

/** "git@host:group/sub/project.git", "https://host/group/project", or "group/project" -> {host, path}. */
export function parseRepo(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/\.git$/, "").replace(/\/+$/, "");
  let host = null;
  let m = s.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i) ?? s.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (m) [, host, s] = m;
  s = s.replace(/^\/+/, "");
  if (!s.includes("/")) return null;
  if (host && /(^|\.)github\.com$/i.test(host)) return null;
  return { host, path: s };
}

// glab groups that take -R/--repo.
const TAKES_REPO = new Set(["mr", "ci", "issue", "release", "label", "milestone", "schedule", "snippet", "incident"]);

// The kit's module source: make(ctx) returns the `glab` global.
export function make({ settings, push, cwd, act }) {
  return makeGlab({ repo: settings?.GITLAB_REPO ?? null, cwd: cwd || process.cwd(), push, act: !!act });
}

export function makeGlab({ repo: repoSetting = null, cwd, push = () => {}, act = false, executor = exec }) {
  const parsed = parseRepo(repoSetting);
  const repoArg = parsed ? (parsed.host && parsed.host !== "gitlab.com" ? `${parsed.host}/${parsed.path}` : parsed.path) : null;
  const projectId = parsed ? encodeURIComponent(parsed.path) : null;
  const hostArgs = parsed?.host ? ["--hostname", parsed.host] : [];

  const withRepo = (a) => {
    if (!repoArg || !TAKES_REPO.has(a[0]) || flag(a, "-R", "--repo")) return a;
    return [...a, "-R", repoArg];
  };

  /** Build the exact argument list for a call, or throw. Exported through `plan` so a test can see it without running glab. */
  const plan = (args) => {
    const a = args.map(String);
    const changing = classify(a);
    if (changing && !act) notInThisAsk(`glab ${a.slice(0, 5).join(" ").slice(0, 80)}`);
    let b = withRepo(a);
    if (b[0] === "api") {
      b = [...b];
      const { endpoint } = apiParts(b.slice(1));
      const i = b.indexOf(endpoint, 1);
      if (projectId && i > 0) b[i] = endpoint.replace(/^\/?projects\/:id(?=\/|\?|$)/, `projects/${projectId}`);
      if (hostArgs.length && !flag(b, "--hostname")) b.push(...hostArgs);
    }
    return { args: b, changing };
  };

  const run = async (...args) => {
    const { args: a } = plan(args);
    const started = Date.now();
    const r = await executor(a, { cwd });
    let out = r.out;
    if (a[0] === "api") {
      try {
        out = JSON.stringify(redact(JSON.parse(out)));
      } catch {
        out = mask(out);
      }
    } else out = mask(out);
    const res = { code: r.code, out, err: mask(r.err).slice(0, 4000), ...(r.timedOut ? { timedOut: true } : {}) };
    push({ kind: "glab", detail: mask(`glab ${a.join(" ")}`).slice(0, 200), ms: Date.now() - started, code: res.code, size: res.out.length });
    return res;
  };

  /** A glab call whose output is JSON (--output json is added when the subcommand has it). Throws glab's error on failure. */
  const json = async (...args) => {
    const a = args.map(String);
    const wantsFlag = a[0] !== "api" && !flag(a, "-F", "--output") && !(a[0] === "ci" && a[1] === "get");
    const r = await run(...a, ...(wantsFlag ? ["--output", "json"] : []));
    if (r.code !== 0) throw new Error(`glab ${a.slice(0, 4).join(" ")}: ${(r.err || r.out).trim().slice(0, 500)}`);
    return r.out.trim() ? JSON.parse(r.out) : null;
  };

  const queryString = (fields) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
      else if (v != null) q.append(k, String(v));
    }
    return q.toString();
  };

  const api = async (endpoint, o = {}) => {
    const method = (o.method ?? "GET").toUpperCase();
    let path = String(endpoint).replace(/^\/+/, "");
    if (method === "GET") {
      // Query parameters go in the URL: glab turns -f/-F fields into a POST body.
      const { per_page, page, ...rest } = o.fields ?? {};
      const qs = queryString(o.paginate ? rest : o.fields);
      if (qs) path += (path.includes("?") ? "&" : "?") + qs;
    }
    const base = ["api", path, "-X", method];
    if (method !== "GET") for (const [k, v] of Object.entries(o.fields ?? {})) base.push(typeof v === "string" ? "-f" : "-F", `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    if (!o.paginate) return json(...base);
    // Pages by hand: glab's own --paginate output is several JSON documents back to back.
    const per = 100;
    const maxPages = o.maxPages ?? 10;
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const part = await json("api", `${path}${sep}per_page=${per}&page=${page}`, "-X", "GET");
      if (!Array.isArray(part)) return part;
      all.push(...part);
      if (part.length < per) break;
    }
    return all;
  };

  const ERR = /\b(error|failed|failure|fatal|panic|panicked|exception|traceback|assert(ion)?|cannot|could not|couldn't|not found|denied|timed out|exit code [1-9]|exited with|no such|unable to|unauthorized|forbidden)\b|✗|✖|FAIL\b|ERROR:|^E\s{2,}/i;

  return {
    /** The project every call is about, as "group/sub/project", or null when glab works it out from the folder. */
    repo: parsed?.path ?? null,
    /** True when this ask may change things. */
    act,

    run,
    json,
    api,
    plan,

    /**
     * A job's log, read once and reduced. The job is looked up first; a job that is still running returns what it has so far
     * (running: true), nothing is followed. o.grep (a regex string) keeps only matching lines, o.tail how many closing lines to return (default 40),
     * o.errors how many error lines to keep (default 30). ANSI codes, GitLab section markers and carriage-return redraws are removed; token and
     * password values are masked. Returns {job:{id,name,stage,status,failure_reason,url}, lines (total), running, errors:[line], tail:[line], matches?:[line]}.
     */
    async trace(jobId, o = {}) {
      const job = await api(`projects/:id/jobs/${encodeURIComponent(jobId)}`);
      const r = await run("api", `projects/:id/jobs/${encodeURIComponent(jobId)}/trace`);
      if (r.code !== 0) throw new Error(`glab api jobs/${jobId}/trace: ${(r.err || r.out).trim().slice(0, 300)}`);
      let text = r.out;
      // The API returns the raw log. `run` parsed nothing here, but a JSON-looking log was re-serialised: undo that.
      if (text.startsWith('"') && text.endsWith('"')) {
        try {
          text = JSON.parse(text);
        } catch {}
      }
      const clean = text
        .replace(/section_(?:start|end):\d+:[\w.-]+(?:\[[^\]]*\])*\r?\x1b\[0K/g, "")
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      const lines = mask(clean, { assignments: true })
        .split("\n")
        .map((l) => l.replace(/^.*\r(?!$)/, "").replace(/\r$/, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z \d\d[OE][+ ]?/, "").trimEnd())
        .filter((l) => l.trim());
      const out = {
        job: { id: job.id, name: job.name, stage: job.stage, status: job.status, failure_reason: job.failure_reason ?? null, url: job.web_url },
        lines: lines.length,
        running: ["running", "pending", "created"].includes(job.status),
      };
      if (o.grep) {
        const re = new RegExp(o.grep, "i");
        out.matches = lines.filter((l) => re.test(l)).slice(0, o.errors ?? 30).map((l) => l.slice(0, 300));
      }
      out.errors = [...new Set(lines.filter((l) => ERR.test(l)).map((l) => l.slice(0, 300)))].slice(-(o.errors ?? 30));
      out.tail = lines.slice(-(o.tail ?? 40)).map((l) => l.slice(0, 300));
      return out;
    },
  };
}
