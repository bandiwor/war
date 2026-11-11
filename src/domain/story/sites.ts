/**
 * Where the story happens in the open world: every interactable stands on a
 * road or pavement (checked by a test), and the chunk generator keeps wrecks
 * and debris off these points. Kept free of Zod so the chunk worker can
 * import it without the story schema.
 */
export const SITES = {
  // Chapter 1, the abandoned city.
  rallyPoint: [-128, 0, -20],
  reyesCamera: [-128, 0, -60],
  gromovFlat: [-128, 0, -100],
  cityCache: [-128, 0, -150],
  pharmacy: [-96, 0, -112],
  // Chapter 2, the industrial yards.
  generatorA: [128, 0, -60],
  foremanDesk: [128, 0, -96],
  generatorB: [128, 0, -130],
  maintenanceRadio: [128, 0, -165],
  mainBreaker: [128, 0, -200],
  // Chapter 3, the subway station.
  stationGate: [0, 0, 8],
  stationOffice: [0, 0, 28],
  reyesLast: [0, 0, 44],
  keycard: [0, 0, 66],
  // Chapter 4, the forest.
  forestEdge: [-128, 0, 100],
  rangerCabin: [-128, 0, 140],
  seedStation: [-180, 0, 160],
  forestCache: [-70, 0, 160],
  // Chapter 5, the research complex.
  instituteGate: [96, 0, 160],
  sorelLab: [140, 0, 160],
  coreTerminal: [160, 0, 160],
  wardenTerminal: [180, 0, 160],
  transmitter: [200, 0, 160],
  incinerator: [222, 0, 160],
} as const satisfies Record<string, readonly [number, number, number]>;

export type SiteId = keyof typeof SITES;

export const SITE_POINTS: readonly (readonly [number, number, number])[] = Object.values(SITES);
