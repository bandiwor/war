import * as THREE from 'three';
import type { Presenter } from '../../application/loop/ports';
import {
  createRenderView,
  readRenderView,
  type RenderView,
  type Sandbox,
} from '../../application/scenes/sandbox';
import { clonePostFx, defaultPostFx, type PostFxConfig } from '../../domain/bodycam/effects';
import {
  createStimulus,
  modulatePostFx,
  type BodycamStimulus,
} from '../../domain/bodycam/stimulus';
import { BodycamRig } from './camera/bodycam-rig';
import { PostPipeline } from './postfx/pipeline';
import { SignalLossScheduler } from './postfx/signal-loss-scheduler';
import type { EffectFactories, FrameInfo } from './postfx/types';
import { FrameProfiler } from './profiler';
import type { QualitySettings } from './quality';
import { Flashlight } from './scene/flashlight';
import { animateStreet, buildStreetScene, type StreetScene } from './scene/street-scene';
import { MaterialLibrary } from './textures/material-library';
import type { TextureBaker } from './textures/texture-baker';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface BodycamPresenterOptions {
  readonly canvas: HTMLCanvasElement;
  readonly sandbox: Sandbox;
  readonly quality: QualitySettings;
  readonly factories: EffectFactories;
  readonly baker: TextureBaker;
  /** Monotonic wall clock in ms (injected: the only time source here). */
  readonly clock: () => number;
  /** Visual-test mode: fixed render time, no random events, instant exposure. */
  readonly frozenTime?: number;
  /** Visual-test mode: simulated camera yaw rate (rad/s) for motion effects. */
  readonly frozenSpin?: number;
}

/**
 * WebGL2 presenter: renders the sandbox street through the bodycam pipeline.
 * Implements the application's Presenter port; knows the ECS only through
 * the RenderView read model.
 */
export class BodycamPresenter implements Presenter {
  /** User/debug-facing configuration (before gameplay modulation). */
  readonly postFx: PostFxConfig = defaultPostFx();
  /** When set, replaces the gameplay stimulus (debug sliders). */
  stimulusOverride: BodycamStimulus | null = null;
  readonly profiler: FrameProfiler;
  readonly signal: SignalLossScheduler;
  readonly view: RenderView = createRenderView();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly effective: PostFxConfig = defaultPostFx();
  private readonly stimulus = createStimulus();
  private readonly pipeline: PostPipeline;
  private readonly rig: BodycamRig;
  private readonly flashlight: Flashlight;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly viewProj = new THREE.Matrix4();
  private readonly spinCamera = new THREE.PerspectiveCamera();
  private readonly frame: FrameInfo;
  private lastTime = -1;
  private frameIndex = 0;
  private internalWidth = 1;
  private internalHeight = 1;
  private readonly resizeObserver: ResizeObserver;

  private constructor(
    private readonly options: BodycamPresenterOptions,
    private readonly street: StreetScene,
    private readonly materials: MaterialLibrary,
    renderer: THREE.WebGLRenderer,
  ) {
    this.renderer = renderer;
    const q = options.quality;
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 160);
    this.rig = new BodycamRig(this.camera);
    this.flashlight = new Flashlight(q.shadowMapSize);
    street.scene.add(this.flashlight.light, this.flashlight.light.target);
    const depth = new THREE.DepthTexture(1, 1);
    depth.type = THREE.UnsignedIntType;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: q.msaa,
      depthTexture: depth,
      depthBuffer: true,
    });
    this.pipeline = new PostPipeline(renderer, q, options.factories);
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required');
    this.profiler = new FrameProfiler(gl);
    this.signal = new SignalLossScheduler(options.sandbox.simulation.seed ^ 0x5eed);
    this.frame = {
      time: 0,
      dt: 0,
      frame: 0,
      width: 1,
      height: 1,
      yawVelocity: 0,
      pitchVelocity: 0,
      motion: 0,
      signalLoss: 0,
      signalSeed: 0,
      fovY: THREE.MathUtils.degToRad(this.camera.fov),
      aspect: 16 / 9,
      depth,
      invViewProj: new THREE.Matrix4(),
      prevViewProj: new THREE.Matrix4(),
      osd: { simTime: 0, battery: 1, flashlightOn: true, signalLost: false },
      frozen: options.frozenTime !== undefined,
    };
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(options.canvas);
    this.resize();
  }

  static async create(options: BodycamPresenterOptions): Promise<BodycamPresenter> {
    const renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: options.frozenTime !== undefined,
    });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    const seed = options.sandbox.simulation.seed;
    const materials = await MaterialLibrary.create(
      options.baker,
      seed,
      options.quality.textureSize,
      Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    );
    const street = buildStreetScene(options.sandbox.layout, materials, seed);
    const presenter = new BodycamPresenter(options, street, materials, renderer);
    await presenter.warmUp();
    return presenter;
  }

  /** Compile every scene and post shader before the first visible frame (no hitches later). */
  private async warmUp(): Promise<void> {
    readRenderView(this.options.sandbox, 1, this.view);
    this.rig.update(this.view, null, 0, 0);
    await this.renderer.compileAsync(this.street.scene, this.camera);
    const saved = clonePostFx(this.postFx);
    for (const s of Object.values(this.postFx)) s.enabled = true;
    this.present(1);
    clonePostFx(saved, this.postFx);
    this.lastTime = -1;
  }

  setFactories(factories: EffectFactories): void {
    this.pipeline.setFactories(factories);
    this.pipeline.setSize(this.internalWidth, this.internalHeight);
  }

  get internalSize(): { readonly width: number; readonly height: number } {
    return { width: this.internalWidth, height: this.internalHeight };
  }

  get graphSummary(): string {
    const g = this.pipeline.graph;
    if (g === null) return '';
    return g.steps.map((s) => s.pass.id).join(' → ');
  }

  get bakeTimes(): ReadonlyMap<string, number> {
    return this.materials.bakeMs;
  }

  resize(): void {
    const canvas = this.options.canvas;
    const q = this.options.quality;
    const ratio = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
    const w = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    this.renderer.setSize(w, h, false);
    this.internalWidth = Math.max(1, Math.round(w * q.renderScale));
    this.internalHeight = Math.max(1, Math.round(h * q.renderScale));
    this.sceneTarget.setSize(this.internalWidth, this.internalHeight);
    this.pipeline.setSize(this.internalWidth, this.internalHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame.aspect = w / h;
    this.frame.width = this.internalWidth;
    this.frame.height = this.internalHeight;
  }

  present(alpha: number): void {
    const wall = this.options.clock();
    this.profiler.begin(wall);
    this.renderer.info.reset();
    const frozen = this.options.frozenTime;
    const time = frozen ?? wall / 1000;
    const dt = frozen !== undefined ? 1000 : this.lastTime < 0 ? 0 : time - this.lastTime;
    this.lastTime = time;

    const view = readRenderView(this.options.sandbox, alpha, this.view);
    const s = this.stimulusOverride ?? view.stimulus;
    this.stimulus.damage = s.damage;
    this.stimulus.fear = s.fear;
    this.stimulus.emi = s.emi;
    view.stimulus.damage = s.damage;
    view.stimulus.fear = s.fear;
    view.stimulus.emi = s.emi;
    clonePostFx(this.postFx, this.effective);
    modulatePostFx(this.postFx, this.stimulus, this.effective);
    const fx = this.effective;

    this.rig.update(
      view,
      fx.cameraShake.enabled ? fx.cameraShake.params : null,
      time,
      frozen !== undefined ? 0 : dt,
    );
    this.flashlight.update(this.camera, view.flashlightOn, view.battery, time);
    animateStreet(this.street, time);

    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.setViewport(0, 0, this.internalWidth, this.internalHeight);
    this.renderer.render(this.street.scene, this.camera);

    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const f = this.frame;
    if (this.frameIndex === 0) f.prevViewProj.copy(this.viewProj);
    const spin = frozen !== undefined ? (this.options.frozenSpin ?? 0) : 0;
    if (spin !== 0) {
      // Fake one frame of rotation history so motion effects render deterministically.
      this.spinCamera.copy(this.camera);
      this.spinCamera.rotateOnWorldAxis(Y_AXIS, -spin / 60);
      this.spinCamera.updateMatrixWorld();
      f.prevViewProj.multiplyMatrices(
        this.spinCamera.projectionMatrix,
        this.spinCamera.matrixWorldInverse,
      );
    }
    f.invViewProj.copy(this.viewProj).invert();
    f.time = time;
    f.dt = dt;
    f.frame = this.frameIndex++;
    f.yawVelocity = spin !== 0 ? spin : this.rig.yawVelocity;
    f.pitchVelocity = spin !== 0 ? 0 : this.rig.pitchVelocity;
    f.motion = spin !== 0 ? Math.min(1, Math.abs(spin) * 0.35) : this.rig.motion;
    if (frozen === undefined) this.signal.update(time, dt, fx.signalLoss.params.ratePerMinute);
    f.signalLoss = fx.signalLoss.enabled ? this.signal.level(time) : 0;
    f.signalSeed = this.signal.seed;
    f.osd.simTime = view.simTime;
    f.osd.battery = view.battery;
    f.osd.flashlightOn = view.flashlightOn;
    f.osd.signalLost = f.signalLoss > 0.6;

    this.pipeline.render(this.sceneTarget.texture, fx, f);
    f.prevViewProj.copy(this.viewProj);
    this.profiler.end(
      this.options.clock(),
      this.renderer.info.render.calls,
      this.renderer.info.render.triangles,
    );
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.pipeline.dispose();
    this.flashlight.dispose();
    this.sceneTarget.dispose();
    this.street.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }
}
