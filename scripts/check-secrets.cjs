/**
 * Refuses to let a credential leave this machine.
 *
 *   node scripts/check-secrets.cjs            # everything Git would publish
 *   node scripts/check-secrets.cjs --staged   # only what is staged right now
 *
 * Why a script instead of care: D4IDE is developed by pasting real provider
 * keys into terminals, harness scripts and fixtures, and one of those keys
 * landing in a public repository is the kind of mistake that cannot be undone —
 * deleting the file later does not delete it from the history that was already
 * fetched. A gate that runs before every commit is cheap; the alternative is not.
 *
 * What it does *not* do: it never prints a matched secret, only its first few
 * characters, so a finding cannot leak through the build log either.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Shapes that are worth failing a build over. Deliberately shape-based rather
 * than entropy-based: entropy flags base64 test data, and a gate that cries
 * wolf gets switched off, which is worse than not having one.
 */
const RULES = [
  { id: 'openai-style', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: 'google', pattern: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { id: 'xai', pattern: /\bxai-[A-Za-z0-9]{20,}/ },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { id: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    id: 'assigned-secret',
    pattern: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*['"]([^'"]{16,})['"]/i,
    // The interesting part is the quoted value, not the whole assignment.
    value: (match) => match[1]
  },
  { id: 'bearer-literal', pattern: /Bearer\s+[A-Za-z0-9._-]{24,}/ }
];

/**
 * Strings that look like a key and are not one. Every entry has to be a value
 * that appears literally in the repository, so this list stays short and
 * reviewable instead of becoming a place to silence findings nobody read.
 */
const ALLOWED = new Set([
  // Fixtures in tests/context-engine.test.ts, used to check that the secret
  // detector recognises a key when it sees one.
  'sk-12345678901234567890123456789012',
  'sk-abcdef123456789012345678901234',
  'sk-abcdefghijklmnop',
  // Fixtures in tests/log-service.test.ts. These are the redactor's own inputs:
  // each one must survive being written down here and be redacted in the log.
  'sk-live-abcdefghijklmnop',
  'Bearer sk-live-abcdefghijklmnop',
  'sk-proj-abcdefghijklmnopqrst',
  'sk-ant-api03-abcdefghijklmnop',
  'AIzaSyA1234567890abcdefghijklmnopqrs',
  'supersecretvalue',
  '-----BEGIN RSA PRIVATE KEY-----'
]);

const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'release']);

/** Every path Git would see: tracked, plus untracked that is not ignored. */
function listFiles(stagedOnly) {
  const args = stagedOnly
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']
    : ['ls-files', '-co', '--exclude-standard', '-z'];
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out
    .split('\0')
    .filter(Boolean)
    .map((entry) => path.normalize(entry))
    .filter((entry) => !entry.split(path.sep).some((part) => ALWAYS_SKIP.has(part)));
}

/** A NUL byte in the first block means "not source code"; skip it wholesale. */
function looksBinary(buffer) {
  const head = buffer.subarray(0, 8192);
  return head.includes(0);
}

function mask(value) {
  return value.length <= 6 ? '<short>' : `${value.slice(0, 4)}…(${value.length} chars)`;
}

function scanFile(relative) {
  const findings = [];
  let buffer;
  try {
    const stat = fs.statSync(relative);
    if (stat.size > MAX_BYTES) return findings;
    buffer = fs.readFileSync(relative);
  } catch {
    return findings;
  }
  if (looksBinary(buffer)) return findings;

  const lines = buffer.toString('utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      const match = line.match(rule.pattern);
      if (!match) continue;
      const value = rule.value ? rule.value(match) : match[0];
      if (!value || ALLOWED.has(value)) continue;
      findings.push({ file: relative, line: index + 1, rule: rule.id, masked: mask(value) });
    }
  }
  return findings;
}

const stagedOnly = process.argv.includes('--staged');
let files;
try {
  files = listFiles(stagedOnly);
} catch (error) {
  console.error(`SECRETS unknown: could not list files (${error.message})`);
  process.exit(1);
}

const findings = files.flatMap(scanFile);

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}  ${finding.rule}  ${finding.masked}`);
}

if (findings.length > 0) {
  console.log(
    `SECRETS_RESULT ${findings.length} finding(s) in ${stagedOnly ? 'staged files' : 'the working tree'} — ` +
      'remove the value, or add a reviewed literal to ALLOWED in scripts/check-secrets.cjs.'
  );
  process.exit(1);
}

console.log(
  `SECRETS_RESULT clean — scanned ${files.length} ${stagedOnly ? 'staged' : 'tracked and untracked'} file(s)`
);
process.exit(0);
