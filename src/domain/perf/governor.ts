/**
 * Automatic quality scaling (stage 10): a pure controller fed one frame cost
 * per frame. It keeps the frame inside budget by lowering the internal
 * resolution first (cheap to change, invisible at small steps), then by
 * dropping whole features in tiers (flashlight shadows, then the costliest
 * cosmetic post effects). It climbs back when there is clear headroom.
 *
 * Stability is what makes it usable:
 * - decisions use a windowed mean, so one long frame (a GC, a shader
 *   compile) changes nothing;
 * - every change starts a cooldown and clears the window, so the next
 *   decision sees only frames rendered at the new setting;
 * - a step down sets a ceiling, and the controller may not climb above it
 *   until it has decayed, so it never oscillates around the overload point.
 */
export interface GovernorConfig {
  /** Frame budget (ms). */
  readonly budgetMs: number;
  /** A decision every this much frame time (ms)… */
  readonly decisionMs: number;
  /** …once at least this many frames are in (one long frame alone decides nothing)… */
  readonly minFrames: number;
  /** …or after this many frames, whichever comes first. */
  readonly window: number;
  /** Scale down when the mean exceeds budget × this. */
  readonly overload: number;
  /** Scale up when the mean is under budget × this… */
  readonly headroom: number;
  /** …for this many consecutive decisions. */
  readonly patience: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly stepDown: number;
  readonly stepUp: number;
  /** Frame time (ms) to let pass after a change before measuring again. */
  readonly cooldownMs: number;
  /** Frame time (ms) for a ceiling to decay by one step up. */
  readonly ceilingDecayMs: number;
  /** Highest degradation tier. */
  readonly maxTier: number;
}

export const DEFAULT_GOVERNOR: GovernorConfig = {
  budgetMs: 1000 / 60,
  decisionMs: 500,
  minFrames: 3,
  window: 30,
  overload: 1.08,
  headroom: 0.8,
  patience: 4,
  minScale: 0.5,
  maxScale: 1,
  stepDown: 0.1,
  stepUp: 0.05,
  cooldownMs: 750,
  ceilingDecayMs: 10_000,
  maxTier: 2,
};

/** Degradation tiers, in the order they are given up. */
export const TIERS = ['full', 'noShadows', 'lightPost'] as const;
export type Tier = (typeof TIERS)[number];

export type GovernorChange = 'none' | 'scale' | 'tier';

export class QualityGovernor {
  /** Internal resolution factor (× the preset's render scale). */
  scale: number;
  tier = 0;
  /** Changes made so far (the debug menu and tests). */
  changes = 0;
  private count = 0;
  private sum = 0;
  private cooldown = 0;
  private calm = 0;
  private ceiling: number;
  private ceilingAge = 0;
  private lastMean: number | null = null;
  enabled = true;

  constructor(readonly config: GovernorConfig = DEFAULT_GOVERNOR) {
    this.scale = config.maxScale;
    this.ceiling = config.maxScale;
  }

  get tierName(): Tier {
    return TIERS[this.tier] ?? 'full';
  }

  /** Mean frame cost (ms) behind the last decision, or null before the first. */
  get mean(): number | null {
    return this.lastMean;
  }

  /** Feed one frame's cost (ms). Returns what changed, if anything. */
  update(frameMs: number): GovernorChange {
    const c = this.config;
    if (!this.enabled || !Number.isFinite(frameMs) || frameMs < 0) return 'none';
    // The ceiling left by an overload decays slowly back to the top.
    if (this.ceiling < c.maxScale) {
      this.ceilingAge += frameMs;
      if (this.ceilingAge >= c.ceilingDecayMs) {
        this.ceilingAge = 0;
        this.ceiling = Math.min(c.maxScale, this.ceiling + c.stepUp);
      }
    }
    if (this.cooldown > 0) {
      this.cooldown -= frameMs;
      return 'none';
    }
    this.sum += frameMs;
    this.count++;
    const due = (this.sum >= c.decisionMs && this.count >= c.minFrames) || this.count >= c.window;
    if (!due) return 'none';
    const mean = this.sum / this.count;
    this.lastMean = mean;
    this.sum = 0;
    this.count = 0;
    if (mean > c.budgetMs * c.overload) {
      this.calm = 0;
      if (this.scale > c.minScale + 1e-9) {
        // Bigger steps when far over budget (cost scales with pixels ≈ scale²).
        const wanted = this.scale * Math.sqrt((c.budgetMs * 0.95) / mean);
        this.scale = round2(Math.max(c.minScale, Math.min(this.scale - c.stepDown, wanted)));
        this.ceiling = this.scale;
        this.ceilingAge = 0;
        return this.changed('scale');
      }
      if (this.tier < c.maxTier) {
        this.tier++;
        return this.changed('tier');
      }
      return 'none';
    }
    if (mean < c.budgetMs * c.headroom) {
      if (++this.calm < c.patience) return 'none';
      this.calm = 0;
      if (this.tier > 0) {
        this.tier--;
        return this.changed('tier');
      }
      if (this.scale < Math.min(c.maxScale, this.ceiling) - 1e-9) {
        this.scale = round2(Math.min(c.maxScale, this.ceiling, this.scale + c.stepUp));
        return this.changed('scale');
      }
      return 'none';
    }
    this.calm = 0;
    return 'none';
  }

  private changed(kind: GovernorChange): GovernorChange {
    this.changes++;
    this.cooldown = this.config.cooldownMs;
    return kind;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
