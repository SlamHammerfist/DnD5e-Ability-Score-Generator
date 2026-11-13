# D&D 5e Ability Score Generator

Adds a **Generate Stats** button to D&D 5e character sheets with three methods:

- **Roll**: rolls six scores (default `4d6kh3`) and lets you assign them to abilities. Dropped dice are shown struck through. Rolls go to chat, so Dice So Nice animates them.
- **Point Buy**: scores from 8–15 with the standard cost table and a configurable budget (default 27).
- **Standard Array**: assign 15, 14, 13, 12, 10, 8.

For Roll and Standard Array, the values are chips you drag onto an ability, or click a chip and then an ability. Placed chips can be dragged to another ability (the two swap) or back to the pool to remove them. Applying the result writes the base ability scores (`system.abilities.*.value`) and can post a summary to chat.

**Background and feat bonuses are kept.** dnd5e writes Ability Score Improvement advancements (background ASIs, feats like *Ability Score Improvement*, class ASIs) straight into the base score. The generator reads what those advancements have applied, shows it in a **Bonus** column, and adds it on top of the new score, capped at the ability maximum (normally 20). Hover a bonus to see which items it comes from. Bonuses from Active Effects aren't affected, because dnd5e applies them on top of the stored score.

**Requires:** Foundry VTT v13–v14 and dnd5e 5.x–6.x.

## Where's the button?
Open a character sheet and click the header controls menu (⋮). Choose **Generate Stats**.
It appears only on `character` actors you own.

Macro alternative:
```js
game.modules.get("dnd5e-ability-score-generator").api.open(actor);
```

## Settings (world)
| Setting | Default | |
|---|---|---|
| Allow Rolling / Point Buy / Standard Array | on | Turn each method on or off |
| Roll Formula | `4d6kh3` | e.g. `4d6r1kh3`, `3d6`, `2d6+6` |
| Point Buy Budget | 27 | |
| Player Rerolls | 0 | Full-set rerolls after the first roll. `-1` = unlimited. GMs are never limited. |
| Rolling Commits Players | on | After rolling, a player can't switch to point buy or the array |
| Keep Background & Feat Bonuses | on | Adds existing ASI advancement bonuses on top of the generated scores |
| Post to Chat | on | |
| Players Can Use | on | GMs always can |
| Lock After Applying | on | Hides the button from players once scores are applied |

The GM's generator window has a **Reset** button. It sets every ability score back to 10 plus any background, feat or class ASI bonuses, and clears the rolls, the reroll count and the lock.

## Install
Copy the `dnd5e-ability-score-generator` folder into `Data/modules/`, then enable it in your world.
