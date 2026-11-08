// Fails if DEV-only debug tooling leaked into the production bundle.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MARKERS = ['WAR_DEBUG_MENU'];
const dir = new URL('../dist/assets/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (files.length === 0) throw new Error('No JS in dist/assets — run the build first');
for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8');
  for (const marker of MARKERS) {
    if (text.includes(marker)) {
      console.error(`Debug marker "${marker}" found in production bundle ${file}`);
      process.exit(1);
    }
  }
}
console.log(`bundle check: ${String(files.length)} file(s) clean`);
