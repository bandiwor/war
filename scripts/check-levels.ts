/**
 * CI gate: every shipped level (levels/*.level.json) must parse (through
 * the migrations), serialise back byte for byte (diff-friendly, canonical),
 * and pass the automatic checks with no errors. Warnings are printed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { checkLevel } from '../src/domain/level/checks';
import { parseLevel, serializeLevel } from '../src/domain/level/level';

const dir = new URL('../levels/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.level.json'));
let failed = false;
if (files.length === 0) {
  console.error('FAIL levels: no levels/*.level.json found');
  failed = true;
}
for (const f of files) {
  const text = readFileSync(new URL(f, dir), 'utf8');
  try {
    const level = parseLevel(JSON.parse(text));
    if (serializeLevel(level) !== text) {
      console.error(`FAIL ${f}: not in canonical form (open and export it from the editor)`);
      failed = true;
    }
    const r = checkLevel(level);
    for (const i of r.issues)
      console[i.severity === 'error' ? 'error' : 'log'](
        `${i.severity === 'error' ? 'FAIL' : 'warn'} ${f}: [${i.code}] ${i.message}`,
      );
    if (r.errors > 0) failed = true;
    console.log(
      `${f}: ${String(r.errors)} errors, ${String(r.warnings)} warnings, ${String(r.reachable)}/${String(r.walkable)} m² reachable`,
    );
  } catch (e) {
    console.error(`FAIL ${f}: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('level checks: OK');
