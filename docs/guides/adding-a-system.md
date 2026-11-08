# How to add a component and a system

Guides for mobs, weapons, effects and levels arrive with the stages that introduce their registries.

1. **Define the component** in the domain (pure data, SoA fields):

   ```ts
   export const Health = defineComponent('Health', { current: 'f32', max: 'f32' });
   ```

2. **Write the system** against `SimContext`. Use indexed loops, no closures or allocations per
   tick, `ctx.rng.get('<subsystem>')` for randomness, and `dmath` for trigonometry:

   ```ts
   export const regenSystem: System<SimContext> = {
     name: 'health.regen',
     after: ['damage.apply'],
     run(ctx) {
       const s = ctx.world.store(Health);
       const f = s.fields; // read after any adds: stores reallocate when they grow
       for (let row = 0; row < s.size; row++) {
         f.current[row] = Math.min(f.max[row] ?? 0, (f.current[row] ?? 0) + 2 * ctx.dt);
       }
     },
   };
   ```

3. **Register both** in the scene factory (`world.register(Health)`, add the system to `systems`).
4. **Test it**: a unit test for the system, then `npm run golden:update` if the change is meant to
   alter simulation output. Review the golden diff and commit it.
5. Run `npm run perf` to confirm the hot path still allocates nothing.
