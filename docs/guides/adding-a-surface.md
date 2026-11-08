# How to add a surface (footsteps, AI noise)

1. Add the id to `SURFACE_IDS` and an entry to `SURFACES` in `src/domain/world/surfaces.ts`:

   ```ts
   gravel: {
     thump: { freq: 75, decay: 0.05, level: 0.5 },
     click: { freq: 2000, q: 0.7, decay: 0.03, level: 0.3 },
     ring: { freqs: [], decay: 0.05, level: 0 },
     grit: { density: 0.95, level: 0.8 },  // lots of crunch
     splash: 0,
     loudness: 1.4,                         // AI hears it further than concrete
   },
   ```

2. Point a material at it (`surface: 'gravel'` in `src/domain/procgen/materials.ts`). Every collider
   built from that material now reports the surface.
3. `npm test` checks the schema, determinism and bounds for every surface automatically. Add an
   assertion to `src/infrastructure/audio/dsp/footstep.test.ts` if the new surface has a
   characteristic you want to lock in (e.g. "gravel has the highest grit energy").

No other code changes: the footstep player bakes variants for every registered surface at startup.
