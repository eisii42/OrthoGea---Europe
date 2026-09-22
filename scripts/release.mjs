/**
 * Moves every package to one version and opens the changelog entry for it.
 *
 * The four packages are released in lockstep - they share a schema contract,
 * and a consumer that mixes versions of `@orthogea/core` and
 * `@orthogea/catalog` is in for a bad afternoon - so there is one number and
 * this script is what moves it.
 *
 * It deliberately does not commit, tag or publish. It edits files, runs the
 * gates and prints what to do next, so the release stays a reviewed step.
 *
 * Usage:
 *   node scripts/release.mjs 1.0.0     set an exact version
 *   node scripts/release.mjs minor     bump major / minor / patch
 *   node scripts/release.mjs 1.0.0 --dry-run   report without writing
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const skipGates = args.includes("--skip-gates");

if (!target) {
  console.error("Usage: node scripts/release.mjs <version|major|minor|patch> [--dry-run]");
  process.exit(1);
}

/** Every manifest that carries the shared version, the root included. */
const MANIFESTS = [
  "package.json",
  "packages/core/package.json",
  "packages/catalog/package.json",
  "packages/client/package.json",
  "packages/harvester/package.json",
  "apps/demo/package.json"
];

const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));

const current = readJson("packages/core/package.json").version;

function nextVersion(from, request) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(request)) return request;
  const [major, minor, patch] = from.split(".").map(Number);
  if (request === "major") return `${major + 1}.0.0`;
  if (request === "minor") return `${major}.${minor + 1}.0`;
  if (request === "patch") return `${major}.${minor}.${patch + 1}`;
  console.error(`Not a version or a bump keyword: ${request}`);
  process.exit(1);
}

const version = nextVersion(current, target);

// The packages diverged from the root once already. Report every manifest that
// is not where it is expected to be, rather than quietly overwriting it.
const divergent = MANIFESTS.map((file) => [file, readJson(file).version]).filter(
  ([, found]) => found !== current
);
if (divergent.length > 0) {
  console.log("Versions were not in step before this run:");
  for (const [file, found] of divergent) console.log(`  ${file}: ${found} (expected ${current})`);
  console.log("");
}

console.log(`${current} -> ${version}${dryRun ? "  (dry run)" : ""}\n`);

if (!dryRun) {
  for (const file of MANIFESTS) {
    const path = join(root, file);
    const source = readFileSync(path, "utf8");
    // Rewritten textually so formatting, key order and trailing newline survive.
    const updated = source.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
    if (updated === source) {
      console.error(`Could not find a version field in ${file}`);
      process.exit(1);
    }
    writeFileSync(path, updated);
    console.log(`  set ${file}`);
  }

  const changelogPath = join(root, "CHANGELOG.md");
  const changelog = readFileSync(changelogPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  if (changelog.includes("## [Unreleased]")) {
    writeFileSync(
      changelogPath,
      changelog.replace("## [Unreleased]", `## [${version}] - ${today}`)
    );
    console.log("  opened the changelog entry");
  } else {
    console.log("  no [Unreleased] section in CHANGELOG.md - add the entry by hand");
  }
}

if (!skipGates && !dryRun) {
  console.log("\nRunning the gates.");
  for (const script of ["typecheck", "test", "build"]) {
    console.log(`  pnpm ${script}`);
    execFileSync("pnpm", [script], { cwd: root, stdio: "inherit", shell: true });
  }
}

console.log(`
Prepared ${version}. Nothing was committed, tagged or published.

Next, once the diff looks right:
  git add -A                      # -am would miss generated files the build needs
  git commit -m "chore: release ${version}"
  git tag v${version}
  git push && git push --tags
  pnpm publish -r --access public
`);
