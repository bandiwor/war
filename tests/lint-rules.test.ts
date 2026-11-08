import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { determinismRules, layerRules } from '../eslint/architecture.js';

/**
 * Proves the architectural lint rules actually fire: if someone weakens them,
 * these tests fail rather than silently letting violations through.
 */
const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  ...layerRules,
  determinismRules,
];

const lint = (filename: string, code: string): string[] =>
  linter.verify(code, config, { filename }).map((m) => m.ruleId ?? m.message);

describe('determinism lint rules', () => {
  it.each([
    'export const r = Math.random();',
    'export const t = Date.now();',
    'export const p = performance.now();',
    'export const d = new Date();',
    'export const s = Math.sin(1);',
    'export const w = window.innerWidth;',
    'setTimeout(() => 0, 1);',
  ])('flags `%s` in domain and application', (code) => {
    expect(lint('src/domain/x.ts', code)).not.toEqual([]);
    expect(lint('src/application/x.ts', code)).not.toEqual([]);
  });

  it('allows them in infrastructure and in tests', () => {
    expect(
      lint('src/infrastructure/x.ts', 'export const r = Math.random() + performance.now();'),
    ).toEqual([]);
    expect(lint('src/domain/x.test.ts', 'export const r = Math.random();')).toEqual([]);
  });

  it('allows exact Math functions in the domain', () => {
    expect(
      lint('src/domain/x.ts', 'export const r = Math.sqrt(2) + Math.floor(1.5) + Math.imul(3, 4);'),
    ).toEqual([]);
  });
});

describe('layer boundary lint rules', () => {
  it.each([
    ['src/domain/a.ts', "import '../application/simulation';"],
    ['src/domain/a.ts', "import '../infrastructure/browser/raf-frame-source';"],
    ['src/domain/a.ts', "import 'three';"],
    ['src/application/a.ts', "import '../infrastructure/browser/keyboard-input';"],
    ['src/application/a.ts', "import '../presentation/main';"],
    ['src/infrastructure/a.ts', "import '../presentation/main';"],
    ['src/headless/a.ts', "import '../infrastructure/browser/keyboard-input';"],
  ])('%s: %s is forbidden', (file, code) => {
    expect(lint(file, code)).toContain('no-restricted-imports');
  });

  it.each([
    ['src/application/a.ts', "import '../domain/ecs/world';"],
    ['src/infrastructure/a.ts', "import '../application/simulation';"],
    ['src/infrastructure/a.ts', "import 'three';"],
    ['src/presentation/a.ts', "import '../infrastructure/browser/keyboard-input';"],
  ])('%s: %s is allowed', (file, code) => {
    expect(lint(file, code)).toEqual([]);
  });
});
