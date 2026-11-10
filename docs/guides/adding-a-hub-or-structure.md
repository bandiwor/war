# How to add a hub or a structure to the open world

The world is an authored map (`src/domain/world/world-map.ts`) with procedural detail generated
per chunk (`src/domain/world/chunk-gen.ts`). Both are pure data and pure functions of the seed:
change them and the simulation, the renderer and the worker all pick it up.

## A new structure in an existing zone

Each zone has a generator in `chunk-gen.ts` (`genCity`, `genIndustrial`, `genSubway`,
`genForest`, `genResearch`). Inside one, claim free ground and emit pieces:

```ts
// A burnt-out bus shelter on free ground, at most one per chunk.
if (b.rng.chance(0.3)) {
  const at = b.place(4, 1.6, 8); // footprint w × d in metres, 8 tries; claims the cells
  if (at !== null) {
    b.box('rustedMetal', [at[0], 1.2, at[1] - 0.7], [4, 2.4, 0.1]); // back wall
    b.box('paintedMetal', [at[0], 2.45, at[1]], [4.2, 0.1, 1.8]); // roof
  }
}
```

- `b.place(w, d, tries)` finds an axis-aligned footprint of free ground inside the chunk and
  marks it used. Use it for anything solid, so structures never overlap each other, roads,
  the player spawn or the hub anchors.
- `b.pickCell(CELL.road | CELL.sidewalk | CELL.ground, …)` gives a single cell (lamps, debris,
  wrecks).
- `b.box(material, center, size, yaw?)` adds a box. Solid boxes become colliders, and footsteps
  and impacts take their surface from the material.
- `b.prop(kind, material, position, yaw, scale)` adds an instanced prop. A new prop kind needs a
  geometry (`infrastructure/render/scene/geometry.ts` and `prop-library.ts`) and a collider
  (`PROP_COLLIDERS` in `application/physics/static-world.ts`). TypeScript's exhaustive switches
  point you to each place.
- `b.light({...})` adds a light source. Sodium lamps, glows and beacons get a pooled real light
  when they are near the camera. Windows, bulbs and beacon domes also glow as emissive geometry.
- Always draw from `b.rng`. Its stream is seeded from the chunk coordinates, so content stays
  deterministic.

Keep everything inside the chunk: `chunk-gen.test.ts` fails if a piece crosses the chunk border,
breaks the per-chunk caps (`CHUNK_LIMITS`) or builds on a reserved point.

## A new hub

1. Add a zone (and its soundscape) as in [adding a zone soundscape](adding-a-zone-soundscape.md).
2. Add a `Hub` to `HUBS`: its rectangle, its bare-ground material and an `anchor` on a road (the
   teleport target, which stays clear of construction).
3. Connect it with a `Road` in `ROADS` if no road reaches it yet. Roads are axis-aligned bands,
   and pavements appear along them in the zones listed in `PAVED`.
4. Write `genYourZone(b)` and register it in `GENERATORS`. The `Record<ZoneId, …>` type will not
   compile until you do.
5. Run `npm test` (map invariants, generator invariants, the golden world replay) and look at
   it: `?scene=world`, debug menu → **World** → teleport, with the chunk overlay on.

Changing generation changes the world. Regenerate the golden world hashes and replay with
`npm run golden:update`, and review the diff.
