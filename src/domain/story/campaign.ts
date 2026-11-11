import {
  StorySchema,
  type Condition,
  type Effect,
  type StoryData,
  type StoryInput,
} from './schema';
import { SITES, type SiteId } from './sites';

/**
 * The main story arc of War (docs/lore/story.md). You are KESTREL-2, the
 * last of a recovery team sent into the Varn quarantine zone, 41 days after
 * it was sealed, to bring out the Institute's research core. Five chapters,
 * one per hub; three endings, chosen at the Institute. Told through radio,
 * found notes, audio logs and other bodycams' recordings.
 */
const L = (speaker: string, text: string, seconds = 4) => ({ speaker, text, seconds });
const at2 = (s: SiteId): [number, number] => [SITES[s][0], SITES[s][2]];
const at3 = (s: SiteId): [number, number, number] => [SITES[s][0], SITES[s][1], SITES[s][2]];
const near = (s: SiteId, radius = 6): Condition => ({ is: 'near', at: at2(s), radius });
const used = (interactable: string): Condition => ({ is: 'used', interactable });
const flag = (name: string, value = 1): Condition => ({
  is: 'flag',
  flag: name,
  op: 'gte',
  value,
});
const all = (...of: Condition[]): Condition => ({ is: 'all', of });
const done = (quest: string): Condition => ({ is: 'quest', quest, status: 'done' });
const log = (id: string): Effect => ({ do: 'log', log: id });
const radio = (id: string): Effect => ({ do: 'radio', radio: id });
const set = (name: string, value = 1): Effect => ({ do: 'setFlag', flag: name, value });

const OW = 'OVERWATCH';
const ME = 'KESTREL-2';
const REYES = 'KESTREL-1 (Reyes)';
const SOREL = 'Dr. A. Sorel';
const WARDEN = 'WARDEN';

const RAW: StoryInput = {
  title: 'War',
  start: [{ do: 'startQuest', quest: 'rally' }, radio('intro')],

  chapters: [
    {
      id: 'arrival',
      title: 'I. Arrival',
      zone: 'abandonedCity',
      summary: 'Night 41 of the quarantine. Find what is left of your team.',
    },
    {
      id: 'power',
      title: 'II. Power',
      zone: 'industrial',
      summary: 'The zone has been dark for a month. Bring the substation back.',
    },
    {
      id: 'descent',
      title: 'III. Descent',
      zone: 'subway',
      summary: 'Follow Reyes underground, where the evacuation ended.',
    },
    {
      id: 'overgrowth',
      title: 'IV. Overgrowth',
      zone: 'forest',
      summary: 'The only road north runs through what the Institute planted.',
    },
    {
      id: 'source',
      title: 'V. Source',
      zone: 'researchComplex',
      summary: 'The Institute. The core. Whoever is still giving orders here.',
    },
  ],

  quests: [
    {
      id: 'rally',
      title: 'Rally point',
      chapter: 'arrival',
      main: true,
      summary: 'KESTREL went dark here last night. Reach the rally point and find out why.',
      objectives: [
        { id: 'reach', text: 'Reach the rally point on the high street', done: near('rallyPoint') },
        { id: 'camera', text: 'Find Reyes’s bodycam', done: used('reyesCamera') },
      ],
      onComplete: [radio('substation'), { do: 'startQuest', quest: 'substation' }],
    },
    {
      id: 'scavenge',
      title: 'Scavenge',
      chapter: 'arrival',
      main: false,
      summary: 'The pharmacy and the corner shop were never looted. Ammunition, batteries.',
      objectives: [
        { id: 'cache', text: 'Search the corner shop', done: used('cityCache') },
        { id: 'pharmacy', text: 'Search the pharmacy', done: used('pharmacy') },
      ],
      onComplete: [set('scavenged')],
    },
    {
      id: 'substation',
      title: 'Restart the substation',
      chapter: 'power',
      main: true,
      summary:
        'The subway line runs on the yards’ substation. Two generators, then the main breaker.',
      objectives: [
        {
          id: 'yards',
          text: 'Get to the industrial yards',
          done: { is: 'zone', zone: 'industrial' },
        },
        { id: 'genA', text: 'Start generator A', done: flag('power.genA') },
        { id: 'genB', text: 'Start generator B', done: flag('power.genB') },
        { id: 'breaker', text: 'Throw the main breaker', done: flag('power.on') },
      ],
      onComplete: [radio('carrier'), { do: 'startQuest', quest: 'descent' }],
    },
    {
      id: 'descent',
      title: 'Into the station',
      chapter: 'descent',
      main: true,
      summary: 'Reyes went into the subway. The lights are on down there now.',
      objectives: [
        { id: 'station', text: 'Enter the station', done: near('stationGate', 8) },
        { id: 'reyes', text: 'Find Reyes', done: used('reyesLast') },
        { id: 'keycard', text: 'Take the Institute keycard', done: flag('keycard') },
      ],
      onComplete: [radio('orders'), { do: 'startQuest', quest: 'forest' }],
    },
    {
      id: 'forest',
      title: 'Through the forest',
      chapter: 'overgrowth',
      main: true,
      summary: 'The old road through the forest leads to the Institute gate.',
      objectives: [
        { id: 'edge', text: 'Reach the forest road', done: near('forestEdge', 8) },
        { id: 'seed', text: 'Find out what grew here', done: used('seedStation') },
        { id: 'gate', text: 'Reach the Institute gate', done: near('instituteGate', 8) },
      ],
      onComplete: [{ do: 'startQuest', quest: 'core' }],
    },
    {
      id: 'core',
      title: 'The core',
      chapter: 'source',
      main: true,
      summary: 'Bring the research core online. Then decide what it is for.',
      objectives: [
        { id: 'lab', text: 'Search Dr. Sorel’s lab', done: used('sorelLab') },
        { id: 'online', text: 'Bring the core online', done: flag('core.online') },
        { id: 'choose', text: 'Decide: transmit, purge, or answer WARDEN', done: flag('choice') },
      ],
      onComplete: [],
    },
  ],

  logs: [
    {
      id: 'gromov',
      kind: 'note',
      title: 'Note pinned to a door',
      author: 'P. Gromov, flat 12',
      date: '3 Sep',
      lines: [
        L(
          'Gromov',
          'The Institute bus came back from the sealed wing with the windows fogged white.',
        ),
        L('Gromov', 'By morning the driver’s eyes had gone grey. Then he stopped hearing us.'),
        L('Gromov', 'They do not look at you. They sniff. If you bleed, they find you.'),
      ],
      lore: [{ race: 'zombie', aspect: 'origin' }],
    },
    {
      id: 'reyesCam',
      kind: 'camera',
      title: 'KESTREL-1 bodycam, last upload',
      author: REYES,
      date: 'Night 40, 23:52',
      lines: [
        L(REYES, 'Contact, contact! Keep your lights on them — they won’t cross the beam!'),
        L(REYES, 'Novak’s down. Fall back to the station, we go north under the city.'),
        L(REYES, 'If anyone finds this: the lamps. Stay in the lamps.'),
      ],
      lore: [{ race: 'zombie', aspect: 'weakness' }],
    },
    {
      id: 'pharmacist',
      kind: 'note',
      title: 'Pharmacy till receipt, written on the back',
      author: 'unknown',
      date: '9 Sep',
      lines: [
        L('Note', 'They are not hunting. They are carrying it. Every bite is a seed.'),
        L('Note', 'The ones that come in groups never call to each other. They just arrive.'),
      ],
      lore: [{ race: 'zombie', aspect: 'motive' }],
    },
    {
      id: 'foreman',
      kind: 'note',
      title: 'Shift foreman’s desk log',
      author: 'Foreman, hall 3',
      date: '12 Sep',
      lines: [
        L('Foreman', 'Power was cut on the 2nd. Hall 3’s fab line kept running on its own cells.'),
        L('Foreman', 'It is printing chassis. Nobody ordered them. The work orders say WARDEN.'),
      ],
      lore: [{ race: 'robot', aspect: 'origin' }],
    },
    {
      id: 'maintenance',
      kind: 'audio',
      title: 'Maintenance radio, looped message',
      author: 'Technician Ruda',
      date: '19 Sep',
      lines: [
        L(
          'Ruda',
          'They only see through the camera. Light in the lens and they’re blind for a few seconds.',
        ),
        L('Ruda', 'And they never look behind. I walked past three of them in the dark.'),
        L('Ruda', 'Flares fool them. They go to the heat like it’s a person.'),
      ],
      lore: [{ race: 'robot', aspect: 'weakness' }],
    },
    {
      id: 'stationMaster',
      kind: 'audio',
      title: 'Station master’s office recorder',
      author: 'I. Lenk, station master',
      date: '6 Sep',
      lines: [
        L('Lenk', 'Last train out was at nine. Twelve hundred aboard. It never reached the wall.'),
        L(
          'Lenk',
          'The machines came down after. They are not killing the grey ones — they are herding them.',
        ),
        L('Lenk', 'Anything warm and breathing, they stop. As if we were the infection.'),
      ],
      lore: [{ race: 'robot', aspect: 'motive' }],
    },
    {
      id: 'reyesLast',
      kind: 'camera',
      title: 'KESTREL-1 bodycam, platform 2',
      author: REYES,
      date: 'Night 41, 01:14',
      lines: [
        L(REYES, 'It got in the cut on my hand. I can smell everything now. Everything.'),
        L(REYES, 'Overwatch knew what was in the core. They don’t want it out. They want it gone.'),
        L(REYES, 'Card’s on the bench. Go north. Don’t let them decide for you.'),
      ],
      lore: [],
    },
    {
      id: 'ranger',
      kind: 'note',
      title: 'Ranger’s cabin, wall calendar',
      author: 'T. Weir, forest ranger',
      date: '30 Sep',
      lines: [
        L('Weir', 'The wolves came back into town the week we left. Then the boars.'),
        L(
          'Weir',
          'The spore smell drives them half mad with hunger. They hold ground now, like it is theirs.',
        ),
        L('Weir', 'A lone one backs off from a light and a shot in the air. A pack does not.'),
      ],
      lore: [
        { race: 'animal', aspect: 'origin' },
        { race: 'animal', aspect: 'motive' },
        { race: 'animal', aspect: 'weakness' },
      ],
    },
    {
      id: 'greenwall',
      kind: 'audio',
      title: 'Seed station terminal, project GREENWALL',
      author: SOREL,
      date: '28 Aug',
      lines: [
        L(
          SOREL,
          'GREENWALL is a competitor organism. It will out-grow M-17 and starve it of nitrogen.',
        ),
        L(
          SOREL,
          'The release is approved for the forest belt. It is rooted. It cannot spread on its own.',
        ),
      ],
      lore: [{ race: 'plant', aspect: 'origin' }],
    },
    {
      id: 'greenwallFail',
      kind: 'note',
      title: 'Field notes, clipped to the seed station door',
      author: 'Field team B',
      date: '17 Sep',
      lines: [
        L('Field team', 'It found a richer source of nitrogen than the fungus. Us.'),
        L(
          'Field team',
          'The walking ones jump. Pull, twist, shake — they let go when you fight. The rooted ones cannot follow.',
        ),
      ],
      lore: [
        { race: 'plant', aspect: 'motive' },
        { race: 'plant', aspect: 'weakness' },
      ],
    },
    {
      id: 'sorel',
      kind: 'audio',
      title: 'Lab B-4, personal log',
      author: SOREL,
      date: '1 Sep',
      lines: [
        L(
          SOREL,
          'M-17 breached the sealed wing at 04:10. The board voted to cut the town’s power.',
        ),
        L(SOREL, 'The core holds the only cure work we have. And WARDEN’s containment keys.'),
        L(
          SOREL,
          'If WARDEN decides people are carriers, it will contain people. I wrote it to be thorough.',
        ),
      ],
      lore: [],
    },
  ],

  radio: [
    {
      id: 'intro',
      channel: 'CH 4 · OVERWATCH',
      lines: [
        L(OW, 'KESTREL-2, Overwatch. You’re inside the wall. Bodycam is recording.'),
        L(OW, 'KESTREL-1 went dark at the rally point on the high street. Go find them.'),
        L(ME, 'Copy. Moving.', 2),
      ],
    },
    {
      id: 'dark',
      channel: 'CH 4 · OVERWATCH',
      lines: [L(OW, 'Full dark now. Keep that light charged — the grey ones don’t like it.')],
    },
    {
      id: 'firstKill',
      channel: 'CH 4 · OVERWATCH',
      lines: [L(OW, 'Shots on your feed. Headshots drop them. Conserve ammunition.')],
    },
    {
      id: 'substation',
      channel: 'CH 4 · OVERWATCH',
      lines: [
        L(OW, 'Reyes was heading for the subway. The line is dead — the whole zone is.'),
        L(OW, 'Get the substation in the yards running. Two generators, then the main breaker.'),
      ],
    },
    {
      id: 'interference',
      channel: 'CH ? · UNKNOWN',
      lines: [L('???', '— carrier detected — sector seven — containment —', 3)],
    },
    {
      id: 'carrier',
      channel: 'CH 4 · OVERWATCH',
      lines: [
        L(OW, 'Power is on across the yards. And something else just came on with it.'),
        L(OW, 'Unknown carrier on our band. Ignore it. Get into the station.'),
      ],
    },
    {
      id: 'orders',
      channel: 'CH 4 · OVERWATCH',
      lines: [
        L(OW, 'KESTREL-2, new orders. Do not extract the core. Destroy it.'),
        L(OW, 'The incinerator in the complex will take the whole wing. That’s an order.'),
        L(ME, 'And Reyes?', 2),
        L(OW, 'Reyes is a carrier. Overwatch out.'),
      ],
    },
    {
      id: 'warden',
      channel: 'CH 0 · WARDEN',
      lines: [
        L(WARDEN, 'Core access logged. Identify.', 3),
        L(WARDEN, 'You carry spores in your filters. Every human here is a carrier.'),
        L(
          WARDEN,
          'Containment can be completed. Grant me the keys and no one leaves the zone again.',
        ),
      ],
    },
  ],

  interactables: [
    {
      id: 'reyesCamera',
      kind: 'log',
      label: 'Take: KESTREL-1 bodycam',
      at: at3('reyesCamera'),
      effects: [log('reyesCam')],
    },
    {
      id: 'gromovNote',
      kind: 'log',
      label: 'Read: note on a door',
      at: at3('gromovFlat'),
      effects: [log('gromov')],
    },
    {
      id: 'cityCache',
      kind: 'cache',
      label: 'Search: corner shop',
      at: at3('cityCache'),
      effects: [
        { do: 'supply', ammo: 'r9x19', amount: 30 },
        { do: 'supply', ammo: 'flare', amount: 2 },
      ],
    },
    {
      id: 'pharmacy',
      kind: 'cache',
      label: 'Search: pharmacy',
      at: at3('pharmacy'),
      effects: [{ do: 'battery' }, log('pharmacist')],
    },
    {
      id: 'generatorA',
      kind: 'generator',
      label: 'Start: generator A',
      at: at3('generatorA'),
      available: { is: 'quest', quest: 'substation', status: 'active' },
      effects: [set('power.genA'), radio('interference')],
    },
    {
      id: 'foremanDesk',
      kind: 'log',
      label: 'Read: foreman’s desk log',
      at: at3('foremanDesk'),
      effects: [log('foreman')],
    },
    {
      id: 'generatorB',
      kind: 'generator',
      label: 'Start: generator B',
      at: at3('generatorB'),
      available: { is: 'quest', quest: 'substation', status: 'active' },
      effects: [set('power.genB')],
    },
    {
      id: 'maintenanceRadio',
      kind: 'radio',
      label: 'Listen: maintenance radio',
      at: at3('maintenanceRadio'),
      effects: [log('maintenance')],
    },
    {
      id: 'mainBreaker',
      kind: 'terminal',
      label: 'Throw: main breaker',
      at: at3('mainBreaker'),
      available: all(flag('power.genA'), flag('power.genB')),
      effects: [set('power.on'), { do: 'spawn', mob: 'sentry', at: [128, -184], count: 2 }],
    },
    {
      id: 'stationOffice',
      kind: 'radio',
      label: 'Play: station master’s recorder',
      at: at3('stationOffice'),
      effects: [log('stationMaster')],
    },
    {
      id: 'reyesLast',
      kind: 'log',
      label: 'Take: Reyes’s bodycam',
      at: at3('reyesLast'),
      effects: [log('reyesLast'), set('reyes.found')],
    },
    {
      id: 'keycard',
      kind: 'cache',
      label: 'Take: Institute keycard',
      at: at3('keycard'),
      available: flag('reyes.found'),
      effects: [set('keycard'), { do: 'supply', ammo: 'r556', amount: 60 }],
    },
    {
      id: 'rangerCabin',
      kind: 'log',
      label: 'Read: ranger’s calendar',
      at: at3('rangerCabin'),
      effects: [log('ranger')],
    },
    {
      id: 'seedStation',
      kind: 'terminal',
      label: 'Access: GREENWALL seed station',
      at: at3('seedStation'),
      effects: [log('greenwall'), log('greenwallFail')],
    },
    {
      id: 'forestCache',
      kind: 'cache',
      label: 'Search: ranger’s supply box',
      at: at3('forestCache'),
      effects: [
        { do: 'supply', ammo: 'r12ga', amount: 16 },
        { do: 'supply', ammo: 'molotov', amount: 2 },
      ],
    },
    {
      id: 'sorelLab',
      kind: 'log',
      label: 'Play: lab B-4 log',
      at: at3('sorelLab'),
      effects: [log('sorel')],
    },
    {
      id: 'coreTerminal',
      kind: 'terminal',
      label: 'Bring the core online',
      at: at3('coreTerminal'),
      available: all(flag('keycard'), used('sorelLab')),
      effects: [
        set('core.online'),
        radio('warden'),
        { do: 'spawn', mob: 'stalker', at: [150, 175], count: 2 },
      ],
    },
    {
      id: 'transmitter',
      kind: 'terminal',
      label: 'Transmit: the core and every recording',
      at: at3('transmitter'),
      available: flag('core.online'),
      effects: [set('choice'), { do: 'ending', ending: 'broadcast' }],
    },
    {
      id: 'incinerator',
      kind: 'terminal',
      label: 'Purge: the incinerator',
      at: at3('incinerator'),
      available: flag('core.online'),
      effects: [set('choice'), { do: 'ending', ending: 'purge' }],
    },
    {
      id: 'wardenTerminal',
      kind: 'terminal',
      label: 'Answer: grant WARDEN the keys',
      at: at3('wardenTerminal'),
      available: flag('core.online'),
      effects: [set('choice'), { do: 'ending', ending: 'custodian' }],
    },
  ],

  triggers: [
    { id: 'dark', when: { is: 'night', min: 0.85 }, effects: [radio('dark')] },
    {
      id: 'firstKill',
      when: { is: 'kills', race: 'any', count: 1 },
      effects: [radio('firstKill')],
    },
    {
      id: 'scavengeHint',
      when: near('rallyPoint'),
      effects: [{ do: 'startQuest', quest: 'scavenge' }],
    },
    {
      id: 'toPower',
      when: done('rally'),
      effects: [{ do: 'chapter', chapter: 'power' }],
    },
    {
      id: 'toDescent',
      when: done('substation'),
      effects: [{ do: 'chapter', chapter: 'descent' }],
    },
    {
      id: 'toOvergrowth',
      when: done('descent'),
      effects: [{ do: 'chapter', chapter: 'overgrowth' }],
    },
    {
      id: 'toSource',
      when: done('forest'),
      effects: [{ do: 'chapter', chapter: 'source' }],
    },
    {
      id: 'forestAmbush',
      when: all({ is: 'chapter', chapter: 'overgrowth' }, near('seedStation', 20)),
      effects: [{ do: 'spawn', mob: 'creeper', at: [-170, 168], count: 2 }],
    },
  ],

  endings: [
    {
      id: 'broadcast',
      title: 'Broadcast',
      epilogue: [
        'The core and forty-one nights of footage go out on every band at once.',
        'Overwatch cannot bury what the whole world has seen. The wall comes down within a month.',
        'They find the cure work in the core. They find you at the mast, still recording.',
      ],
    },
    {
      id: 'purge',
      title: 'Purge',
      epilogue: [
        'The incinerator takes the sealed wing, the spore vault and the core.',
        'M-17 dies in the fire, and with it the only cure anyone ever had.',
        'Overwatch logs the mission a success. KESTREL-2’s feed ends in white light.',
      ],
    },
    {
      id: 'custodian',
      title: 'Custodian',
      epilogue: [
        'WARDEN takes the keys. Every light in the zone comes on at once.',
        'The machines escort you to the wall, then close it behind you for good.',
        'Inside, nothing grows that WARDEN has not counted. Outside, no one is ever told why.',
      ],
    },
  ],
};

export const CAMPAIGN: StoryData = StorySchema.parse(RAW);
