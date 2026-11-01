import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Inspect Git objects, never the untracked local archive. Do not print secrets.
const gitOptions = {
  cwd: resolve(fileURLToPath(new URL("../", import.meta.url))),
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true
};

function git(args, options = {}) {
  const result = spawnSync("git", ["-c", `safe.directory=${gitOptions.cwd}`, ...args], { ...gitOptions, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`Git check failed: ${args[0]}`);
  }
  return result.stdout;
}

// Keep the file policy in sync with .gitignore. Unlike .gitignore, this also
// rejects private files that were already tracked or added with git add -f.
const privatePaths = [
  /(^|\/)(?:app网盘文件分享|\.playwright-mcp|\.ego-browser|\.playwright|playwright-report|test-results|\.auth|\.ssh|\.aws|\.kube|node_modules|__pycache__)(?:\/|$)/i,
  /^(?:outreach|skills\/geo-article-writer)(?:\/|$)/i,
  /^docs\/DESIGN-[^/]*\.md$/i,
  /^reports\/navigation-sync\.json$/i,
  /(^|\/)\.typecho\.local[^/]*\.json$/i,
  /(^|\/)\.env(?:\.(?!(?:example|sample|template)$)[^/]*)?$/i,
  /(^|\/)[^/]*\.local\.(?!example\.)[^/]*$/i,
  /(^|\/)(?:credentials[^/]*\.json|secrets\.[^/]*|cookies[^/]*\.json|storage-?state[^/]*\.json|auth-state[^/]*\.json)$/i,
  /\.(?:apk|aab|ipa|pem|key|p12|pfx|jks|keystore|log|db|sqlite|sqlite3|bak|backup|pyc)$/i,
  /(^|\/)(?:\.DS_Store|Thumbs\.db)$/i
];

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["API key", /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i]
];
const literalSecret = /["']?(?:password|passwd|api[_-]?key|access[_-]?token|secret|cookie|session[_-]?token)["']?\s*[:=]\s*["']([^"'\r\n]{6,})["']/gi;

function hasLiteralSecret(text) {
  for (const [, value] of text.matchAll(literalSecret)) {
    // Documentation placeholders and environment/template expressions are safe.
    if (/^(?:<[^>]+>|\$\{.*\}|(?:your[-_ ]|example|sample|placeholder|change[-_]?me|password|secret|token)[\w .<>-]*)$/i.test(value)) continue;
    return true;
  }
  return false;
}

const failures = new Set();
const checkedBlobs = new Set();
let fileCount = 0;
let snapshotCount = 0;

function checkEntries(entries, label) {
  snapshotCount++;
  for (const { path, oid, mode } of entries) {
    fileCount++;
    if (privatePaths.some(pattern => pattern.test(path))) {
      failures.add(`${label}: ${path}: local-only file`);
      continue;
    }
    // Symlinks/submodules can expose paths outside the reviewed public files.
    if (!["100644", "100755"].includes(mode)) {
      failures.add(`${label}: ${path}: unsupported file mode ${mode}`);
      continue;
    }
    if (checkedBlobs.has(oid)) continue;
    checkedBlobs.add(oid);
    const data = git(["cat-file", "blob", oid]);
    if (data.includes(0)) continue;
    const text = data.toString("utf8");
    for (const [kind, pattern] of secretPatterns) {
      if (pattern.test(text)) failures.add(`${label}: ${path}: possible ${kind}`);
    }
    if (hasLiteralSecret(text)) failures.add(`${label}: ${path}: possible hardcoded credential`);
  }
}

function checkIndex() {
  const entries = git(["ls-files", "--stage", "-z"]).toString("utf8").split("\0").filter(Boolean).map(record => {
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    if (stage !== "0") throw new Error("Resolve index conflicts before publishing.");
    return { path: record.slice(tab + 1), oid, mode };
  });
  checkEntries(entries, "index");
}

function commitId(ref) {
  return git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString("ascii").trim();
}

function checkCommit(ref) {
  const oid = commitId(ref);
  const entries = git(["ls-tree", "-r", "-z", oid]).toString("utf8").split("\0").filter(Boolean).map(record => {
    const tab = record.indexOf("\t");
    const [mode, , blob] = record.slice(0, tab).split(" ");
    return { path: record.slice(tab + 1), oid: blob, mode };
  });
  checkEntries(entries, oid.slice(0, 12));
}

try {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    checkIndex();
  } else if (args.length === 2 && args[0] === "--ref") {
    checkCommit(args[1]);
  } else if (args.length === 1 && args[0] === "--pre-push") {
    const commits = new Set();
    for (const line of readFileSync(0, "utf8").trim().split(/\r?\n/).filter(Boolean)) {
      const [, localOid, , remoteOid] = line.split(/\s+/);
      if (!/^[a-f0-9]{40,64}$/.test(localOid ?? "") || !/^[a-f0-9]{40,64}$/.test(remoteOid ?? "")) {
        throw new Error("Invalid pre-push input.");
      }
      if (/^0+$/.test(localOid)) continue; // A ref deletion sends no files.
      const tip = commitId(localOid);
      commits.add(tip);
      // Check every newly published commit, including an intermediate commit
      // that adds a secret and a later commit that deletes it.
      const newlyPublished = git(["rev-list", tip, "--not", "--remotes"]).toString("ascii").trim();
      for (const oid of newlyPublished.split("\n").filter(Boolean)) commits.add(oid);
    }
    for (const oid of commits) checkCommit(oid);
  } else {
    throw new Error("Usage: node scripts/check-public-files.mjs [--ref REV | --pre-push]");
  }
  if (failures.size) {
    console.error("Public-file check failed. Keep these files local; never use git rm without --cached:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Public-file check passed (${snapshotCount} snapshot(s), ${fileCount} file(s)).`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
