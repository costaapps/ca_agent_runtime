import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  const detail = result.stderr.trim() || result.stdout.trim() || `npm audit exited ${result.status}`;
  throw new Error(`Could not parse the production dependency audit result: ${detail}`);
}

if (report.error) {
  throw new Error(`Production dependency audit could not complete: ${JSON.stringify(report.error)}`);
}
if (!report.metadata?.vulnerabilities || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
  throw new Error('Production dependency audit returned no vulnerability metadata; refusing to treat an incomplete audit as clean.');
}
if (result.status !== 0 && Object.keys(report.vulnerabilities).length === 0) {
  const detail = result.stderr.trim() || `npm audit exited ${result.status}`;
  throw new Error(`Production dependency audit failed without vulnerability results: ${detail}`);
}

const blocking = [];
const unfixable = [];
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  if (!['high', 'critical'].includes(String(vulnerability.severity).toLowerCase())) continue;
  const finding = `${name} (${vulnerability.severity})`;
  if (vulnerability.fixAvailable === false) unfixable.push(finding);
  else blocking.push(`${finding}; fixAvailable=${JSON.stringify(vulnerability.fixAvailable ?? 'unknown')}`);
}

if (unfixable.length > 0) {
  process.stdout.write(`High/critical findings with no fix currently available (reported, not blocking): ${unfixable.join(', ')}\n`);
}
if (blocking.length > 0) {
  throw new Error(`Production dependencies contain high/critical vulnerabilities with an available or unknown fix: ${blocking.join('; ')}`);
}

const totals = report.metadata?.vulnerabilities ?? {};
process.stdout.write(`Production dependency audit complete: ${totals.total ?? 0} findings; no fixable high/critical vulnerabilities.\n`);
