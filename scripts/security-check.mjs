import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const paths = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const findings = [];
let scanned = 0;
const patterns = [
  ['private key PEM', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    'literal credential',
    /(?:api_?key|secret_?key|password|mnemonic|seed_?phrase)\s*[:=]\s*['"][^'"\n]{24,}['"]/i,
  ],
  [
    'credential token',
    /\b(?:sk-proj-|sk_live_|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{20,}\b/,
  ],
  ['64-byte key literal', /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/],
];
for (const path of paths) {
  if (/(^|\/)\.env($|\.)|keypair\.json$|scripts\/\.wallets\//.test(path)) {
    findings.push({ path, type: 'sensitive file eligible for Git' });
    continue;
  }
  if (
    !/\.(?:tsx?|m?js|json|toml|rs|md|ya?ml|css)$/.test(path) ||
    path === 'scripts/security-check.mjs'
  )
    continue;
  const text = fs.readFileSync(path, 'utf8');
  scanned++;
  for (const [type, pattern] of patterns)
    if (pattern.test(text)) findings.push({ path, type });
}
for (const path of [
  '.env',
  '.env.local',
  'target/deploy/ultrapong-keypair.json',
  'scripts/.wallets/integration.json',
]) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', path]);
  } catch {
    findings.push({ path, type: 'missing Git exclusion' });
  }
}
console.log(
  JSON.stringify(
    {
      scanned,
      findings,
      scope:
        'Tracked and non-ignored source files; pattern scan, not a full security audit',
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
