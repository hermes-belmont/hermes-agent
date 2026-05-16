const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..', '..');
const outDir = resolve(repoRoot, 'hermes_cli', 'mission_control_dist');

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

const headSha = git(['rev-parse', 'HEAD']);
const manifest = {
  built_at: new Date().toISOString(),
  head_sha: headSha,
  head_sha_short: headSha.slice(0, 8),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote build manifest ${manifest.head_sha_short}`);
