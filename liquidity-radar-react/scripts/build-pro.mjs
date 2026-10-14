// Composite build: build the embeddable Pro Terminal (pro-terminal) and copy its
// output under the main app's dist at /pro/ so one Vercel deployment serves both.
// The main app (vite build) must run first; this script is appended to "build".
import { execSync } from 'node:child_process';
import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pro = path.join(root, 'pro-terminal');
const srcDist = path.join(pro, 'dist');
const outDir = path.join(root, 'dist', 'pro');

if (!existsSync(path.join(pro, 'node_modules'))) {
  console.log('[build-pro] installing pro-terminal dependencies…');
  execSync('npm ci --prefix pro-terminal', { cwd: root, stdio: 'inherit' });
}
console.log('[build-pro] building pro-terminal…');
execSync('npm run build --prefix pro-terminal', { cwd: root, stdio: 'inherit' });

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(srcDist, outDir, { recursive: true });
console.log('[build-pro] pro terminal copied to dist/pro');