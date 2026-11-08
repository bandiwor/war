import * as THREE from 'three';
import { EFFECT_IDS, POST_EFFECTS, type PostFxConfig } from '../../../domain/bodycam/effects';
import { FullscreenQuad } from '../gl/fullscreen';
import { compileGraph, type CompiledGraph, type PassDecl } from '../graph/render-graph';
import type { QualitySettings } from '../quality';
import { TonemapPass } from './tonemap';
import {
  MANUAL_EXPOSURE,
  type EffectFactories,
  type FrameInfo,
  type PassContext,
  type PassIO,
  type PostEffectId,
} from './types';

/** Type-erased handle on one effect pass, built per id so params stay correctly typed. */
interface Runner {
  readonly id: PostEffectId;
  readonly kind: 'chain' | 'aux';
  readonly reads: readonly string[];
  readonly produces: string | undefined;
  readonly format: PassDecl['format'];
  enabled(cfg: PostFxConfig): boolean;
  run(renderer: THREE.WebGLRenderer, io: PassIO, cfg: PostFxConfig, frame: FrameInfo): void;
  output(): THREE.Texture | null;
  resize(w: number, h: number): void;
  dispose(): void;
}

interface PlanStep {
  readonly runner: Runner | null;
  readonly input: string | null;
  readonly auxNames: readonly string[];
  readonly auxResources: readonly (string | null)[];
  readonly target: THREE.WebGLRenderTarget | null;
  readonly toScreen: boolean;
  readonly own: boolean;
  readonly output: string;
}

function isPostEffect(id: string): id is PostEffectId {
  return id !== 'cameraShake';
}

const POST_IDS: readonly PostEffectId[] = EFFECT_IDS.filter(isPostEffect);
const TONEMAP = 'tonemap';

/**
 * Bodycam post-processing pipeline: HDR effects → tonemap → LDR effects →
 * screen, compiled through the render graph. Recompiles only when the set
 * of enabled effects changes (checked via a bitmask, no per-frame garbage).
 */
export class PostPipeline {
  private runners: Runner[] = [];
  private readonly tonemap: TonemapPass;
  private compiled: CompiledGraph | null = null;
  private compiledMask = -1;
  /** Compiled steps with everything resolved, so render() allocates nothing. */
  private plan: PlanStep[] = [];
  private readonly tonemapParams = { manualExposure: MANUAL_EXPOSURE, bloomIntensity: 0.8 };
  private readonly pools: Record<'hdr' | 'ldr', THREE.WebGLRenderTarget[]> = { hdr: [], ldr: [] };
  private readonly textures = new Map<string, THREE.Texture | null>();
  private readonly auxScratch: Record<string, THREE.Texture | null> = {};
  private readonly io: {
    input: THREE.Texture | null;
    aux: Record<string, THREE.Texture | null>;
    target: THREE.WebGLRenderTarget | null;
  } = {
    input: null,
    aux: this.auxScratch,
    target: null,
  };
  private width = 1;
  private height = 1;
  readonly resolution = new THREE.Vector2(1, 1);
  private readonly quad = new FullscreenQuad();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly quality: QualitySettings,
    factories: EffectFactories,
  ) {
    this.tonemap = new TonemapPass(this.quad);
    this.setFactories(factories);
  }

  /** (Re)creates every pass, e.g. after a shader hot-reload. */
  setFactories(factories: EffectFactories): void {
    for (const r of this.runners) r.dispose();
    const ctx: PassContext = {
      quad: this.quad,
      quality: this.quality,
      resolution: this.resolution,
    };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the generic correlates factories[id] with cfg[id].params; with a plain union the param types would not line up
    const build = <Id extends PostEffectId>(id: Id): Runner => {
      const pass = factories[id](ctx);
      return {
        id,
        kind: pass.kind,
        reads: pass.reads,
        produces: pass.produces,
        format: pass.format,
        enabled: (cfg) => cfg[id].enabled,
        run: (renderer, io, cfg, frame) => {
          pass.render(renderer, io, cfg[id].params, frame);
        },
        output: () => pass.output?.() ?? null,
        resize: (w, h) => {
          pass.resize?.(w, h);
        },
        dispose: () => {
          pass.dispose();
        },
      };
    };
    this.runners = POST_IDS.map((id) => build(id));
    for (const r of this.runners) r.resize(this.width, this.height);
    this.compiledMask = -1;
  }

  /** Internal render size (already scaled by quality). */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.resolution.set(width, height);
    for (const list of Object.values(this.pools)) for (const t of list) t.setSize(width, height);
    for (const r of this.runners) r.resize(width, height);
  }

  get graph(): CompiledGraph | null {
    return this.compiled;
  }

  render(sceneColor: THREE.Texture, cfg: PostFxConfig, frame: FrameInfo): void {
    this.ensureCompiled(cfg);
    this.textures.set('scene', sceneColor);
    const plan = this.plan;
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      if (step === undefined) continue;
      for (let a = 0; a < step.auxNames.length; a++) {
        const res = step.auxResources[a];
        this.auxScratch[step.auxNames[a] ?? ''] =
          res === null || res === undefined ? null : (this.textures.get(res) ?? null);
      }
      this.io.input = step.input === null ? null : (this.textures.get(step.input) ?? null);
      this.io.target = step.target;
      if (step.toScreen)
        this.renderer.setViewport(
          0,
          0,
          this.renderer.domElement.width,
          this.renderer.domElement.height,
        );
      if (step.runner === null) {
        if (this.io.input !== null) {
          this.tonemapParams.bloomIntensity = cfg.bloom.params.intensity;
          this.tonemap.render(
            this.renderer,
            this.io.input,
            this.auxScratch['exposure'] ?? null,
            this.auxScratch['bloom'] ?? null,
            this.tonemapParams,
            step.target,
          );
        }
      } else {
        step.runner.run(this.renderer, this.io, cfg, frame);
      }
      this.textures.set(
        step.output,
        step.own ? (step.runner?.output() ?? null) : (step.target?.texture ?? null),
      );
    }
    this.renderer.setRenderTarget(null);
  }

  private targetFor(target: string): THREE.WebGLRenderTarget | null {
    if (target === 'screen' || target === 'own') return null;
    const [format, slotText] = target.split(':');
    const slot = Number(slotText);
    if (format !== 'hdr' && format !== 'ldr') throw new Error(`Unknown target ${target}`);
    const pool = this.pools[format];
    while (pool.length <= slot) {
      pool.push(
        new THREE.WebGLRenderTarget(this.width, this.height, {
          type: format === 'hdr' ? THREE.HalfFloatType : THREE.UnsignedByteType,
          depthBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        }),
      );
    }
    return pool[slot] ?? null;
  }

  private ensureCompiled(cfg: PostFxConfig): void {
    let mask = 0;
    this.runners.forEach((r, i) => {
      if (r.enabled(cfg)) mask |= 1 << i;
    });
    if (mask === this.compiledMask) return;
    this.compiledMask = mask;
    const decls: PassDecl[] = [];
    let chain = 'scene';
    const add = (
      id: string,
      enabled: boolean,
      kind: 'chain' | 'aux',
      reads: readonly string[],
      produces: string | undefined,
      format: PassDecl['format'],
    ): void => {
      const output = kind === 'chain' ? `${id}.out` : (produces ?? `${id}.out`);
      decls.push({ id, enabled, kind, input: chain, aux: reads, output, format });
      if (kind === 'chain') chain = output;
    };
    for (const r of this.runners)
      if (POST_EFFECTS[r.id].stage === 'hdr')
        add(r.id, r.enabled(cfg), r.kind, r.reads, r.produces, r.format);
    add(TONEMAP, true, 'chain', ['exposure', 'bloom'], undefined, 'ldr');
    for (const r of this.runners)
      if (POST_EFFECTS[r.id].stage === 'ldr')
        add(r.id, r.enabled(cfg), r.kind, r.reads, r.produces, r.format);
    const graph = compileGraph(decls, ['scene'], chain);
    this.compiled = graph;
    this.plan = graph.steps.map((step) => {
      const runner = this.runners.find((r) => r.id === step.pass.id) ?? null;
      const auxNames = Object.keys(step.aux);
      return {
        runner,
        input: step.input,
        auxNames,
        auxResources: auxNames.map((n) => step.aux[n] ?? null),
        target: this.targetFor(step.target),
        toScreen: step.target === 'screen',
        own: step.target === 'own',
        output: step.pass.output,
      };
    });
  }

  dispose(): void {
    for (const r of this.runners) r.dispose();
    this.tonemap.dispose();
    for (const list of Object.values(this.pools)) for (const t of list) t.dispose();
    this.quad.dispose();
  }
}
