# Blackwood (full game)

A 1980s-style 8-bit RPG for the browser, phone first. One hero, one seeded continent,
one optional main quest, and as much wandering as you like.

## Run it

```sh
npm install
npm run dev          # play at http://localhost:5173
npm test             # world and game tests
npm run build        # static site in dist/
npm run build:single # one self-contained dist-single/index.html
```

## Controls

| Action | Phone | Keyboard |
| --- | --- | --- |
| Move, bump to attack, open doors | D-pad | Arrow keys |
| Act: talk, open, use, attack what's in front | A | Space |
| Back / close | B | Esc |
| Cast a spell or fire the bow (twice to repeat the last) | CAST / FIRE | C or F |
| Aim: next target / which spell | Up-down / left-right in the strip | Same |
| Aim at a monster | Tap it on the screen (tap again to fire) | Click it |
| Look ahead | ACTIONS | L |
| Actions: sneak, look, wait, rest / camp | ACTIONS | X |
| Menu: save, sound, quit | MENU | Enter |
| Map, Items, Stats, Journal | Tabs | M, I, S, J |
| Journal: switch between the chronicle and Topics | Left / right | Left / right |
| Full-screen map (pan with the d-pad) | MAP again | M again |

## Where things live

```
src/
  main.ts          boot and the frame loop
  gfx/             256x192 screen, palette, font, tile and sprite art (as text grids)
  audio/sound.ts   Web Audio sound effects and the title tune
  input/           keyboard, touch controls and gamepad -> actions
  gen/             seeded generation: continent, villages, dungeons, small sites, quest
  game/            rules (d20), player, items, monsters, dialogue, and game.ts (all actions)
  screens/         title, character creation, and the play screen with its panels
  ui/              the page around the game screen: tabs and pixel-art controls
tests/             determinism, reachability and a scripted quest run
scripts/           dev helpers: worldmap.ts (world stats and map image), balance.ts (fight odds)
```

Everything in the world comes from the seed: `new Rng(seed, 'site', id)` gives each system its
own stream. A save keeps only the seed and what the player changed.

Add `?debug` to the URL to reach the running game from the browser console as `blackwood`.

## Full game progress

This is the full game, built on a copy of the MVP. It saves to its own slot
(`blackwood-full-save-v1`), so it never touches an MVP save.

**Milestone 1: talk, rumours and standing** (`src/game/people.ts`, `src/gen/strongbox.ts`)

- Talking opens a menu: what the person does (TRADE, REST, HEAL...), NEWS, ASK ABOUT... and BYE.
  The elder still goes straight to the quest when there is news.
- ASK ABOUT lists what the player knows: your name and work, this place, its people, the quest,
  every place on the map, and topics from gossip. Each person has a temper (kind, greedy, fearful,
  proud, devout) and knows some things and not others, all fixed by the seed.
- What people say about each topic is kept on the Journal's Topics page.
- Each village and hamlet has a standing from -10 to +10. It changes prices and inn beds, and
  people who dislike you won't talk. Finishing the quest, temple gifts and coins for beggars raise it.
- Strongboxes in houses can be picked. If someone sees, you pay a fine; a second time, you are
  also banned for three days. At -5 the gate is barred after dark.

**Spells and the CAST / FIRE button** (`quickOptions`, `useQuick`, `cast`, `fire` in `game.ts`)

- The old LOOK button is now CAST for a wizard and FIRE for anyone with a bow or fire
  scrolls (LOOK otherwise; LOOK AHEAD is also in MENU and on L). It opens a strip across
  the top of the map: left/right to choose, A or the button again to use. It opens on
  whatever you used last, so repeating is two taps. A no longer fires anything.
- SPARK is free (d4 + WIS mod). MP comes back as you walk. The wizard's hit die is d6.
- WARD (2 MP) soaks up 5 + level damage. BLINK (level 3) jumps you away from danger.
  FIREBALL (level 5) bursts on impact and burns everything around it.
- `npx vite-node scripts/balance.ts` compares the new wizard with the MVP one, in single
  fights and over four fights in a row.

**Aiming** (`targets`, `shotPath` in `game.ts`, `drawCast` in `play.ts`)

- CAST / FIRE aims at the nearest monster in sight, at any angle, and draws the path and a
  blinking frame on it. Up/down picks another monster, left/right another spell. Tapping a
  monster on screen opens the strip aimed at it; tapping it again fires.
- A monster behind a wall, or behind another monster, can't be targeted. With nothing in
  sight, aimed spells fire the way you face. The strip sits at the bottom so it never hides
  what you're aiming at.

**Sneaking, backstabs and ambushes** (`stealth`, `toggleSneak` in `game.ts`)

- Monsters that haven't seen you show a small `?`, sleeping ones a `Z`.
- SNEAK (in MENU) halves your speed and adds +5 to Sneak; attacking ends it. Darkness adds +3:
  night outdoors, or beyond the reach of your light underground.
- A thief's melee hit on an unaware or sleeping monster is a BACKSTAB (double damage), and so is
  their first arrow (AMBUSH).

**ACTIONS and MENU**

- ACTIONS (new button between CAST and MENU; X on a keyboard, Y on a gamepad) holds what the
  character does: SNEAK, LOOK AHEAD, WAIT A TURN, REST / MAKE CAMP. MENU keeps the game
  itself: SAVE, SOUND, QUIT. Pressing the other button switches lists; the same one closes.
- Messages and the CAST strip move to the top of the map whenever the hero is low on the
  screen (just through a village gate, say), so they never cover the hero.

**Milestone 2: daily routines** (`src/game/routines.ts`, `src/gen/guards.ts`)

- The day has four watches. Morning (06-12): villagers work outside, shops and the temple open.
  Afternoon (12-17): errands around the crossroads. Evening (17-21): the inn (or the temple), the
  shop shuts. Night (21-06): home to bed. The innkeeper and the guards never sleep.
- People walk between their spots step by step. Arriving, loading or resting puts everyone
  straight where they belong. Everything is planned from the village layout and the seed.
- Sleepers show a `Z`, can't be talked to, and see no thieves.
- Guards: two per village, one per hamlet. By day at the gate, in the evening at the crossroads,
  at night on patrol. They spot thieves from further off. If the village dislikes you (-2 or
  worse), a guard follows you around.
- Nobody can trap you: walking into someone who stands in a doorway or gate (or while you
  stand in one), or into the guard following you, swaps places with them. A following guard
  never comes through a door after you; it waits outside.

**Milestone 3: progression** (`rules.ts`, `player.ts`, the level-up part of `game.ts`)

- Levels 1 to 15, with XP needed = 50 x level x (level - 1): 100 for level 2, 10,500 for 15.
- Each level: train one skill (+1 to ATTACK, DEFENSE, SNEAK, LOCKPICK, MAGIC or HEAL). Levels 3, 6,
  9, 12 and 15: choose a perk from three on offer. Levels 4, 8 and 12: raise an attribute. These
  choices can't be skipped; owed ones come back after loading or switching tabs.
- Perks, five per class. Warrior: CLEAVE, IRON HIDE, SECOND WIND, WEAPON MASTER, BULWARK.
  Thief: ASSASSIN, SHADOW STEP, FENCE, LIGHT FINGERS, DEADEYE. Wizard: SPELL FOCUS, DEEP WELL,
  FAMILIAR, QUICK MIND, ARCANE WARD.
- Spellbook: tomes teach DETECT, SHIELD, HOLD, RECALL, BANISH and CHAIN BOLT (each needs a
  minimum level). DETECT and SHIELD tomes are sold in shops; all six turn up in dungeon chests.
- Gear grades: FINE (+1), MASTERWORK (+2) and RUNED (+3) versions of every weapon and armour,
  from depth 2, 3 and 4 down. A few FINE pieces are sold in shops.
- Character creation adds a background (FARMHAND, ACOLYTE, STREET RAT, SOLDIER, SCRIBE) and a
  HARD MODE toggle: death ends the tale and deletes the save.

**Milestone 4a: a bigger world** (`src/gen/regions.ts`, `src/gen/world.ts`)

- The continent is 384x384 (it was 256x256). The Vale sits in the middle; five regions lie
  around it in a seeded order: fens, highlands, an ashwood, downs and the Blight. Each pulls
  the terrain its own way (wetter, rockier, deader...) and has its own name.
- Danger rises one step for every 30 tiles beyond the Vale, plus one in the Blight (1 to 8).
  It picks the monsters and their strength: past danger 5 they come as GRIM, DIRE, ELDER and
  DREAD forms with more HP, harder hits and more XP. Stats shows the region and the danger.
- Every region has a town (a full village) joined to the others by road, and a landmark near
  its far edge: the SUNKEN SPIRE, GIANT'S GRAVE, FALLEN STAR, STONE CIRCLE or LOST CITY. Each
  holds one unique treasure in a locked, guarded chest (GRAVEBREAKER, MIRESHROUD, STARFALL
  STAFF, WARDEN'S BOW, AEGIS OF THE LOST).
- Horses: 150 gold from any shop. Two steps a turn along roads. Your horse waits outside any
  place you go into, and you ride on when you leave by the same way.
- Saves are now version 2. A save from before this change can't load into the new world.

## Milestone 4b: the daily world tick

Each dawn the world moves on by itself (`src/sim/world.ts`). The tick runs once per game day
and catches up on any days skipped by resting or travel, so it gives the same result for a seed
however you get there.

- **Seasons** follow the calendar months. Winter covers the land in snow and raises shop prices
  by 15%; autumn turns the grass and dead wood to rust. The season shows on the Stats page.
- **Lairs**: every cave, ruin and tower outside the Vale has a strength from 0 to 10 that grows
  by chance each day. At 6 its beasts start roaming the land nearby (more wanderers, of the
  lair's kind). At 10 they raid the nearest hamlet within reach.
- **Raided hamlets** are half empty, with no guards and a shut shop, for 5 days; then they spend
  6 days recovering. Leaving a lair with nothing left alive in it clears it, and the settlements
  nearby like you a little more.
- **Caravans** (`src/sim/caravans.ts`): three traders walk the roads between the starting village
  and the region towns, resting half a day at each end. Meet one on the road to TRADE (finer goods
  and rare tomes) or hear NEWS FROM THE ROAD.
- **News**: villagers, innkeepers and traders pass on recent events (raids, gathering beasts,
  cleared lairs, the turning season) as rumours, which mark the places on your map.

## Milestone 5: side quests

`src/game/quests.ts` makes small local jobs from what is really on the map. Every village and
hamlet offers one to three at a time; the offers change every 10 days and come from the seed,
so they're the same until you take one. People with a job for you have a gold **!** over their
heads; talk to them and pick NEED ANY HELP?

| Job | Built from | Done when |
| --- | --- | --- |
| Rescue | a dungeon nearby + the giver's relative | you find them on the deepest floor (6 days, or they're found dead) |
| Hunt | a growing lair nearby | the lair is cleared |
| Clear | a raided hamlet + the lair that raided it | the lair is cleared |
| Recover | a dungeon + an heirloom | you open the chest on the deepest floor |
| Deliver | another settlement + someone there | you hand it over (a few days, by distance) |
| Investigate | a shrine, ruin or tower | you go at night and kill what stirs there |

Then go back to the giver (deliveries pay on the spot) for gold, XP and reputation; they'll
greet you as a friend from then on. The journal has a QUESTS page (left/right to switch pages),
and quest places blink on the map.

## Milestone 6: dungeons

Five kinds of dungeon now, each with its own generator (`src/gen/dungeon.ts`, `src/gen/delve.ts`):

| Kind | Where | Floors | What's special |
| --- | --- | --- | --- |
| Cave | anywhere | 1, or 2 where danger is 3+ | pits and loose rock |
| Barrow | the Vale (main quest) | 3 | a sealed vault and a lever on most floors |
| Tower | beyond the Vale | 3 to 5 | you climb up; round floors; the top floor's vault holds a spell book |
| Mine | highland caves | 2 to 3 | long tunnels with cart tracks, side chambers, goblins, rockfalls |
| Sunken temple | fenland caves | 2 | rooms knee-deep in water (wading is slow); deep water bars the vault until a lever drains it |

- **Traps** are darts, covered pits, alarm wires and loose rock. Within two steps you get one chance
  to spot each (Sneak, +5 while sneaking); DETECT shows them all. A spotted trap is drawn as a red X:
  walk into it to disarm it with Lockpick (a bad fumble sets it off), or go around.
- **Levers** open a floor's sealed door, or drain its deep water. They stay pulled.
- **Iron keys** turn up in chests (and at caravans' prices in shops later): one opens a locked door or
  chest and breaks. Without a key you pick the lock or force the door, whichever you're better at;
  forcing wakes everything nearby.
- **Lairs with several floors** are cleared only when every floor is empty. Floors you've emptied stay
  empty until you leave the site.

## Milestone 7: the three acts and the Blight

- **Act I** is the old quest, with a twist: what dies in the Barrow is only the villain's *shade*,
  and the relic it guarded is cracked. The elder pays you, tells you the rest, and lets you keep it.
- **Act II**: two lieutenants (seeded names, in two different regions) each hold a shard. The elder
  names their lands; people in a lieutenant's own region will tell you the den if you ASK ABOUT the
  name. Each waits on the deepest floor of a tower or cave. Killing one gives a shard and frees
  that region from the Blight for good.
- **Act III**: with the relic and both shards, the black gate of the stronghold in the Blight opens:
  five floors, with the villain on the last. At half health the villain heals, hits harder and
  raises two wights. Then a short ending, and play goes on.
- **The Blight** (`src/sim/blight.ts`) starts its clock the first day you leave the Vale. After 20
  days it takes a region, then another every 15 days, the lieutenants' lands first; never the Vale.
  Blighted land is drawn grey, is one step more dangerous, and its hamlets stand empty; towns
  elsewhere take in refugees. After the villain falls it draws back, a region every 5 days.

## Milestone 8: finishing (version 1.0)

- **Music**: eight short looping tunes (`src/audio/sound.ts`): title, village, the road by day, the
  road by night, dungeon, the Blight, a boss fight and the ending. The game picks the tune from where
  you are. MUSIC and SOUND are separate switches in MENU, remembered between visits.
- **Save slots**: three, chosen on the title screen. A new game takes the first free slot. The game
  saves itself at every dawn as well as on entering and leaving places.
- **Tips**: five first-time hints (talking, the shop and journal, the wide world, the dark, being
  badly hurt), each shown once.
- **COPY SEED** in MENU, to share a world: type the seed when starting a new game.
- **Monsters fight differently**: bandits shoot from a few steps off, goblins run when badly hurt,
  and a wolf's howl wakes every beast nearby.
- **The Blight shows grey on the full-screen map.**
- **Install as an app**: `npm run build` makes `dist/` with a web manifest, icons and a service
  worker (`public/`). Put `dist/` on any web host (https), open it on a phone and choose "Add to Home
  Screen". After it has been opened twice with a connection it runs with none. (The single-file
  build, `npm run build:single`, is for sharing one HTML file and can't be installed.)

### Not built

Left out of the design doc's wish list: rivers, fords and ferries; gear wear and repair; the
16-slot bag limit; trainers, smiths and a stash at the inn; regional prices; export/import of a save
as text; settings for text speed and screen size; walking animation; factions (always planned as a
later update).

## Balance pass (1.1)

The game got too easy past level 7: the hardest monster cost a level 15 warrior 7% of their HP.
`scripts/curve.ts` simulates the difficulty curve; after this pass a fight costs roughly 20-40%.

- Stronger forms start at danger 4 (GRIM) and reach DREAD at danger 7. Each step adds 40% HP
  and +1 to attack, defence and damage.
- Nothing more than two levels below the local danger turns up (no giant rats in the far lands),
  except the beasts of a strong lair.
- Packs: from danger 4, most monsters come in twos; from danger 6, in twos and threes. Bog hags
  and wights always come alone, wisps at most in pairs. Dungeon monsters bring their pack too.
- Camping heals half your HP (an ambush a quarter); an inn bed still heals it all. Healing while
  walking is slower: 1 HP every 30 steps, down to every 10 with Heal skill.
