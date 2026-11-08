import type { DamageType } from '../weapons/registry';

/**
 * Races and body parts with their vulnerabilities, from the lore:
 *  - zombies: no brain function left but the brainstem; headshots kill,
 *    bodies soak bullets; burned by strong light (UV-sensitive fungus);
 *  - robots: armoured chassis shrug off small arms; cameras are fragile;
 *    EMP fries them; fire barely matters;
 *  - plants: fibrous, bullets pass through, but fire is devastating and
 *    the bulb (vascular heart) is the weak point; blades cut vines;
 *  - animals: ordinary flesh and bone.
 */
export const RACES = ['zombie', 'robot', 'plant', 'animal'] as const;
export type Race = (typeof RACES)[number];

export const BODY_PARTS = [
  'head',
  'torso',
  'arm',
  'leg',
  'sensor',
  'chassis',
  'bulb',
  'stem',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export interface Vulnerability {
  /** Multiplier per damage type. */
  readonly types: Readonly<Record<DamageType, number>>;
  /** Multiplier per body part (direct hits only; area damage ignores parts). */
  readonly parts: Readonly<Partial<Record<BodyPart, number>>>;
  readonly maxHealth: number;
}

export const VULNERABILITY: Readonly<Record<Race, Vulnerability>> = {
  zombie: {
    types: { ballistic: 1, slash: 1, blunt: 1, fire: 1.5, explosive: 1, emp: 0, light: 3 },
    parts: { head: 4, torso: 0.6, arm: 0.35, leg: 0.45 },
    maxHealth: 120,
  },
  robot: {
    types: { ballistic: 0.5, slash: 0.15, blunt: 0.4, fire: 0.3, explosive: 1.2, emp: 6, light: 0 },
    parts: { sensor: 3, chassis: 1, leg: 0.6 },
    maxHealth: 220,
  },
  plant: {
    types: { ballistic: 0.5, slash: 1.5, blunt: 0.6, fire: 4, explosive: 1.5, emp: 0, light: 0.5 },
    parts: { bulb: 2.5, stem: 0.8, head: 1.2 },
    maxHealth: 160,
  },
  animal: {
    types: { ballistic: 1, slash: 1, blunt: 1, fire: 1.5, explosive: 1, emp: 0, light: 0 },
    parts: { head: 2.5, torso: 1, leg: 0.6 },
    maxHealth: 140,
  },
};

/** Damage actually dealt: base × type vulnerability × part multiplier (if any). */
export function damageTo(
  race: Race,
  base: number,
  type: DamageType,
  part: BodyPart | null,
): number {
  const v = VULNERABILITY[race];
  const partFactor = part === null ? 1 : (v.parts[part] ?? 1);
  return base * v.types[type] * partFactor;
}

export function raceIndex(r: Race): number {
  return RACES.indexOf(r);
}

export function raceAt(i: number): Race {
  return RACES[i] ?? 'zombie';
}
