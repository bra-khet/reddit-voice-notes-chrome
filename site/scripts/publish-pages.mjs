#!/usr/bin/env node
/*
 * Publish site/dist/ to the ROOT of the `gh-pages` branch — no extra deps.
 *
 * Uses a throwaway git worktree so the built files become the branch root
 * (GitHub Pages → Deploy from a branch → gh-pages / root). Safe to re-run; it
 * replaces the branch contents with the latest build each time.
 *
 * Usage:  npm run build  &&  npm run publish:pages
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync, cpSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const BRANCH = 'gh-pages';
const siteRoot = resolve(import.meta.dirname, '..');
const dist = resolve(siteRoot, 'dist');
const worktree = join(tmpdir(), 'rvn-gh-pages-worktree');

const run = (args, cwd) => execFileSync('git', args, { stdio: 'inherit', cwd });
const out = (args, cwd) => execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
const quiet = (args, cwd) => {
  try {
    return out(args, cwd);
  } catch {
    return '';
  }
};

if (!existsSync(resolve(dist, 'index.html'))) {
  console.error('✗ dist/index.html not found. Run `npm run build` first.');
  process.exit(1);
}

const repoRoot = out(['rev-parse', '--show-toplevel'], siteRoot);

// Clean any stale worktree from a previous interrupted run.
quiet(['worktree', 'remove', '--force', worktree], repoRoot);
if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });

const hasLocal = quiet(['rev-parse', '--verify', BRANCH], repoRoot) !== '';
const hasRemote = quiet(['ls-remote', '--heads', 'origin', BRANCH], repoRoot) !== '';

if (hasLocal) {
  run(['worktree', 'add', worktree, BRANCH], repoRoot);
} else if (hasRemote) {
  run(['worktree', 'add', '-B', BRANCH, worktree, `origin/${BRANCH}`], repoRoot);
} else {
  // First publish: create a fresh orphan branch with no history.
  run(['worktree', 'add', '--detach', worktree], repoRoot);
  run(['checkout', '--orphan', BRANCH], worktree);
  run(['reset', '--hard'], worktree);
}

// Replace the branch contents with the fresh build (preserve .git only).
for (const entry of readdirSync(worktree)) {
  if (entry === '.git') continue;
  rmSync(join(worktree, entry), { recursive: true, force: true });
}
cpSync(dist, worktree, { recursive: true });
writeFileSync(join(worktree, '.nojekyll'), ''); // belt-and-suspenders: no Jekyll processing

run(['add', '-A'], worktree);
const stamp = new Date().toISOString();
try {
  run(['commit', '-m', `Deploy static voice studio (${stamp})`], worktree);
} catch {
  console.log('Nothing to deploy — build output matches the published branch.');
}
run(['push', 'origin', BRANCH], worktree);

quiet(['worktree', 'remove', '--force', worktree], repoRoot);
console.log(`✓ Published dist/ to the ${BRANCH} branch root.`);
console.log('  One-time: GitHub → Settings → Pages → Deploy from a branch → gh-pages / (root).');
