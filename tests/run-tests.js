// Runs every tests/*.test.js file and reports a summary.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  const last = (r.stdout || '').trim().split('\n').pop();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${last}`);
  if (!ok) console.log(r.stdout, r.stderr);
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
