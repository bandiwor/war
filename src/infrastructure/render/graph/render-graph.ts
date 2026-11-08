/**
 * Backend-agnostic render graph compiler (no Three.js / WebGL here, so it is
 * unit-tested in Node and reusable by a future WebGPU backend).
 *
 * Passes are declared in execution order. Each reads a main `input` resource
 * plus optional `aux` resources and writes one `output`:
 *  - `chain` passes transform the image; when disabled their output aliases
 *    their input (zero-cost pass-through).
 *  - `aux` passes produce a side resource (bloom, exposure); when disabled the
 *    resource resolves to null and consumers fall back to defaults.
 * Passes whose output nobody needs are culled. Transient targets are assigned
 * to physical slots by lifetime, so N passes ping-pong through few targets.
 */
export type ResourceFormat = 'hdr' | 'ldr' | 'own';

export interface PassDecl {
  readonly id: string;
  readonly enabled: boolean;
  readonly kind: 'chain' | 'aux';
  readonly input: string | null;
  readonly aux?: readonly string[];
  readonly output: string;
  /** 'own' = the pass supplies its output texture itself (no pooled target). */
  readonly format: ResourceFormat;
}

export interface CompiledStep {
  readonly pass: PassDecl;
  /** Resolved producer resource for the main input, or null. */
  readonly input: string | null;
  /** Resolved aux resources (null = disabled/unavailable). */
  readonly aux: Readonly<Record<string, string | null>>;
  /** Physical target: `${format}:${slot}`, 'screen' for the final step, or 'own'. */
  readonly target: string;
}

export interface CompiledGraph {
  readonly steps: readonly CompiledStep[];
  /** Number of pooled targets needed per format. */
  readonly slots: Readonly<Record<'hdr' | 'ldr', number>>;
  /** Pass ids that were culled because nothing consumed them. */
  readonly culled: readonly string[];
}

export class RenderGraphError extends Error {
  override readonly name = 'RenderGraphError';
}

/**
 * @param externals resources that exist before the graph runs (e.g. 'scene').
 * @param final     resource that must end up on screen.
 */
export function compileGraph(
  passes: readonly PassDecl[],
  externals: readonly string[],
  final: string,
): CompiledGraph {
  const alias = new Map<string, string | null>();
  for (const e of externals) alias.set(e, e);
  const producer = new Map<string, number>();

  const resolve = (name: string | null, by: string): string | null => {
    if (name === null) return null;
    if (!alias.has(name))
      throw new RenderGraphError(`Pass "${by}" reads "${name}" before anything produces it`);
    return alias.get(name) ?? null;
  };

  // 1. Alias resolution in declaration order.
  const live: { pass: PassDecl; input: string | null; aux: Record<string, string | null> }[] = [];
  const seenOutputs = new Set<string>(externals);
  for (const pass of passes) {
    if (seenOutputs.has(pass.output))
      throw new RenderGraphError(`Resource "${pass.output}" written twice`);
    seenOutputs.add(pass.output);
    const input = resolve(pass.input, pass.id);
    if (pass.kind === 'chain' && pass.input === null)
      throw new RenderGraphError(`Chain pass "${pass.id}" needs an input`);
    const aux: Record<string, string | null> = {};
    for (const a of pass.aux ?? []) aux[a] = resolve(a, pass.id);
    if (!pass.enabled) {
      alias.set(pass.output, pass.kind === 'chain' ? input : null);
      continue;
    }
    alias.set(pass.output, pass.output);
    producer.set(pass.output, live.length);
    live.push({ pass, input, aux });
  }

  const finalRes = resolve(final, 'final');
  if (finalRes === null || !producer.has(finalRes)) {
    throw new RenderGraphError(`Final resource "${final}" is not produced by an enabled pass`);
  }

  // 2. Cull: walk back from the final producer.
  const needed = new Array<boolean>(live.length).fill(false);
  const mark = (res: string | null): void => {
    if (res === null) return;
    const idx = producer.get(res);
    if (idx === undefined || needed[idx] === true) return;
    needed[idx] = true;
    const step = live[idx];
    if (step === undefined) return;
    mark(step.input);
    for (const r of Object.values(step.aux)) mark(r);
  };
  mark(finalRes);

  // 3. Lifetimes over the kept steps, then greedy slot assignment per format.
  const kept = live.filter((_, i) => needed[i] === true);
  const culled = live.filter((_, i) => needed[i] !== true).map((s) => s.pass.id);
  const lastUse = new Map<string, number>();
  kept.forEach((s, i) => {
    if (s.input !== null) lastUse.set(s.input, i);
    for (const r of Object.values(s.aux)) if (r !== null) lastUse.set(r, i);
  });

  const free: Record<'hdr' | 'ldr', number[]> = { hdr: [], ldr: [] };
  const count: Record<'hdr' | 'ldr', number> = { hdr: 0, ldr: 0 };
  const slotOf = new Map<string, string>();
  const releaseAt = new Map<number, { format: 'hdr' | 'ldr'; slot: number }[]>();
  const steps: CompiledStep[] = [];

  kept.forEach((s, i) => {
    let target: string;
    const isFinal = s.pass.output === finalRes;
    if (isFinal) target = 'screen';
    else if (s.pass.format === 'own') target = 'own';
    else {
      const fmt = s.pass.format;
      const slot = free[fmt].pop() ?? count[fmt]++;
      target = `${fmt}:${String(slot)}`;
      slotOf.set(s.pass.output, target);
      const end = lastUse.get(s.pass.output) ?? i;
      const list = releaseAt.get(end) ?? [];
      list.push({ format: fmt, slot });
      releaseAt.set(end, list);
    }
    steps.push({ pass: s.pass, input: s.input, aux: s.aux, target });
    // Release after this step's reads; a pass never writes the target it reads.
    for (const r of releaseAt.get(i) ?? []) free[r.format].push(r.slot);
  });

  return { steps, slots: count, culled };
}
