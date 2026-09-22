/**
 * Turns an endpoint report into the body of a GitHub issue.
 *
 * Kept as a file rather than inlined in the workflow so it can be run by hand
 * against a downloaded report, and so a quoting mistake shows up here instead
 * of at 04:17 on a Monday.
 *
 * Usage:
 *   node scripts/endpoint-issue-body.mjs endpoint-report.json
 *   node scripts/endpoint-issue-body.mjs endpoint-report.json --github-output
 */
import { appendFileSync, readFileSync } from "node:fs";

const [reportPath, ...flags] = process.argv.slice(2);
if (!reportPath) {
  console.error("Usage: node scripts/endpoint-issue-body.mjs <report.json> [--github-output]");
  process.exit(1);
}

const { checkedAt, results } = JSON.parse(readFileSync(reportPath, "utf8"));
const failed = results.filter((report) => !report.ok);

/** The reason a record failed, from whichever of the two probes tripped. */
function reason(report) {
  if (report.capabilities && !report.capabilities.ok) {
    const detail = report.capabilities.error ?? `HTTP ${report.capabilities.status ?? "?"}`;
    return `GetCapabilities: ${detail}`;
  }
  if (report.tile && !report.tile.ok) return `tile: ${report.tile.error ?? "failed"}`;
  return "failed";
}

const cell = (text) => String(text).replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 300);

const body = [
  `The weekly probe found **${failed.length} of ${results.length}** catalogued endpoints not`,
  `answering as recorded.`,
  ``,
  `Checked at ${checkedAt}.`,
  ``,
  `| layer | country | service | problem |`,
  `| --- | --- | --- | --- |`,
  ...failed.map(
    (report) =>
      `| \`${report.id}\` | ${report.country} | ${report.service} | ${cell(reason(report))} |`
  ),
  ``,
  `The check runs GetCapabilities *and* asks for one real tile, so this also catches a silent`,
  `rename of a layer or a dropped CRS, not only an endpoint going offline. The full report is`,
  `attached to the workflow run as an artifact.`,
  ``,
  `Reproduce locally:`,
  ``,
  "```",
  `pnpm build && pnpm --filter @orthogea/catalog verify -- --strict`,
  "```"
].join("\n");

if (flags.includes("--github-output") && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `body<<ORTHOGEA_EOF\n${body}\nORTHOGEA_EOF\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${failed.length}\n`);
} else {
  console.log(body);
}
