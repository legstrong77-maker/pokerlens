// Build: stamp the service worker precache list, and emit the claude.ai Artifact variant.
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');

function walk(dir, base = '') {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f), rel = base ? `${base}/${f}` : f;
    if (statSync(p).isDirectory()) out.push(...walk(p, rel));
    else out.push(rel);
  }
  return out;
}
const files = walk(app).filter((f) => !f.startsWith('models/') && !f.startsWith('vendor/') && f !== 'sw.js' && !f.endsWith('.map') && !f.split('/').pop().startsWith('.'));
const h = createHash('sha256');
for (const f of files.sort()) h.update(f).update(readFileSync(path.join(app, f)));
const version = 'pokerlens-v' + h.digest('hex').slice(0, 10);
const shell = ['./', ...files];
const sw = readFileSync(path.join(root, 'tools', 'sw.template.js'), 'utf8')
  .replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell, null, 0));
writeFileSync(path.join(app, 'sw.js'), sw);
console.log(`sw.js: ${version}, ${shell.length} precached files`);

// ---- Artifact variant (content-only index.html; no manifest / service worker; no local model) ----
const out = path.join(root, 'dist', 'artifact');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const d of ['css', 'js', 'icons']) cpSync(path.join(app, d), path.join(out, d), { recursive: true });
let html = readFileSync(path.join(app, 'index.html'), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const links = [...html.matchAll(/<link rel="(preconnect|stylesheet)"[^>]*>/g)].map((m) => m[0]).join('\n');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
html = `${title}\n${links}\n${body.trim()}\n`;
writeFileSync(path.join(out, 'index.html'), html);
const list = walk(out);
console.log(`artifact variant: ${list.length} files -> ${path.relative(root, out)}`);
