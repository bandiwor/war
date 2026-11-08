# How to add a weapon

Weapons are data. Add an entry to `RAW` in `src/domain/weapons/registry.ts`. For example, a
suppressed SMG:

```ts
smg: {
  kind: 'firearm',
  label: 'Integrally suppressed SMG (9 mm)',
  ammo: '9x19',                 // or add a new cartridge to AMMO (mass, dragK, casing)
  magazine: 30, chamber: true, tubeFed: false,
  action: 'semiauto', modes: ['semi', 'auto'], burst: 1, rpm: 850, cycleSeconds: 0,
  muzzleVelocity: 300, pellets: 1, damage: 28,
  falloff: { start: 20, end: 70, min: 0.5 },
  accuracyMoa: 5, pelletSpreadDeg: 0,
  spread: { hipDeg: 2, adsDeg: 0.25, movingDeg: 1.2, bloomPerShotDeg: 0.2, bloomMaxDeg: 2, bloomRecoveryDegPerSec: 4 },
  recoil: { pattern: [[0.7, 0.1], [0.6, -0.15], [0.6, 0.2]], loopFrom: 0, jitter: 0.2, recovery: 8 },
  reload: { tacticalSeconds: 2.0, emptySeconds: 2.4, shellSeconds: 0 },
  drawSeconds: 0.6,
  wear: { perShot: 0.0003, jamBase: 0.0004, jamAtFullWear: 0.04, clearSeconds: 1.3 },
  zeroMeters: 25, sightHeight: 0.05, adsZoom: 1.2,
  sound: { blast: 0.3, body: 300, mechanism: 0.8 },   // quiet blast, loud bolt
  model: { parts: [/* boxes/cylinders, +Z forward, metres; roles: magazine/slide/bolt/pump */],
           grip: [0, -0.04, 0], support: [0, -0.02, 0.2], muzzle: [0, 0.03, 0.4], ejectionPort: [0.02, 0.03, 0.1] },
  attachments: ['weaponLight', 'laser'],
},
```

That is all:

- Zod validates the entry at startup and in `ballistics.test.ts`.
- The loadout gives it a slot (registry order), the debug **Range** tab gets a button, the
  viewmodel builds its model and animates the roles, and the audio synthesises its gunshot from
  `sound`.
- Its zero is computed from `zeroMeters` and `sightHeight`.

Then, from a terminal:

1. Check it in the range with `npm run dev`, opening `/?scene=range` → **Range** tab.
2. Add an integration check to `tests/integration/range.test.ts` if it has special behaviour.
3. If the golden range replay script should exercise it, run `npm run golden:update` and review the
   diff.

New race vulnerabilities and body parts live in `src/domain/combat/races.ts` and
`src/domain/combat/hitboxes.ts`.
