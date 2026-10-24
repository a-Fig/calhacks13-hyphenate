#!/usr/bin/env node
// Uploads screenshots and videos for a PR to the `pr-media` branch, under <pr>/, and prints the
// markdown to paste into the PR body. GitHub's API cannot attach files to a PR, and this repo is
// private, so the PR embeds `blob/...?raw=true` links, which render for anyone who can see the repo.
// Images and GIFs show inline. Other files are linked; an mp4 is served as octet-stream with
// nosniff, so the link downloads it rather than playing it (GitHub plays only uploaded attachments).
//
//   node .github/pr-media.mjs <pr-number> <file>...
//
// It commits with plumbing on a throwaway index, so the working tree, the index and the current
// branch are untouched. A name already under <pr>/ is replaced. Blobs are stored byte for byte
// (`--no-filters`), whatever .gitattributes says about the name. A push that loses a race with
// another upload is retried on the new tip; nothing is ever force-pushed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BRANCH = "pr-media";
const ATTEMPTS = 3;
const die = (msg) => { console.error(msg); process.exit(2); };

const [pr, ...files] = process.argv.slice(2);
if (!/^\d+$/.test(pr ?? "") || files.length === 0) die("usage: node .github/pr-media.mjs <pr-number> <file>...");
const names = files.map((f) => {
  if (!statSync(f, { throwIfNoEntry: false })?.isFile()) die(`not a file: ${f}`);
  return path.basename(f).replace(/[^\w.-]+/g, "-");
});
// before/home.png and after/home.png would both land on <pr>/home.png, the second replacing the first.
const dup = names.find((n, i) => names.indexOf(n) !== i);
if (dup) die(`two files would upload as ${pr}/${dup}; rename one (e.g. home-before.png, home-after.png)`);

const git = (args, env) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }).trim();

// The links go to GitHub whatever origin's URL looks like (scp, ssh://, a token in an https URL,
// a proxy), so take owner/repo out of it, and never print the URL itself.
const origin = git(["remote", "get-url", "origin"]);
let slug = origin.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
if (!slug) {
  try { slug = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" }).trim(); }
  catch { die(`origin is not a GitHub URL and gh could not name the repo`); }
}

const tmp = mkdtempSync(path.join(tmpdir(), "pr-media-"));
const index = path.join(tmp, "index");
try {
  const blobs = files.map((f) => git(["hash-object", "-w", "--no-filters", f]));
  for (let attempt = 1; ; attempt++) {
    // Exit 2 from ls-remote means the branch does not exist yet (the first upload); anything else
    // (no network, no auth) throws here rather than being taken for an empty branch.
    let parent = null;
    try {
      git(["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${BRANCH}`]);
      git(["fetch", "-q", "origin", `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
      parent = git(["rev-parse", `refs/remotes/origin/${BRANCH}`]);
    } catch (e) {
      if (e.status !== 2) throw e;
    }
    rmSync(index, { force: true });
    if (parent) git(["read-tree", parent], { GIT_INDEX_FILE: index });
    names.forEach((name, i) =>
      git(["update-index", "--add", "--cacheinfo", `100644,${blobs[i]},${pr}/${name}`], { GIT_INDEX_FILE: index }));
    const tree = git(["write-tree"], { GIT_INDEX_FILE: index });
    const commit = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `Media for #${pr}`]);
    try {
      git(["push", "-q", "origin", `${commit}:refs/heads/${BRANCH}`]);
      break;
    } catch (e) {
      const lost = /rejected|fetch first|non-fast-forward|incorrect old value|stale info/.test(String(e.stderr));
      if (!lost || attempt >= ATTEMPTS) throw e;
      console.error(`another upload moved ${BRANCH}; retrying (${attempt}/${ATTEMPTS - 1})`);
    }
  }
  names.forEach((name) => {
    const url = `https://github.com/${slug}/blob/${BRANCH}/${pr}/${name}?raw=true`;
    console.log(/\.(png|jpe?g|gif|webp)$/i.test(name) ? `![${name}](${url})` : `[${name}](${url})`);
  });
} catch (e) {
  console.error(e.stderr ? String(e.stderr).trim() : e.message);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
