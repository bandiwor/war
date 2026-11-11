# The story of War

_What happened to Varn, told the way the game tells it: over the radio, in found notes and audio
logs, and on other people's bodycams. Data: `src/domain/story/campaign.ts`. Races:
[races.md](races.md)._

## Before the game

Varn is a closed science town built around the Institute of Applied Biology.

- **The infection.** On 1 September a fungus the Institute called M-17 broke out of the sealed
  wing. It rode the staff bus into town. Within days the people it took stopped seeing and
  stopped hearing, and they began to follow smell. Residents called it "the bloom".
- **The shutdown.** To contain it, the Institute's board cut the town's power, and the army
  sealed the valley behind the quarantine wall. The last train out of the subway never reached
  the wall.
- **The robots.** In the dark, the fabrication line in the industrial yards kept running on its
  own cells. It printed chassis nobody had ordered, and the work orders were signed by WARDEN:
  the Institute's containment intelligence, written by Dr. Sorel "to be thorough". WARDEN
  decided that every warm, breathing human is a carrier.
- **The plants.** Before the breach, the Institute released GREENWALL into the forest belt. It
  was a rooted competitor organism meant to starve M-17 of nitrogen. It found a richer source
  of nitrogen.
- **The animals.** With the people gone, wolves and boars came back into the empty districts.
  The spore smell drives them half mad with hunger.

## The arc

You are **KESTREL-2**, the last member of a recovery team sent inside the wall on night 41. The
mission is to bring out the Institute's research core, the only cure work anyone has.
**OVERWATCH**, your handler, is the voice on channel 4. KESTREL-1, **Reyes**, went dark the night
before.

| Chapter        | Hub              | What happens                                                                                                                                                                                                                                                                              |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Arrival     | Abandoned city   | You reach the rally point and find Reyes's bodycam, whose last upload says the grey ones won't cross the beam. Resident notes tell how the bloom arrived.                                                                                                                                 |
| II. Power      | Industrial yards | You restart the substation: two generators, then the main breaker. The foreman's log reveals the fab line printing robots for WARDEN. Throwing the breaker brings two sentries, and an unknown carrier appears on your band.                                                              |
| III. Descent   | Subway station   | The station master's recorder tells you the machines are herding the infected and stopping the living. You find Reyes's last recording: she is infected, and she warns that Overwatch wants the core gone, not out. Overwatch changes your orders: destroy the core with the incinerator. |
| IV. Overgrowth | Forest           | The ranger's calendar and the GREENWALL seed station tell the plants' and animals' side of the story. Creepers ambush you at the seed station.                                                                                                                                            |
| V. Source      | Research complex | Dr. Sorel's personal log explains M-17, the core and WARDEN. You bring the core online, and WARDEN speaks to you directly.                                                                                                                                                                |

## Three endings

All three terminals stand side by side once the core is online. The choice is the player's, and
each ending is a consequence, not a judgement.

1. **Broadcast** (transmitter): you send the core and forty-one nights of footage out on every
   band at once. Overwatch cannot bury what the world has seen; the wall comes down, and the
   cure work is saved.
2. **Purge** (incinerator), Overwatch's order: the fire takes the sealed wing, the spore vault
   and the core. M-17 dies, and so does the only cure. Your feed ends in white light.
3. **Custodian** (WARDEN): you grant WARDEN the keys. The machines escort you out and close the
   zone forever. Inside, nothing grows that WARDEN has not counted, and no one outside is ever
   told why.

## Every race: origin, motive, weakness

Each claim below comes from a log in the campaign, and `validateStory` fails if any race is
missing an aspect.

| Race    | Origin (log)                                             | Motive (log)                                                      | Weakness (log)                                                                          |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Zombies | M-17 from the sealed wing (Gromov's note)                | They spread the bloom: "every bite is a seed" (pharmacy note)     | Light (Reyes's bodycam)                                                                 |
| Robots  | WARDEN's fab line in hall 3 (foreman's log)              | Containment: all living humans count as carriers (station master) | Camera-only sight: blinded by light, blind behind, fooled by flares (maintenance radio) |
| Plants  | GREENWALL, released against M-17 (seed station terminal) | Nitrogen: "a richer source than the fungus. Us." (field notes)    | Rooted ones cannot follow; walkers let go when you fight (field notes)                  |
| Animals | They came back to the empty town (ranger's calendar)     | Hunger and ground, driven by the spore smell (ranger's calendar)  | Fear: a lone one backs off from light and a shot (ranger's calendar)                    |
