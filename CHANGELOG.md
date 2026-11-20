# Changelog

## 1.5.0 (2026-11-19)
### Changed
- The generator window now uses the dnd5e system's window style, like the system's own dialogs and the D&D 5e Crafting module: the large title with the character's name beneath it, sheet-style method tabs with icons, gold-bordered cards, pills for the formula, rerolls, total and points spent, gold-bordered value chips and gold +/− buttons for point buy.
- The confirmation dialogs use the dnd5e style too.

## 1.4.0 (2026-11-12)
### Changed
- Renamed the module from `dnd5e-stat-generator` to `dnd5e-ability-score-generator`, titled "D&D 5e Ability Score Generator".
- Renamed the stylesheet to `styles/ability-score-generator.css`.
- The macro API is now `game.modules.get("dnd5e-ability-score-generator").api.open(actor)`.

### Upgrade notes
- Foundry treats this as a new module, so enable it again under **Manage Modules**.
- Settings and per-character data (rolls, applied lock) saved under the old id don't carry over.

## 1.3.2 (2026-11-12)
### Fixed
- Hovering a bonus now shows its sources. The bonus uses Foundry's own tooltip, because the browser tooltip didn't display in Foundry. The bonus number is dotted-underlined to show it can be hovered.

## 1.3.1 (2026-11-12)
### Changed
- Placed chips leave the pool and appear only in their ability slot. When every value is placed, the pool stays as a drop area so values can be dragged back.

## 1.3.0 (2026-11-12)
### Added
- Drag and drop for Roll and Standard Array. Values are chips you drag onto an ability's slot.
  - Dropping on a filled slot swaps the two values.
  - Dragging a placed chip back to the pool removes it.
  - Click a chip and then a slot as an alternative to dragging.

### Removed
- The per-ability dropdowns.

## 1.2.1 (2026-11-12)
### Changed
- The score table shows only the full ability name (e.g. "Strength") instead of the abbreviation plus the name.

## 1.2.0 (2026-11-12)
### Changed
- The GM **Reset** button now also resets the sheet. Every ability score goes back to 10 plus any background, feat or class ASI bonuses. Rolls, the reroll count and the applied lock are still cleared.

## 1.1.0 (2026-11-12)
### Fixed
- Applying scores no longer wipes out ability score increases from backgrounds, feats and class ASIs. dnd5e writes those increases into the base score, so the generator now adds them back on top, capped at the ability maximum.

### Added
- **Bonus** and **Final** columns in the score table.
- **Keep Background & Feat Bonuses** world setting (on by default).

## 1.0.0 (2026-11-12)
### Added
- A **Generate Stats** button in the header controls menu (⋮) of dnd5e character sheets. Shown only on characters you own.
- Three methods:
  - **Roll**, with a configurable formula (default `4d6kh3`) and dropped dice shown.
  - **Point Buy**, from 8 to 15 with a configurable budget (default 27).
  - **Standard Array**: 15, 14, 13, 12, 10, 8.
- World settings:
  - Turn each method on or off.
  - Roll formula and point buy budget.
  - Player rerolls (`-1` = unlimited).
  - Rolling commits players to their rolls.
  - Post to chat.
  - Players can use the generator.
  - Lock the generator after scores are applied.
- Rolls post to chat publicly (Dice So Nice compatible), and applied scores get a summary card.
- A GM **Reset** button.
- A macro API: `api.open(actor)`.
- Targets Foundry VTT v13–v14 and dnd5e 5.x–6.x.
