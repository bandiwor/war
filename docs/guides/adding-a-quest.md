# How to add a quest, a log or a radio call

The story is data: `src/domain/story/campaign.ts`. The schema and everything it allows are in
`src/domain/story/schema.ts`. No engine code changes are needed.

```ts
// 1. A place in the world, on a road (sites.ts). The chunk generator keeps it clear.
pumpHouse: [128, 0, -230],

// 2. A log (note | audio | camera). Audio logs and recordings also play their lines.
{
  id: 'pumpLog', kind: 'audio', title: 'Pump house recorder', author: 'Ruda', date: '20 Sep',
  lines: [L('Ruda', 'The water still runs. Nothing else does.')],
  lore: [],                            // or [{ race: 'robot', aspect: 'motive' }]
},

// 3. Something to use: a condition for when it can be used, and effects.
{
  id: 'pumpRecorder', kind: 'radio', label: 'Play: pump house recorder', at: at3('pumpHouse'),
  available: { is: 'quest', quest: 'pumps', status: 'active' },
  effects: [log('pumpLog'), set('pumps.heard')],
},

// 4. A quest whose objectives complete themselves when their condition holds.
{
  id: 'pumps', title: 'The pump house', chapter: 'power', main: false,
  summary: 'Someone kept the water running.',
  objectives: [
    { id: 'find', text: 'Find the pump house', done: near('pumpHouse') },
    { id: 'listen', text: 'Play the recorder', done: flag('pumps.heard') },
  ],
  onComplete: [{ do: 'supply', ammo: 'r9x19', amount: 20 }],
},

// 5. A trigger that starts it, and a radio call.
{ id: 'pumpsHint', when: done('substation'), effects: [{ do: 'startQuest', quest: 'pumps' }, radio('pumps')] },
```

Check it:

1. `npm test`. The schema parses the campaign at import, and `story.test.ts` runs
   `validateStory` (unknown ids, missing references, race lore) and checks that interactables
   stand on roads. Add your quest to the playthrough there if it gates the main arc.
2. Debug menu → **Story**: pick your interactable, **Go**, **Use**. Watch the quest, the flags
   and the line on air. **J** opens the journal.
3. Saves need nothing: the story snapshot holds every flag, quest and log by id. Renaming an id
   breaks old saves that used it. Add a save migration if you must rename one.
