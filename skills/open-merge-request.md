Open a merge request in the project's own form: title, description, template and labels from what the project already does

1. Read how this project writes them. The last five merged:
   `await glab.api("projects/:id/merge_requests", { fields: { state: "merged", per_page: 5, order_by: "updated_at" } })`.
   Keep each `title` and `description`. Note the title form (a ticket key first? a type prefix?
   sentence case?), the length and headings of the descriptions, and the labels used.
2. Read the project's template, if any. List the folder
   `glab.api("projects/:id/repository/tree", { fields: { path: ".gitlab/merge_request_templates" } })`
   and read the file (text: `glab.run("api", "projects/:id/repository/files/" + encodeURIComponent(path) + "/raw?ref=" + target)`
   and take `.out`). When a default template exists, the description follows its headings.
3. Find the branch and the target. The source branch must already be pushed (`glab.api("projects/:id/repository/branches/" + encodeURIComponent(branch))`
   answers 404 when it is not; stop and say so, this kit does not push). The target is the
   project's default branch (`glab.api("projects/:id")` -> `default_branch`) unless the request names
   another.
4. Read what the branch changes, so the description says what the diff does:
   `glab.api("projects/:id/repository/compare", { fields: { from: target, to: source } })`
   gives `commits` and `diffs`. Say what changed and why. Do not copy commit subjects as the only
   content.
5. Write the title and description in the form from step 1 and the template from step 2. Fill
   every template section; write "n/a" in one that does not apply. Link the issue or ticket the
   request names with `Closes #<iid>` for a GitLab issue.
6. Never add attribution of any kind to the title, description, a commit or a comment: no
   "Co-Authored-By", no "Generated with", no session link, no mention of Claude or an AI tool.
   These repositories forbid it. Check the text for those words before sending.
7. Create it:
   `await glab.run("mr", "create", "--source-branch", source, "--target-branch", target, "--title", title, "--description", description, "--yes")`
   plus `--draft` when the request says draft, `--label a,b` for labels the recent merge requests
   use, `--assignee` and `--reviewer` only when named, `--remove-source-branch` only when the
   recent merge requests use it.
8. Read it back with `await scripts.run("mr-status", { branch: source })` and answer with the
   merge request number, URL, the title, the target and the pipeline status.
