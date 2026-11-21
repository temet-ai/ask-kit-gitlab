# ask-kit-gitlab

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about a GitLab project, and act on it when asked. A cheap model runs `glab` and
the GitLab API outside your agent's context, with your own `glab` login, and answers with merge
request numbers, pipeline and job ids, the failing log lines and links.

Questions of the kinds its bench holds, which agents had answered by hand with `glab`:

- In this project, is the merge request merged, and by which commit?
- What is the latest pipeline on the default branch, and did it pass?
- Which job failed in the last red pipeline, and what does the end of its log say?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) and the
[GitLab CLI](https://gitlab.com/gitlab-org/cli) (`glab`), logged in (`glab auth login`).

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-gitlab
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-gitlab        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-gitlab --yes  # installs and enables it
```

Restart your agents so `ask` lists `gitlab`. The kit answers about the project your agent works
in, taken from the `origin` remote.

## Settings

| Setting | Default | What it is |
|---|---|---|
| `GITLAB_REPO` | the `origin` remote of the folder your agent works in | `group/subgroup/project`, or a git remote URL, to pin another project |

Set it in the environment or in ask-kit's config as `domains.gitlab.settings.GITLAB_REPO`.

## What it carries

| | |
|---|---|
| Scripts | `mr-status` (state, merge commit, conflicts, pipeline with each job, approvals given and needed, unresolved threads), `ci-failure` (failed jobs of a pipeline, merge request or branch, each with the failing log lines and failure reason; optionally the same jobs on the default branch's last pipelines), `mr-changes` (files with line counts, the diff of a path, dependency version changes with downgrades called out), `find` (merge requests and issues about a topic), `activity` (merged, opened, closed, releases and pipeline results in N days) |
| Skills | `review-merge-request`, `green-pipeline`, `open-merge-request`: playbooks the investigator loads when the job calls for one |
| Roles | `reviewer` for a merge request review, `pipeline-fixer` for a red pipeline |

Each script also runs with no model: `ask-kit run gitlab mr-status mr=12`, or
`ask(do: "gitlab.mr-status")` from an agent.

## What it can change

When the request asks for a change, it comments on merge requests and issues, approves, merges,
rebases, retries or cancels pipelines and jobs, creates and closes merge requests and issues,
sets labels and resolves threads, as you, with your `glab` login's rights. A question never
changes anything: `glab.mjs` sorts every `glab` call, and every `glab api` method, into reading
or changing, and a changing call is refused unless the caller asked for a change (`act`).

`glab.mjs` also checks each call before it runs:

- What prints the login's token or CI secrets is refused: `glab auth token`, `--show-token`,
  `glab config`, `glab variable`, and the API endpoints for CI variables, access tokens, deploy
  tokens and secure files. `glpat-` tokens, `PRIVATE-TOKEN` and `Authorization` headers and URL
  passwords are masked in all output, and so are passwords and tokens printed in a job log.
  What the investigator reads goes to a model.
- What never ends is refused: `--watch`, `--live`, `glab ci view` and `glab ci trace`. A job's log
  is read once through `glab.trace`.
- A field read from a file (`-F key=@path`) is refused, so a local file cannot be sent to GitLab.

The skills and instructions tell it never to add attribution of any kind (Co-Authored-By, a
session link, a "generated with" line) to a comment, title or description.

## How well it works

`bench/questions.json` holds six questions put to whichever project you run it in, and two script
runs. It was built against private projects, so its model questions have no fixed answers: the
patterns check the shape of an answer. It has not been run on a model yet; `ask-kit kit test
gitlab` runs it. The scripts were run against a real project with no model, and the read and act
checks were run with the executor replaced.

[RECIPE.md](RECIPE.md) says what it reads and runs, and how to rebuild it.

MIT licence.
