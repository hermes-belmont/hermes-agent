const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..', '..');
const outDir = resolve(repoRoot, 'hermes_cli', 'mission_control_dist');
const manifestPath = resolve(outDir, 'build-manifest.json');

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function readExistingManifest() {
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

const headSha = git(['rev-parse', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const existingManifest = readExistingManifest();
const gitFieldsUnchanged =
  existingManifest?.head_sha === headSha &&
  existingManifest?.head_sha_short === headSha.slice(0, 8) &&
  existingManifest?.branch === branch;
const manifest = {
  built_at: gitFieldsUnchanged && existingManifest?.built_at
    ? existingManifest.built_at
    : new Date().toISOString(),
  head_sha: headSha,
  head_sha_short: headSha.slice(0, 8),
  branch,
};
const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;

mkdirSync(outDir, { recursive: true });

if (existsSync(manifestPath) && readFileSync(manifestPath, 'utf8') === manifestContents) {
  console.log(`build manifest unchanged ${manifest.head_sha_short}`);
  process.exit(0);
}

writeFileSync(manifestPath, manifestContents);
console.log(`wrote build manifest ${manifest.head_sha_short}`);
