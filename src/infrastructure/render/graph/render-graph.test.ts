import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RenderGraphError, compileGraph, type PassDecl } from './render-graph';

const chain = (
  id: string,
  input: string,
  output: string,
  enabled = true,
  aux: string[] = [],
  format: PassDecl['format'] = 'ldr',
): PassDecl => ({
  id,
  enabled,
  kind: 'chain',
  input,
  output,
  aux,
  format,
});
const auxPass = (id: string, input: string, output: string, enabled = true): PassDecl => ({
  id,
  enabled,
  kind: 'aux',
  input,
  output,
  format: 'own',
});

describe('compileGraph', () => {
  it('chains passes, writes the final one to screen and ping-pongs two targets', () => {
    const g = compileGraph(
      [
        chain('a', 'scene', 'c1'),
        chain('b', 'c1', 'c2'),
        chain('c', 'c2', 'c3'),
        chain('d', 'c3', 'c4'),
      ],
      ['scene'],
      'c4',
    );
    expect(g.steps.map((s) => s.target)).toEqual(['ldr:0', 'ldr:1', 'ldr:0', 'screen']);
    expect(g.slots.ldr).toBe(2);
    expect(g.steps.map((s) => s.input)).toEqual(['scene', 'c1', 'c2', 'c3']);
  });

  it('disabled chain passes become pass-through', () => {
    const g = compileGraph(
      [chain('a', 'scene', 'c1'), chain('b', 'c1', 'c2', false), chain('c', 'c2', 'c3')],
      ['scene'],
      'c3',
    );
    expect(g.steps.map((s) => s.pass.id)).toEqual(['a', 'c']);
    expect(g.steps[1]?.input).toBe('c1');
  });

  it('disabled aux producers resolve to null for consumers; unused aux producers are culled', () => {
    const passes = [
      auxPass('bloom', 'scene', 'bloom', false),
      auxPass('exposure', 'scene', 'exposure'),
      auxPass('unused', 'scene', 'junk'),
      chain('tonemap', 'scene', 'ldr', true, ['bloom', 'exposure'], 'hdr'),
    ];
    const g = compileGraph(passes, ['scene'], 'ldr');
    const tonemap = g.steps.at(-1);
    expect(tonemap?.aux).toEqual({ bloom: null, exposure: 'exposure' });
    expect(g.culled).toEqual(['unused']);
    expect(g.steps.map((s) => s.target)).toEqual(['own', 'screen']);
  });

  it('keeps an aux resource alive until its last reader', () => {
    const passes = [
      chain('mb', 'scene', 'h1', true, [], 'hdr'),
      chain('glow', 'h1', 'h2', true, [], 'hdr'), // produces aux-ish resource read twice
      chain('tm', 'h2', 'l1', true, ['h1'], 'ldr'),
      chain('dirt', 'l1', 'l2', true, ['h1'], 'ldr'),
      chain('end', 'l2', 'l3'),
    ];
    const g = compileGraph(passes, ['scene'], 'l3');
    const targets = Object.fromEntries(g.steps.map((s) => [s.pass.id, s.target]));
    expect(targets['glow']).not.toBe(targets['mb']); // h1 still alive while h2 is written
    expect(g.slots.hdr).toBe(2);
  });

  it('final pass can be any producer, disabled tails fall back to the last enabled pass', () => {
    const g = compileGraph(
      [chain('a', 'scene', 'c1'), chain('b', 'c1', 'c2', false)],
      ['scene'],
      'c2',
    );
    expect(g.steps).toHaveLength(1);
    expect(g.steps[0]?.target).toBe('screen');
  });

  it('reports structural errors', () => {
    expect(() => compileGraph([chain('a', 'nope', 'c1')], ['scene'], 'c1')).toThrow(
      RenderGraphError,
    );
    expect(() =>
      compileGraph([chain('a', 'scene', 'c1'), chain('b', 'c1', 'c1')], ['scene'], 'c1'),
    ).toThrow('written twice');
    expect(() => compileGraph([chain('a', 'scene', 'c1', false)], ['scene'], 'c1')).toThrow(
      'not produced',
    );
    expect(() => compileGraph([chain('a', 'scene', 'c1')], ['scene'], 'zzz')).toThrow(
      'before anything',
    );
    expect(() =>
      compileGraph(
        [{ id: 'x', enabled: true, kind: 'chain', input: null, output: 'o', format: 'ldr' }],
        [],
        'o',
      ),
    ).toThrow('needs an input');
    expect(() => compileGraph([auxPass('a', 'scene', 'x', false)], ['scene'], 'x')).toThrow(
      'not produced',
    );
  });

  it('property: any enable mask compiles, never reads a slot being written, and ends on screen', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 14 }), (mask) => {
        const passes = mask.map((on, i) =>
          chain(
            `p${String(i)}`,
            i === 0 ? 'scene' : `c${String(i)}`,
            `c${String(i + 1)}`,
            i === 0 ? true : on,
            [],
            i % 3 === 0 ? 'hdr' : 'ldr',
          ),
        );
        const g = compileGraph(passes, ['scene'], `c${String(mask.length)}`);
        expect(g.steps.at(-1)?.target).toBe('screen');
        const where = new Map<string, string>([['scene', 'external']]);
        for (const s of g.steps) {
          if (s.input !== null) expect(where.get(s.input)).not.toBe(s.target);
          where.set(s.pass.output, s.target);
        }
        expect(g.steps.length).toBe(1 + mask.slice(1).filter(Boolean).length);
      }),
    );
  });
});
