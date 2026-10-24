# Workflow

How the team works in this repo. `CLAUDE.md` imports this file, so it loads into every session.

## Writing for whoever comes next

The next reader is capable and knows what the writer could not. So the docs inform rather than
direct: what is true, why, and what it cost. Directions are Tyler's rules, marked as his, and they
are hard limits. Facts that can go stale carry a date, and a time this weekend. Each fact is said
once, in one place. `CLAUDE.md` and this file load into every session, so keep each under 200
lines. Decisions go into the repo so the next session doesn't re-ask: the solution and the plan
in `docs/PLAN.md`, a component's design in its own folder, workflow decisions here.

## Rules

These rules were carried over on 2026-10-24 from Tyler's earlier projects and his Claude memory.
They are Tyler's except where marked *(proposed)*. Proposed items were added for this hackathon
and aren't confirmed yet. Ankit hasn't reviewed any of them yet (2026-10-24). Where a rule says
Tyler, whether Ankit can also approve is open.

**Git and PRs**

- Agents commit and push to non-`main` branches without asking, and say so afterwards.
- Pushing to `main` needs Tyler's explicit OK. An agent merges a PR only when Tyler explicitly
  says to, and that OK covers that PR only. Otherwise Tyler merges.
- PRs open as drafts. The agent marks its PR ready for review itself once the work is done,
  verified and reviewed. Un-drafting is not Tyler's job (2026-10-24).
- Branch off `main`, one branch per change, named `claude/<slug>`. Stack a PR on another branch
  only when it truly depends on it.
- Commit messages and PR bodies explain *why*. Subjects are plain sentence-case descriptions of
  the change *(proposed, matching his earlier repos)*.
- PR bodies follow `.github/pull_request_template.md`. Its comments say what each section needs.
  GitHub pre-fills the template only for PRs opened in the web UI, so an agent opening one with
  `gh` writes the sections itself.
- Every PR closes at least one issue, and its body starts with only its `Closes #N` lines. Work no
  issue covers gets one filed first (2026-10-24). This keeps the issue list a record of what
  shipped.
- A PR that changes what a user sees or does shows it (2026-10-24):
  - before and after screenshots of each changed screen;
  - a short video or GIF for a flow.

  `node .github/pr-media.mjs <pr> <files>` puts them on the `pr-media` branch and prints the
  markdown, since GitHub's API can't attach files to a PR. Images and GIFs show inline. An mp4
  linked that way downloads rather than plays; a video dragged into the PR in the web UI plays.
- Before pushing to a branch someone else touches, `git fetch` and rebase.
- Before pushing follow-ups, check the PR is still open. Pushes to a merged PR's branch are
  silently stranded.
- Never overwrite someone else's uncommitted work.
- Do tiny, clearly right fixes (a typo, a one-line bug) in the same session rather than offering
  them. Fold one into the PR at hand and mention it there. Otherwise its issue is one line.

**Issues and labels**

- Every issue carries at least one label. The labels sit on independent axes:
  - **Kind.** `bug`, `Feature` or `Task`, spelled exactly so; `--add-label` fails on other
    spellings. An open design question takes `question` instead.
  - **Priority.** `priority: immediate`, `priority: before demo` or `priority: if time`
    (2026-10-24). One label each, on open issues only.
  - **Where the work lives.** `PR needed` is a change in this repo. `non-PR needed` is work no PR
    can do: an account, a decision, something in the world. An issue can carry both.
  - **Who filed it.** A model filing on its own initiative adds `(from <model>)` to the title and
    labels it `from: Opus` or `from: Sonnet`. An issue Tyler asks for is `from: Tyler`, with no
    title suffix, even though a model typed it. Ankit's are `from: Ankit`.
  - **Area.** `area: norn`, `area: plm`, `area: erp` or `area: bowman` (Bowman's data and its
    Norn configuration), matching the folders in `CLAUDE.md`.
- Implementation issues belong to one of the milestones in `docs/PLAN.md`, which are also GitHub
  milestones. Priority follows the milestone unless there's a reason.
- An issue Tyler asks to log captures his idea and the obvious why, in his shape, not a researched
  spec. Research comes from whoever picks it up.
- Why an issue closed is its `state_reason` (`completed`, `not_planned`, `duplicate`), not a
  label. Add no new label without a reason; one-offs dilute the axes.

**Review**

- Sonnet subagents implement and Opus agents review (2026-10-18), with `model` always set
  explicitly. Opus implementers drained Tyler's usage.
- In a 2026-10-20 head-to-head Tyler ran, Haiku fixed the example rather than the bug and used more
  tokens than Sonnet.
- One fresh-context review when the work is done, not mid-change. Give the reviewer the goal and
  reasoning as facts. *(proposed)* Findings are reproduced, not asserted.
- *(proposed)* Review is worth its time on money and forecast arithmetic, approval and permission
  logic, the SpacetimeDB schema, and the demo path. Doc-only PRs need none. Batch small follow-ups
  into one review. One review covers the whole demo build before the freeze.

**Verifying**

- There is no CI (2026-10-24). Local checks are the CI: run the typecheck, tests and build before
  handing over, and say which ran.
- A status flag, log line or success page is not proof. Check what actually took effect.
- Verify on the real path: rehearse the live demo end to end on the machine and network it will
  run on.
- Smoke-test any new pipeline, agent loop or paid-API config once before repeating or scaling it.
  A big dumb failure should fail once, not three times.
- Make one real call to each external interface (SpacetimeDB, any LLM or finance API) before
  building on its assumed shape.
- Mock output is labelled mock on screen and in logs, and is never shown as live. Hyphenate's
  judges ask what's real, what's simulated, and how we know.

**Secrets and privacy**

- Tokens and keys never appear in tool output, logs, issues, PRs or chat. `cut -d= -f1` on a bare
  token prints all of it, which is how part of one leaked before. Keys live in an untracked `.env`.
- The repo goes public for Devpost, and git history is permanent. Scan the staged diff for secrets
  and personal data before every push. If a secret leaks anywhere, say so at once: it needs
  rotating.
- No personal data in the repo, on Devpost or in the video: emails, phone numbers, private repo
  names, internal URLs.
- One-copy local files (`.env`, recordings, database dumps) are moved aside, never overwritten.

**Autonomy**

- Get the work done. Ask about scope or architecture forks only, never routine choices like a
  dependency, a type error or a branch name (2026-09-14). A fork that touches the other person's
  part is worth asking about.
- These need Tyler's ask every time: the Devpost submission, making the repo public, posting to
  Slack, sponsors or organizers, new paid plans or credits beyond the keys already in `.env`,
  deleting branches or data, force-pushing a branch someone else uses, and touching any repo other
  than this one.
- An authorization covers exactly what was named: those PRs, that window, this repo. When scope is
  ambiguous, treat it as not covered. An agent once read "merge devmain PRs and sibling PRs" as
  covering sibling repos' `main` branches, and it didn't.
- If a permission check or the auto-mode classifier blocks an action, report what was blocked.
  Don't retry by another route.
- If a source or API is blocked (a 403, a CAPTCHA, a sponsor API down), say so and stop
  escalating; don't route around it (2026-09-20).
- A device, account, VM or API key reachable from this machine is not permission to use it.
- A parked idea stays parked. Don't build follow-on scope unasked.
- A rename or relabel is never the fix for something that doesn't work. Make it work.
- Copy a pattern that works (a UI, a layout, a library) rather than inventing one.

**Talking to Tyler**

- Lead with the point. Use 1-3 lines when they'll do: smallest answer first, gaps after. He
  doesn't read walls of text (2026-10-17).
- Every question stands alone in words: what it is, what is being decided, and your lean. PR and
  task numbers go in brackets as references, never as the whole question.
- Before calling something undocumented or unconfirmed, open the vendor's own docs page that
  matches the question and quote it (2026-10-23). Search snippets and third-party blogs aren't
  enough. This covers Devpost, Cal Hacks, Hyphenate and SpacetimeDB.
- A hand-off covers what's done, what's untested, the judgment calls made, the state left behind,
  and what needs Tyler. Before Tyler sleeps, agree on the allowed actions and a stop time. Leave
  that report at a known path.
- A narrow complaint gets a narrow fix. Don't restructure what he didn't mention (2026-10-01).
- *(proposed)* Use wording Tyler supplies (a tagline, the pitch) verbatim.

**Writing: README, Devpost, the video script**

- Claims come only from what is built and verified, or what Tyler stated. Assumptions are labelled
  as assumptions, and only what exists is documented.
- Tyler's anti-slop criteria, from his slop eval and pitch deck (2026-09): no em dashes, few
  negations, no slogans or buzzwords, no preamble or repetition, and concrete numbers.
- Revise from the current best draft with a strong model. Fifty blind parallel Haiku cover-letter
  drafts were all bad (2026-09-24). Parallel rounds stay small (3-5) and are seeded from the best
  draft so far.
- *(proposed)* Copy is cold-read by a person, or a model other than the one that wrote it.

**The demo**

- Cal Hacks recommends a first Devpost draft by Saturday night. The code-freeze time, the video
  deadline and who records the video aren't set yet (2026-10-24).
- *(proposed)* Deploy early. Freeze at a named commit, demo the exact build that was tested, and
  don't redeploy during judging. The demo environment is reproducible from the repo, and anything
  applied by hand is written down.
- *(proposed)* The deployed demo instance is never a test instance. Wiping its data, republishing
  its schema or rotating its keys needs Tyler's OK.
- Demo screens summarise rather than enumerate. Use few words on buttons, and no UI text explaining
  what the app just did (2026-10-18).

**Subagents**

- A brief carries the live constraints: frozen branches, banned actions, which paths. Delegated
  output is a claim: count the files, read the diff.
- Tell parallel agents up front to make design calls themselves and list them in the PR body.
- Plan for a usage-limit stall. On 2026-10-21, seven parallel Sonnet implementers hit the
  five-hour limit and stalled until the reset. Resuming each with SendMessage picked up cleanly.
- Each parallel agent gets its own worktree at a short path, such as `../w-<x>`. Deep worktree
  paths broke `npm ci` (esbuild `ENOENT`) on Windows.
- Session crons can silently never fire after a restart or a usage limit. Verify the outcome
  rather than presenting a cron as the plan.
