import { describe, expect, it } from 'vitest';
import { ScheduleError, buildSchedule, type System } from './schedule';

const sys = (
  name: string,
  deps: { after?: string[]; before?: string[] } = {},
): System<string[]> => ({
  name,
  ...deps,
  run(log) {
    log.push(name);
  },
});

const order = (systems: System<string[]>[]): string[] => buildSchedule(systems).map((s) => s.name);

describe('buildSchedule', () => {
  it('keeps registration order when unconstrained', () => {
    expect(order([sys('a'), sys('b'), sys('c')])).toEqual(['a', 'b', 'c']);
  });

  it('honours after/before constraints with stable tie-breaking', () => {
    expect(
      order([
        sys('render', { after: ['physics'] }),
        sys('input', { before: ['physics'] }),
        sys('physics'),
        sys('audio'),
      ]),
    ).toEqual(['input', 'physics', 'render', 'audio']);
  });

  it('runs systems in schedule order', () => {
    const log: string[] = [];
    for (const s of buildSchedule([sys('b', { after: ['a'] }), sys('a')])) s.run(log);
    expect(log).toEqual(['a', 'b']);
  });

  it('rejects duplicates, unknown references and cycles', () => {
    expect(() => order([sys('a'), sys('a')])).toThrow(ScheduleError);
    expect(() => order([sys('a', { after: ['ghost'] })])).toThrow('unknown system "ghost"');
    expect(() => order([sys('a', { before: ['ghost'] })])).toThrow('unknown system "ghost"');
    expect(() => order([sys('a', { after: ['b'] }), sys('b', { after: ['a'] }), sys('c')])).toThrow(
      'Cycle in system ordering: a, b',
    );
  });
});
