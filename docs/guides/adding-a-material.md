# How to add a procedural material

Add an entry to `MATERIALS` in `src/domain/procgen/materials.ts`. Everything is data:

```ts
tiles: {
  label: 'Cracked bathroom tiles',
  base: { colorA: [0.6, 0.62, 0.6], colorB: [0.7, 0.72, 0.7], period: 4, octaves: 4, warp: 0.1 },
  pattern: { kind: 'bricks', rows: 6, cols: 6, mortar: 0.04, mortarColor: [0.3, 0.3, 0.28], variation: 0.1 },
  roughness: [0.15, 0.35],
  metalness: 0,
  layers: [
    { kind: 'cracks', amount: 0.4, scale: 6 },
    { kind: 'dirt', amount: 0.5, color: [0.2, 0.18, 0.12] },
    { kind: 'blood', amount: 0.2 },
  ],
  bumpiness: 2,
  tileMeters: 1.2,
},
```

- **Patterns:** `none`, `bricks`, `planks`, `panels`.
- **Layers** (applied in order): `cracks`, `rust`, `dirt`, `moss`, `wet`, `scratches`, `blood`,
  `stains`.
- Colours are sRGB in [0, 1]. `tileMeters` is the real-world size of one texture tile.

`bake.test.ts` checks every registry entry against the schema and checks that the bake is
deterministic. Reference the new id from a layout (`domain/world/*`) to use it in the world.
