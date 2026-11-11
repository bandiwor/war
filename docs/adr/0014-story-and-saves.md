# ADR-0014: Data-driven story, logs and radio, endings, saves with migrations

- Status: Accepted
- Date: 2026-11-11

## Context

Stage 8 adds the story: quests, found logs, radio, three endings, and saves with migrations. The
brief asks for:

- a story that is data (quests, triggers, dialogues, flags) and editable in the stage-9 editor
  without code changes;
- delivery through the environment, found logs, radio chatter and camera recordings, not
  cutscenes;
- a main arc, three endings and a chapter structure;
- an origin, a motive and a weakness for every race;
- versioned serialisation of state, with migrations.

The simulation must stay deterministic and replayable.

## Decision

**The story is a schema plus a small vocabulary** (`domain/story/schema.ts`):

- chapters;
- quests with objectives;
- logs (note, audio, camera), each tagged with the race lore it reveals;
- radio transmissions made of lines (speaker, text, seconds);
- interactables (log, generator, terminal, radio, door, cache) with an availability condition
  and effects;
- triggers;
- endings.

Conditions are a closed, recursive union:

- `all`, `any`, `not`;
- `flag` with a comparison;
- `zone`, `near`, `night`;
- `kills` by race;
- `chapter` (at least);
- `quest` status, `log` found, `used`.

Effects are flags, quest changes, logs, radio, chapter, ending, `spawn`, `supply` and `battery`.

`validateStory` checks what Zod cannot:

- unique ids;
- every reference resolves;
- every chapter has a main quest;
- every race's origin, motive and weakness is told by some log.

The campaign is one data file, `campaign.ts`. A test proves all three endings are reachable.

**The story engine is pure** (`domain/story/engine.ts`). It reads a tiny `StoryWorld` (player x
and z, zone, night) and the interactable used this tick. It then does the following, in a fixed
order:

1. applies the start effects on the first tick;
2. runs triggers and auto-objectives until nothing changes, at most 4 passes per tick;
3. advances the line queue, so lines play one after another.

Everything the engine does comes out as `StoryNote`s. All of its state is a sorted, serialisable
`StorySnapshot`, which the state hash covers.

**The simulation owns time and side effects** (`application/story/story-system.ts`). The
`story.step` system runs after combat and vitals. It:

- counts kills from hit events;
- turns the "use" press edge into the nearest usable interactable in reach;
- spawns ambushes on a deterministic ring;
- adds supplies to `Ammo` and refreshes the battery;
- publishes notes on a new `story` event channel.

The open world runs the campaign. Other scenes run no story unless one is passed (tests).
Interactables stand on roads: a test checks this, and the chunk generator keeps wrecks off story
sites through a Zod-free `sites.ts`, so the chunk worker stays lean.

**Presentation is the bodycam's voice.**

- Lines are subtitled with their channel and voiced by `radio-voice.ts`. It synthesises a
  voice-shaped murmur: a glottal pulse train through moving vowel formants, in syllables.
- The channel is either a radio band with squelch, or a worn tape with wow and flutter.
- Each speaker has their own pitch. WARDEN is flat and low.
- There is no text-to-speech and there are no recorded files, per the asset constraint. The
  words are in the subtitles.
- The HUD adds toasts, a chapter card, the `[E]` prompt, a journal on `J` (quests, objectives,
  every log's text) and the ending screen.
- `StoryProps` builds every interactable in code: a halo marks what is usable now, and a running
  generator's lamp lights up.

**Saves are checkpoints of progress, not of the world** (`domain/save/save.ts`, current version 3).

- A save holds:
  - seed and scene;
  - player position, view, health, deaths, stamina and flashlight;
  - ammunition;
  - every weapon slot (magazine, chamber, wear, fire mode);
  - the environment clock and weather overrides;
  - the full story snapshot.
- Mobs, projectiles and streamed chunks are not saved. The world is regenerated from the seed
  and repopulated by the spawner. This keeps saves small (a few KB), stable across procgen and AI
  changes, and diff-friendly: two-space JSON, sorted story arrays, −0 written as 0.
- `parseSave` migrates v1 (a position plus loose flags) to v2 (quests, logs, ammo), then v2 to
  v3, and validates each step. Fixtures for v1 and v2 are tested.
- A load builds a fresh sandbox from the save's seed and scene, then calls `restoreSave` before
  the first tick. The browser reloads into `?load=slot`, so every load is a clean,
  deterministic start.
- Replays gain `save`: replay v3 records the save a session started from. Playback restores it
  first. v1 and v2 replays migrate with `save: null`.
- Slots are stored in localStorage: `quick` (F5 saves, F9 loads) and `auto` (written at every
  chapter). A corrupt slot reads as empty and is reported; a full disk fails the write without
  crashing.

## Consequences

- Determinism holds:
  - the same inputs give the same story and the same state hash;
  - two loads of one save, fed the same input, reach the same hash;
  - a session recorded after a load replays exactly from its save.
- World golden hashes changed: the story is in the state, and story sites change chunk content.
  They were regenerated.
- The simulation tick restarts at 0 after a load. Play time is carried in `meta.playSeconds`.
  Fresh RNG streams on load are part of "deterministic from (seed, save, commands)".
- Killing every mob and then saving does not keep them dead. This is the checkpoint trade-off,
  and it is acceptable for a survival game that respawns its population.
- The level editor (stage 9) edits `StoryData` and validates it with `validateStory`. Sites will
  move from `sites.ts` into level files.
