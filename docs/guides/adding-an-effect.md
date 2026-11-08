# How to add a bodycam effect

1. **Register it** in `src/domain/bodycam/effects.ts`:

   ```ts
   lensFlare: {
     label: 'Lens flare',
     stage: 'ldr',      // 'hdr' (before tonemap), 'ldr' (after) or 'camera'
     order: 125,        // position in the chain (see ADR-0005 for the physical order)
     params: { amount: p(0.4, 0, 1) },
   },
   ```

   TypeScript now fails in `postfx/effects/index.ts` until the effect has an implementation.

2. **Implement it** in `src/infrastructure/render/postfx/effects/`. For a single-shader LDR effect:

   ```ts
   export function createLensFlare(ctx: PassContext): EffectPass<'lensFlare'> {
     return simpleChainPass(
       'lensFlare',
       ctx,
       { uAmount: uniform(0.4) },
       /* glsl */ `
       uniform float uAmount;
       void main() { outColor = texture(tInput, vUv) * (1.0 + uAmount); }`,
       (u, params) => {
         u.uAmount.value = params.amount;
       },
     );
   }
   ```

   Need bloom or exposure? Pass `['bloom']` as `reads` and use `io.aux['bloom']`, which can be
   `null`. Multi-pass effects implement `EffectPass` directly (see `bloom.ts`).

3. **Add it to the factory table** in `effects/index.ts`.
4. **Optional gameplay coupling**: scale its params in `domain/bodycam/stimulus.ts` and add a unit
   test.
5. **Visual test**: add the id to `EFFECTS` in `e2e/visual.spec.ts`, run
   `npm run test:e2e -- --update-snapshots`, and review the new baseline images.

The debug menu (Bodycam tab) picks the effect up automatically. In dev, editing the shader
hot-swaps it without reloading the game.
