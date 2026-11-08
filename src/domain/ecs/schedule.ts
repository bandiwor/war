/**
 * Systems declare explicit ordering constraints; the schedule is a stable
 * topological sort (ties broken by registration order), computed once.
 */
export interface System<Ctx> {
  readonly name: string;
  readonly after?: readonly string[];
  readonly before?: readonly string[];
  run(ctx: Ctx): void;
}

export class ScheduleError extends Error {
  override readonly name = 'ScheduleError';
}

export function buildSchedule<Ctx>(systems: readonly System<Ctx>[]): readonly System<Ctx>[] {
  const index = new Map<string, number>();
  systems.forEach((s, i) => {
    if (index.has(s.name)) throw new ScheduleError(`Duplicate system "${s.name}"`);
    index.set(s.name, i);
  });

  const edges: number[][] = systems.map(() => []);
  const inDegree = new Array<number>(systems.length).fill(0);
  const link = (from: string, to: string, owner: string): void => {
    const a = index.get(from);
    const b = index.get(to);
    if (a === undefined || b === undefined) {
      throw new ScheduleError(
        `System "${owner}" references unknown system "${a === undefined ? from : to}"`,
      );
    }
    edges[a]?.push(b);
    inDegree[b] = (inDegree[b] ?? 0) + 1;
  };
  for (const s of systems) {
    for (const dep of s.after ?? []) link(dep, s.name, s.name);
    for (const dep of s.before ?? []) link(s.name, dep, s.name);
  }

  const ready: number[] = [];
  inDegree.forEach((d, i) => {
    if (d === 0) ready.push(i);
  });
  const order: System<Ctx>[] = [];
  while (ready.length > 0) {
    ready.sort((x, y) => x - y);
    const next = ready.shift() ?? 0;
    const sys = systems[next];
    if (sys !== undefined) order.push(sys);
    for (const to of edges[next] ?? []) {
      const d = (inDegree[to] ?? 0) - 1;
      inDegree[to] = d;
      if (d === 0) ready.push(to);
    }
  }
  if (order.length !== systems.length) {
    const stuck = systems.filter((s) => !order.includes(s)).map((s) => s.name);
    throw new ScheduleError(`Cycle in system ordering: ${stuck.join(', ')}`);
  }
  return order;
}
