/**
 * Writes levels/yard.level.json, the sample level shipped with the editor
 * (its "Open sample" and the CI level checks). Kept as a script so the
 * sample can be regenerated after a format change; edit it in the editor
 * afterwards like any other level.
 */
import { writeFileSync } from 'node:fs';
import { newLevel, serializeLevel, type Level } from '../src/domain/level/level';

const W = 40;
const D = 30;
const base = newLevel({
  id: 'yard',
  title: 'The Yard',
  seed: 77,
  cells: [W, D],
  zone: 'industrial',
});
const heights: string[][] = Array.from({ length: D }, () => Array.from({ length: W }, () => '0'));
const mats: string[][] = Array.from({ length: D }, () => Array.from({ length: W }, () => '1'));
const set = (g: string[][], i0: number, k0: number, i1: number, k1: number, v: string): void => {
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) (g[k] ?? [])[i] = v;
};
// An asphalt road along z through the middle, forest floor in the north-west corner.
set(mats, 17, 0, 22, D - 1, '0');
set(mats, 0, 20, 12, D - 1, '2');
// A raised loading dock (0.6 m: a block you walk around) and a low kerb you step on.
set(heights, 26, 8, 33, 12, '4');
set(heights, 16, 0, 16, D - 1, '1');
set(heights, 23, 0, 23, D - 1, '1');

const level: Level = {
  ...base,
  origin: [-40, -30],
  spawn: { at: [0, -26], yaw: Math.PI },
  terrain: {
    palette: ['asphalt', 'concrete', 'forestFloor', 'brick'],
    heights: heights.map((r) => r.join('')),
    materials: mats.map((r) => r.join('')),
  },
  objects: [
    // A brick wall across the west yard with a gap to walk through.
    {
      id: 'wallA',
      material: 'brick',
      center: [-22, 1.5, 0],
      size: [20, 3, 0.4],
      yaw: 0,
      solid: true,
    },
    {
      id: 'wallB',
      material: 'brick',
      center: [-4.5, 1.5, 0],
      size: [9, 3, 0.4],
      yaw: 0,
      solid: true,
    },
    // Shipping containers east of the road.
    {
      id: 'containerA',
      material: 'rustedMetal',
      center: [16, 1.3, -14],
      size: [2.4, 2.6, 6],
      yaw: 0,
      solid: true,
    },
    {
      id: 'containerB',
      material: 'paintedMetal',
      center: [20, 1.3, -14],
      size: [2.4, 2.6, 6],
      yaw: 0,
      solid: true,
    },
    {
      id: 'containerC',
      material: 'rustedMetal',
      center: [28, 1.3, 14],
      size: [6, 2.6, 2.4],
      yaw: 0.3,
      solid: true,
    },
  ],
  decor: [
    { id: 'barrelA', kind: 'barrel', material: 'rustedMetal', at: [6, -20], yaw: 0, scale: 1 },
    { id: 'barrelB', kind: 'barrel', material: 'rustedMetal', at: [7, -19], yaw: 1, scale: 1 },
    { id: 'crateA', kind: 'crate', material: 'woodPlanks', at: [-8, -12], yaw: 0.4, scale: 1 },
    { id: 'treeA', kind: 'tree', material: 'bark', at: [-32, 18], yaw: 0, scale: 1.1 },
    { id: 'treeB', kind: 'tree', material: 'bark', at: [-26, 24], yaw: 2, scale: 0.9 },
    { id: 'rockA', kind: 'rock', material: 'concrete', at: [-20, 14], yaw: 0, scale: 1 },
    { id: 'fungusA', kind: 'fungus', material: 'foliage', at: [-30, 10], yaw: 0, scale: 1 },
  ],
  lights: [
    {
      id: 'lampA',
      kind: 'sodiumLamp',
      at: [8, 6, -22],
      color: [1, 0.55, 0.18],
      intensity: 60,
      range: 22,
      flicker: 0.05,
    },
    {
      id: 'lampB',
      kind: 'sodiumLamp',
      at: [-8, 6, 8],
      color: [1, 0.55, 0.18],
      intensity: 60,
      range: 22,
      flicker: 0.6,
    },
    {
      id: 'beaconA',
      kind: 'emergencyBeacon',
      at: [24, 3, -10],
      color: [1, 0.08, 0.04],
      intensity: 30,
      range: 14,
      flicker: 0,
    },
  ],
  mobs: [
    { id: 'shamblerA', mob: 'shambler', at: [-14, 8], yaw: 0, patrol: null },
    { id: 'shamblerB', mob: 'shambler', at: [-16, 9], yaw: 1, patrol: null },
    { id: 'sentryA', mob: 'sentry', at: [10, 2], yaw: 0, patrol: 'yardLoop' },
  ],
  patrols: [
    {
      id: 'yardLoop',
      points: [
        [10, 2],
        [10, 20],
        [0, 24],
        [-4, 6],
      ],
      loop: true,
    },
  ],
  spawnZones: [{ id: 'wolfWoods', min: [-38, 12], max: [-18, 28], mobs: ['wolf'], population: 2 }],
  story: {
    title: 'The Yard',
    start: [{ do: 'startQuest', quest: 'yardPower' }],
    chapters: [
      { id: 'yard', title: 'The Yard', zone: 'industrial', summary: 'Get the floodlights back.' },
    ],
    quests: [
      {
        id: 'yardPower',
        title: 'Floodlights',
        chapter: 'yard',
        main: true,
        summary: 'The yard’s generator still has fuel.',
        objectives: [
          { id: 'note', text: 'Read the shift note', done: { is: 'log', log: 'shiftNote' } },
          {
            id: 'gen',
            text: 'Start the generator',
            done: { is: 'used', interactable: 'yardGenerator' },
          },
        ],
        onComplete: [{ do: 'radio', radio: 'yardDone' }],
      },
    ],
    logs: [
      {
        id: 'shiftNote',
        kind: 'note',
        title: 'Shift note',
        author: 'Night shift',
        date: '2 Sep',
        lines: [
          {
            speaker: 'Note',
            text: 'Generator behind the containers. Choke out, then pull.',
            seconds: 4,
          },
        ],
        lore: [],
      },
    ],
    radio: [
      {
        id: 'yardDone',
        channel: 'CH 4 · OVERWATCH',
        lines: [{ speaker: 'OVERWATCH', text: 'Lights on in the yard. Good.', seconds: 3 }],
      },
    ],
    interactables: [
      {
        id: 'shiftLog',
        kind: 'log',
        label: 'Read: shift note',
        at: [2, 0, -18],
        radius: 2.2,
        once: true,
        effects: [{ do: 'log', log: 'shiftNote' }],
      },
      {
        id: 'yardGenerator',
        kind: 'generator',
        label: 'Start: generator',
        at: [24, 0, -20],
        radius: 2.2,
        once: true,
        effects: [{ do: 'setFlag', flag: 'yard.power', value: 1 }],
      },
    ],
    triggers: [],
    endings: [{ id: 'yardEnd', title: 'Yard', epilogue: ['The test yard is lit.'] }],
  },
};
writeFileSync(new URL('../levels/yard.level.json', import.meta.url), serializeLevel(level));
console.log('wrote levels/yard.level.json');
