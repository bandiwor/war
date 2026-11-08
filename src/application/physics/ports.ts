import type { Brand } from '../../domain/core/brand';
import type { StateHasher } from '../../domain/math/hash';
import type { Vec3 } from '../../domain/world/street-layout';
import type { SurfaceId } from '../../domain/world/surfaces';

/**
 * Physics as the simulation sees it. The Rapier adapter lives in
 * infrastructure/physics; the simulation never imports an engine. Every
 * operation is deterministic given the same call sequence.
 */
export type CharacterId = Brand<number, 'CharacterId'>;

export interface CharacterMove {
  dx: number;
  dy: number;
  dz: number;
  grounded: boolean;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface CharacterSpec {
  readonly feet: Vec3;
  readonly radius: number;
  readonly height: number;
  readonly maxStepHeight: number;
  readonly maxSlopeDegrees: number;
}

export interface PhysicsPort {
  addStaticBox(center: Vec3, size: Vec3, yaw: number, surface: SurfaceId | null): void;
  /** Vertical cylinder; `base` is the centre of its bottom face. */
  addStaticCylinder(base: Vec3, height: number, radius: number, surface: SurfaceId | null): void;
  createCharacter(spec: CharacterSpec): CharacterId;
  /** Resize the capsule keeping the feet planted. Returns false (and keeps the old size) if blocked. */
  setCharacterHeight(id: CharacterId, height: number): boolean;
  /** Collide-and-slide the character by the desired delta; writes what actually happened. */
  moveCharacter(id: CharacterId, dx: number, dy: number, dz: number, out: CharacterMove): void;
  characterFeet(id: CharacterId, out: Point): Point;
  /** Surface directly under the character's feet, or null when nothing is there. */
  surfaceBelow(id: CharacterId): SurfaceId | null;
  step(dt: number): void;
  hashInto(h: StateHasher): void;
  /** Debug wireframe of all colliders (line segment pairs). */
  debugLines(): { readonly vertices: Float32Array; readonly colors: Float32Array };
  dispose(): void;
}
