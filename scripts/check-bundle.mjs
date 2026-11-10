// Fails if DEV-only debug tooling leaked into the production bundle.
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

// Release builds ship no source maps (no sources on the public site).
const maps = readdirSync(dir).filter((f) => f.endsWith('.map'));
if (maps.length > 0) {
  console.error(`Source maps in the release build: ${maps.join(', ')}`);
  process.exit(1);
}

// Size budgets per chunk (minified, bytes). Rapier is mostly its embedded WASM.
const LIMITS = { index: 600_000, three: 700_000, vendor: 200_000, rapier: 4_700_000 };
for (const file of files) {
  const group = Object.keys(LIMITS).find((k) => file.startsWith(`${k}-`));
  if (group === undefined) continue;
  const size = statSync(join(dir, file)).size;
  if (size > LIMITS[group]) {
    console.error(`${file}: ${String(size)} bytes > ${String(LIMITS[group])} budget`);
    process.exit(1);
  }
}
console.log(
  `bundle check: ${String(files.length)} file(s) clean, no source maps, chunks within budget`,
);
