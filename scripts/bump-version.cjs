/**
 * Moves the application version in both places it is written down.
 *
 *   node scripts/bump-version.cjs patch      # 1.0.0 -> 1.0.1
 *   node scripts/bump-version.cjs minor
 *   node scripts/bump-version.cjs major
 *   node scripts/bump-version.cjs 1.2.0      # or state it outright
 *
 * Why a script: the version lives twice — `package.json`, which decides the
 * installer name, `app.getVersion()` and the update feed, and
 * `src/shared/version.ts`, which is sent to every provider as the User-Agent.
 * Two hand-edits are two chances to forget one, and the failure mode is a build
 * that reports a version it is not, which is exactly what an updater compares.
 * `tests/version.test.ts` asserts the two agree; this is the way to change them.
 *
 * Deliberately no git side effects. Tagging is what publishes a release, so it
 * stays a decision rather than a consequence of bumping a number.
 */
const fs = require('fs');
const path = require('path');

const PACKAGE_FILE = path.join(__dirname, '..', 'package.json');
const VERSION_FILE = path.join(__dirname, '..', 'src', 'shared', 'version.ts');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const VERSION_DECLARATION = /(export const APP_VERSION\s*=\s*')[^']+(')/;

function readVersionSource() {
  return fs.readFileSync(VERSION_FILE, 'utf8');
}

function nextVersion(current, request) {
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`package.json has an unparsable version: ${current}`);
  const [, major, minor, patch] = match.map(Number);

  if (request === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (request === 'minor') return `${major}.${minor + 1}.0`;
  if (request === 'major') return `${major + 1}.0.0`;
  if (SEMVER.test(request)) return request;
  throw new Error(`expected patch, minor, major or an explicit x.y.z — got "${request}"`);
}

function main() {
  const request = process.argv[2];
  if (!request) {
    console.error('usage: node scripts/bump-version.cjs <patch|minor|major|x.y.z>');
    process.exit(2);
  }

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  const previous = pkg.version;

  // Report drift instead of quietly repairing it: the two files disagreeing
  // means something edited one of them by hand, and knowing that is useful.
  const source = readVersionSource();
  const declared = /APP_VERSION\s*=\s*'([^']+)'/.exec(source)?.[1];
  if (declared && declared !== previous) {
    console.warn(
      `WARNING version drift: package.json says ${previous} but src/shared/version.ts says ${declared}`
    );
  }

  let next;
  try {
    next = nextVersion(previous, request);
  } catch (error) {
    console.error(`VERSION_RESULT failed: ${error.message}`);
    process.exit(1);
  }

  pkg.version = next;
  fs.writeFileSync(PACKAGE_FILE, `${JSON.stringify(pkg, null, 2)}\n`);

  // Test before replacing: setting the version to the value it already has is a
  // legitimate no-op, and comparing the result to the input would call that a
  // failure to find the declaration.
  if (!VERSION_DECLARATION.test(source)) {
    console.error('VERSION_RESULT failed: could not find APP_VERSION in src/shared/version.ts');
    process.exit(1);
  }
  fs.writeFileSync(VERSION_FILE, source.replace(VERSION_DECLARATION, `$1${next}$2`));

  console.log(`VERSION_RESULT ${previous} -> ${next}`);
  console.log('next: commit, then `git tag v' + next + '` and push the tag to publish a release');
}

main();
