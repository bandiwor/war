import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type {
  CharacterId,
  CharacterMove,
  CharacterSpec,
  PhysicsPort,
  Point,
} from '../../application/physics/ports';
import type { StateHasher } from '../../domain/math/hash';
import type { Vec3 } from '../../domain/world/street-layout';
import type { SurfaceId } from '../../domain/world/surfaces';

/**
 * Rapier adapter for the PhysicsPort, using the cross-platform deterministic
 * WASM build (identical results in browsers and Node, see ADR-0006).
 *
 * The character is a standalone capsule collider moved by Rapier's
 * kinematic character controller (collide-and-slide, autostep, snap-to-ground),
 * positioned immediately so later queries in the same tick see it.
 */
let initPromise: Promise<void> | null = null;

/** Loads the WASM module once (embedded in the compat build: no asset files). */
export function initRapier(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

interface Character {
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly radius: number;
  height: number;
}

const DEG = Math.PI / 180;
/** Character controller skin width (gap kept between the capsule and the world). */
const SKIN = 0.01;

export class RapierPhysics implements PhysicsPort {
  private readonly world: RAPIER.World;
  private readonly surfaces = new Map<number, SurfaceId>();
  private readonly characters: Character[] = [];
  private dirty = true;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly scratch = { x: 0, y: 0, z: 0 };
  private readonly computed = new RAPIER.Vector3(0, 0, 0);
  private readonly next = { x: 0, y: 0, z: 0 };
  private readonly identity = { x: 0, y: 0, z: 0, w: 1 };

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  /** Requires initRapier() to have resolved. */
  static create(dt: number): RapierPhysics {
    const p = new RapierPhysics();
    p.world.timestep = dt;
    return p;
  }

  addStaticBox(center: Vec3, size: Vec3, yaw: number, surface: SurfaceId | null): void {
    const half = yaw / 2;
    const desc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setTranslation(center[0], center[1], center[2])
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    this.register(this.world.createCollider(desc), surface);
  }

  addStaticCylinder(base: Vec3, height: number, radius: number, surface: SurfaceId | null): void {
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(
      base[0],
      base[1] + height / 2,
      base[2],
    );
    this.register(this.world.createCollider(desc), surface);
  }

  createCharacter(spec: CharacterSpec): CharacterId {
    const half = this.capsuleHalfSegment(spec.height, spec.radius);
    // Start one skin width above the floor: starting in contact makes the controller hitch.
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(half, spec.radius).setTranslation(
        spec.feet[0],
        spec.feet[1] + SKIN + spec.height / 2,
        spec.feet[2],
      ),
    );
    const controller = this.world.createCharacterController(SKIN);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableAutostep(spec.maxStepHeight, 0.05, false);
    controller.enableSnapToGround(0.3);
    controller.setMaxSlopeClimbAngle(spec.maxSlopeDegrees * DEG);
    controller.setMinSlopeSlideAngle((spec.maxSlopeDegrees + 5) * DEG);
    controller.setSlideEnabled(true);
    this.characters.push({ collider, controller, radius: spec.radius, height: spec.height });
    this.dirty = true;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- brand constructor: index into this adapter's character table
    return (this.characters.length - 1) as CharacterId;
  }

  setCharacterHeight(id: CharacterId, height: number): boolean {
    const c = this.character(id);
    if (Math.abs(height - c.height) < 1e-6) return true;
    const t = c.collider.translation();
    const feetY = t.y - c.height / 2; // capsule bottom (feet + skin)
    const center = { x: t.x, y: feetY + height / 2, z: t.z };
    if (height > c.height) {
      // Growing: refuse if the taller capsule would overlap anything (a ceiling).
      this.flush();
      const shape = new RAPIER.Capsule(this.capsuleHalfSegment(height, c.radius), c.radius - 0.02);
      const overlap = { found: false };
      this.world.intersectionsWithShape(
        center,
        this.identity,
        shape,
        () => {
          overlap.found = true;
          return false;
        },
        undefined,
        undefined,
        c.collider,
      );
      if (overlap.found) return false;
    }
    c.collider.setHalfHeight(this.capsuleHalfSegment(height, c.radius));
    c.collider.setTranslation(center);
    c.height = height;
    return true;
  }

  moveCharacter(id: CharacterId, dx: number, dy: number, dz: number, out: CharacterMove): void {
    const c = this.character(id);
    this.flush();
    this.desired.x = dx;
    this.desired.y = dy;
    this.desired.z = dz;
    c.controller.computeColliderMovement(c.collider, this.desired);
    const m = c.controller.computedMovement(this.computed);
    const t = c.collider.translation();
    this.next.x = t.x + m.x;
    this.next.y = t.y + m.y;
    this.next.z = t.z + m.z;
    c.collider.setTranslation(this.next);
    out.dx = m.x;
    out.dy = m.y;
    out.dz = m.z;
    out.grounded = c.controller.computedGrounded();
  }

  characterFeet(id: CharacterId, out: Point): Point {
    const c = this.character(id);
    const t = c.collider.translation();
    out.x = t.x;
    out.y = t.y - c.height / 2 - SKIN;
    out.z = t.z;
    return out;
  }

  surfaceBelow(id: CharacterId): SurfaceId | null {
    const c = this.character(id);
    const feet = this.characterFeet(id, this.scratch);
    this.ray.origin = { x: feet.x, y: feet.y + SKIN + 0.1, z: feet.z };
    const hit = this.world.castRay(this.ray, 0.45, true, undefined, undefined, c.collider);
    if (hit === null) return null;
    return this.surfaces.get(hit.collider.handle) ?? null;
  }

  /**
   * Integrates the world. With only static colliders and kinematic characters
   * nothing needs integrating: the controller queries static geometry and
   * collider positions update immediately. Rapier's JS wrapper allocates on
   * every world.step() (measured by the perf gate), so we only step when
   * colliders were added; dynamic bodies (later stages) will step every tick.
   */
  step(): void {
    if (this.dirty) {
      this.world.step();
      this.dirty = false;
    }
  }

  hashInto(h: StateHasher): void {
    const snapshot = this.world.takeSnapshot();
    h.u32(snapshot.length);
    for (let i = 0; i + 3 < snapshot.length; i += 4) {
      h.u32(
        (snapshot[i] ?? 0) |
          ((snapshot[i + 1] ?? 0) << 8) |
          ((snapshot[i + 2] ?? 0) << 16) |
          ((snapshot[i + 3] ?? 0) << 24),
      );
    }
    for (let i = snapshot.length & ~3; i < snapshot.length; i++) h.u32(snapshot[i] ?? 0);
  }

  debugLines(): { readonly vertices: Float32Array; readonly colors: Float32Array } {
    const buffers = this.world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  dispose(): void {
    for (const c of this.characters) this.world.removeCharacterController(c.controller);
    this.world.free();
  }

  private register(collider: RAPIER.Collider, surface: SurfaceId | null): void {
    if (surface !== null) this.surfaces.set(collider.handle, surface);
    this.dirty = true;
  }

  /** Scene queries need the broad phase updated after colliders are added. */
  private flush(): void {
    this.step();
  }

  private character(id: CharacterId): Character {
    const c = this.characters[id];
    if (c === undefined) throw new Error(`Unknown character ${String(id)}`);
    return c;
  }

  private capsuleHalfSegment(height: number, radius: number): number {
    return Math.max(0.01, height / 2 - radius);
  }
}

/** Composition-root helper: init WASM and create a world for the given tick rate. */
export async function createRapierPhysics(tickRate: number): Promise<RapierPhysics> {
  await initRapier();
  return RapierPhysics.create(1 / tickRate);
}
