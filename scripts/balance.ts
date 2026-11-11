/** Regenerates docs/balance.md from the registries (see src/domain/balance/balance.ts). */
import { writeFileSync } from 'node:fs';
import { balanceSheet } from '../src/domain/balance/balance';

writeFileSync(new URL('../docs/balance.md', import.meta.url), balanceSheet());
console.log('wrote docs/balance.md');
