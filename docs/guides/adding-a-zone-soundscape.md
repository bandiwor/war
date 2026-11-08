# How to add or tune a zone soundscape

1. Add the id to `ZONE_IDS` and an entry to `ZONE_SOUNDSCAPES` in `src/domain/audio/zones.ts`:

   ```ts
   hospital: {
     label: 'Abandoned hospital',
     wind: { level: 0.1, gustiness: 0.3, brightness: 0.3 },
     hum: { level: 0.3, freq: 120, harmonics: 0.3 },        // fluorescent ballasts
     insects: { level: 0, density: 0, pitch: 4000, cicada: 0 },
     drips: { level: 0.4, rate: 2, pitch: 0.6 },
     creaks: { level: 0.2, ratePerMinute: 2, metal: 0.4 },
     rumble: { level: 0.1, freq: 50 },
     roomTone: { level: 0.5, brightness: 0.6 },
     distant: { ratePerMinute: 2, weights: { bark: 0, howl: 0, clang: 2, siren: 0, chirp: 1, shot: 0 } },
   },
   ```

2. Place it in the world: add a `ZoneVolume` to the layout (`zones` in
   `src/domain/world/street-layout.ts` for now; the stage-5 world format will hold zones).
3. Audition it: debug menu → **Audio** → zone dropdown (or `window.__warDebug.setZone('hospital')`).
   The layer meters show the balance live.
4. `npm test` validates the entry against the schema and runs
   `tests/acceptance/zones-distinct.test.ts`, which renders every zone and fails if the new one sounds
   too close to an existing zone. Tune until it's distinct, and add a signature assertion for it.

To add a new distant event kind, add it to `DISTANT_KINDS`, write its synthesiser in
`src/infrastructure/audio/dsp/distant.ts` (the `switch` is exhaustive, so TypeScript points you
there), and give it weights in the zones where it belongs.
