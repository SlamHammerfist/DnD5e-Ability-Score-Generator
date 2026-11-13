/**
 * D&D 5e Ability Score Generator
 * Adds a "Generate Stats" button to dnd5e character sheets: roll, point buy, or standard array.
 */

const MODULE_ID = "dnd5e-ability-score-generator";
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const PB_MIN = 8;
const PB_MAX = 15;
const ICON = "fas fa-dice-d20";

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const t = (key, data) => data
  ? game.i18n.format(`DND5ESG.${key}`, data)
  : game.i18n.localize(`DND5ESG.${key}`);
const setting = key => game.settings.get(MODULE_ID, key);
const esc = str => foundry.utils.escapeHTML(String(str ?? ""));
const modOf = v => Math.floor((v - 10) / 2);
const fmtMod = v => { const m = modOf(v); return m >= 0 ? `+${m}` : `${m}`; };
const blankAssign = () => Object.fromEntries(ABILITIES.map(k => [k, null]));
const basePoints = () => Object.fromEntries(ABILITIES.map(k => [k, PB_MIN]));

function abilityInfo(key) {
  const cfg = CONFIG.DND5E?.abilities?.[key] ?? {};
  return {
    label: game.i18n.localize(cfg.label ?? key),
    abbr: game.i18n.localize(cfg.abbreviation ?? key).toUpperCase()
  };
}

function pointsSpent(points) {
  return ABILITIES.reduce((sum, k) => sum + (POINT_COSTS[points[k]] ?? 0), 0);
}

/**
 * Ability score increases already written into the base scores by dnd5e's
 * Ability Score Improvement advancements (background, feats, class ASIs).
 * dnd5e adds these directly to system.abilities.*.value, so we have to add
 * them back on top of the generated scores or they'd be wiped out.
 * Active Effect bonuses don't need this: they're applied on top of the source value.
 */
function advancementBonuses(actor) {
  const bonus = Object.fromEntries(ABILITIES.map(k => [k, 0]));
  const sources = Object.fromEntries(ABILITIES.map(k => [k, []]));
  if (!setting("includeAdvancementBonuses")) return { bonus, sources };

  for (const item of actor.items) {
    const advancements = Object.values(item.advancement?.byId ?? {});
    for (const adv of advancements) {
      const type = adv.constructor?.typeName ?? adv.type;
      if (type !== "AbilityScoreImprovement") continue;
      const assignments = adv.value?.assignments;
      if (!assignments) continue;
      for (const [key, amount] of Object.entries(assignments)) {
        const n = Number(amount) || 0;
        if (!(key in bonus) || !n) continue;
        bonus[key] += n;
        sources[key].push(`${item.name} ${n > 0 ? "+" : ""}${n}`);
      }
    }
  }
  return { bonus, sources };
}

function abilityMax(actor, key) {
  return Number(actor.system.abilities?.[key]?.max) || 20;
}

async function confirmDialog(title, content) {
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.confirm({
    window: { title },
    content: `<p>${content}</p>`,
    modal: true,
    rejectClose: false
  });
  return result === true;
}

function canOpen(actor) {
  if (!actor || !(actor instanceof Actor)) return false;
  if (actor.type !== "character" || !actor.isOwner) return false;
  if (game.user.isGM) return true;
  if (!setting("playersCanUse")) return false;
  if (setting("lockAfterApply") && actor.getFlag(MODULE_ID, "applied")) return false;
  return true;
}

function openGenerator(actor) {
  if (!canOpen(actor)) return ui.notifications.warn(t("Notify.NotAllowed"));
  const existing = foundry.applications.instances?.get(`${MODULE_ID}-${actor.id}`);
  if (existing) return existing.render({ force: true });
  return new StatGenerator(actor).render({ force: true });
}

/* -------------------------------------------- */
/*  Application                                 */
/* -------------------------------------------- */

class StatGenerator extends foundry.applications.api.ApplicationV2 {
  constructor(actor, options = {}) {
    super({ id: `${MODULE_ID}-${actor.id}`, ...options });
    this.actor = actor;
    this.method = null;
    this.assign = blankAssign();
    this.points = basePoints();
    this.selected = null; // pool index picked for click-to-place
  }

  #busy = false;

  static DEFAULT_OPTIONS = {
    classes: ["dnd5e-stat-gen"],
    tag: "div",
    window: { icon: ICON, resizable: false },
    position: { width: 580, height: "auto" },
    actions: {
      method: StatGenerator.#onMethod,
      roll: StatGenerator.#onRoll,
      inc: StatGenerator.#onIncrement,
      dec: StatGenerator.#onDecrement,
      inOrder: StatGenerator.#onInOrder,
      clear: StatGenerator.#onClear,
      apply: StatGenerator.#onApply,
      reset: StatGenerator.#onReset
    }
  };

  get title() {
    return t("Title", { name: this.actor.name });
  }

  /* ---------- State ---------- */

  get rollState() {
    return this.actor.getFlag(MODULE_ID, "rolls") ?? null;
  }

  /** Players who have rolled are locked to their rolls (if the setting is on). */
  get isCommitted() {
    return !game.user.isGM && setting("allowRoll") && setting("rollCommits") && !!this.rollState;
  }

  get allowedMethods() {
    if (this.isCommitted) return ["roll"];
    const methods = [];
    if (setting("allowRoll")) methods.push("roll");
    if (setting("allowPointBuy")) methods.push("point");
    if (setting("allowArray")) methods.push("array");
    return methods;
  }

  /** Number of full-set rolls the current user can still make. */
  get rollsRemaining() {
    if (game.user.isGM) return Infinity;
    const rerolls = Number(setting("playerRerolls"));
    if (rerolls < 0) return Infinity;
    return Math.max(0, 1 + rerolls - (this.rollState?.count ?? 0));
  }

  get pool() {
    if (this.method === "roll") return (this.rollState?.values ?? []).map(v => v.total);
    if (this.method === "array") return [...STANDARD_ARRAY];
    return [];
  }

  /** The final scores the current method would apply (null where unassigned). */
  get finalValues() {
    if (this.method === "point") return { ...this.points };
    const pool = this.pool;
    return Object.fromEntries(ABILITIES.map(k => {
      const idx = this.assign[k];
      return [k, (idx === null || pool[idx] === undefined) ? null : pool[idx]];
    }));
  }

  /* ---------- Rendering ---------- */

  async _renderHTML() {
    const allowed = this.allowedMethods;
    if (!allowed.includes(this.method)) {
      this.method = allowed[0] ?? null;
      this.assign = blankAssign();
    }
    if (!this.method) return `<p class="sg-empty">${esc(t("NoMethods"))}</p>`;

    const tabs = ["roll", "point", "array"].map(m => {
      const enabled = allowed.includes(m);
      const active = m === this.method ? "active" : "";
      return `<button type="button" class="sg-tab ${active}" data-action="method" data-method="${m}" ${enabled ? "" : "disabled"}>${esc(t(`Method.${m}`))}</button>`;
    }).join("");

    let intro = "";
    if (this.method === "roll") intro = this.#renderRollIntro();
    else if (this.method === "point") intro = this.#renderPointIntro();
    else intro = `<p class="sg-hint">${esc(t("ArrayHint"))}</p>${this.#renderChips(this.pool)}`;

    const values = this.finalValues;
    const bonuses = advancementBonuses(this.actor);
    const complete = ABILITIES.every(k => values[k] !== null);
    const overBudget = this.method === "point" && pointsSpent(this.points) > Number(setting("pointBuyBudget"));
    const canApply = complete && !overBudget;

    const reset = game.user.isGM
      ? `<button type="button" class="sg-reset" data-action="reset"><i class="fas fa-rotate-left"></i> ${esc(t("Reset"))}</button>`
      : "";

    return `
      <nav class="sg-tabs">${tabs}</nav>
      ${this.isCommitted ? `<p class="sg-notice"><i class="fas fa-lock"></i> ${esc(t("Committed"))}</p>` : ""}
      <section class="sg-intro">${intro}</section>
      ${this.#renderTable(values, bonuses)}
      <footer class="sg-footer">
        ${reset}
        <button type="button" class="sg-apply" data-action="apply" ${canApply ? "" : "disabled"}>
          <i class="fas fa-check"></i> ${esc(t("Apply"))}
        </button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.method && this.method !== "point") this.#bindDragDrop();
  }

  /** Drag chips onto ability slots (or back to the pool). Click a chip, then a slot, works too. */
  #bindDragDrop() {
    const root = this.element;

    root.querySelectorAll(".sg-chip[data-index]").forEach(chip => {
      const index = Number(chip.dataset.index);
      chip.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ sgChip: true, index }));
        ev.dataTransfer.effectAllowed = "move";
        chip.classList.add("dragging");
        root.classList.add("sg-dragging");
      });
      chip.addEventListener("dragend", () => {
        chip.classList.remove("dragging");
        root.classList.remove("sg-dragging");
        root.querySelectorAll(".over").forEach(el => el.classList.remove("over"));
      });
      chip.addEventListener("click", ev => {
        ev.stopPropagation();
        // A chip is already picked and this is a placed chip in a different slot: drop it here.
        if (this.selected !== null && chip.dataset.from && this.selected !== index) {
          return this.#placeChip(this.selected, chip.dataset.from);
        }
        this.selected = this.selected === index ? null : index;
        this.render();
      });
    });

    root.querySelectorAll("[data-drop]").forEach(zone => {
      const target = zone.dataset.drop === "slot" ? zone.dataset.ability : null;
      zone.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        zone.classList.add("over");
      });
      zone.addEventListener("dragleave", ev => {
        if (!zone.contains(ev.relatedTarget)) zone.classList.remove("over");
      });
      zone.addEventListener("drop", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        let data;
        try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.sgChip || !Number.isInteger(data.index)) return;
        this.#placeChip(data.index, target);
      });
      zone.addEventListener("click", () => {
        if (this.selected === null) return;
        this.#placeChip(this.selected, target);
      });
    });
  }

  /**
   * Put pool value `index` on ability `key` (null = back to the pool).
   * If another ability held that value, it takes whatever `key` had before (a swap).
   */
  #placeChip(index, key) {
    if (key === null) {
      for (const k of ABILITIES) if (this.assign[k] === index) this.assign[k] = null;
    } else {
      const previous = this.assign[key];
      const holder = ABILITIES.find(k => k !== key && this.assign[k] === index);
      if (holder) this.assign[holder] = previous;
      this.assign[key] = index;
    }
    this.selected = null;
    this.render();
  }

  #renderRollIntro() {
    const state = this.rollState;
    const formula = state?.formula ?? setting("rollFormula");
    const remaining = this.rollsRemaining;
    const canRoll = remaining > 0 && !this.#busy;

    let rerollText;
    if (!state) rerollText = "";
    else if (remaining === Infinity) rerollText = t("RerollsUnlimited");
    else if (remaining > 0) rerollText = t("RerollsRemaining", { n: remaining });
    else rerollText = t("NoRerollsLeft");

    const label = state ? t("RerollButton") : t("RollButton");
    const controls = `
      <div class="sg-roll-controls">
        <button type="button" data-action="roll" ${canRoll ? "" : "disabled"}><i class="fas fa-dice"></i> ${esc(label)}</button>
        <span class="sg-meta">${esc(t("Formula", { formula }))}</span>
        ${rerollText ? `<span class="sg-meta">${esc(rerollText)}</span>` : ""}
      </div>`;

    if (!state) return `${controls}<p class="sg-hint">${esc(t("NoRollsYet"))}</p>`;

    const total = state.values.reduce((s, v) => s + v.total, 0);
    return `${controls}
      <p class="sg-hint">${esc(t("AssignHint"))}</p>
      ${this.#renderChips(state.values.map(v => v.total), state.values)}
      <div class="sg-row-actions">
        <span class="sg-meta">${esc(t("Total", { total }))}</span>
        <button type="button" data-action="inOrder">${esc(t("InOrder"))}</button>
        <button type="button" data-action="clear">${esc(t("Clear"))}</button>
      </div>`;
  }

  #renderPointIntro() {
    const budget = Number(setting("pointBuyBudget"));
    const spent = pointsSpent(this.points);
    const cls = spent > budget ? "over" : (spent === budget ? "done" : "");
    return `
      <div class="sg-points ${cls}">${esc(t("PointsSpent", { spent, budget }))}</div>
      <p class="sg-hint">${esc(t("PointsHint"))}</p>
      <div class="sg-row-actions"><button type="button" data-action="clear">${esc(t("Clear"))}</button></div>`;
  }

  /** Unplaced pool values as draggable chips. Placed ones leave the pool and live in their slot. */
  #renderChips(pool, details = null) {
    const used = new Set(Object.values(this.assign).filter(i => i !== null));
    const chips = pool.map((value, i) => {
      if (used.has(i)) return "";
      const dice = details?.[i]?.dice?.length
        ? `<span class="sg-dice">${details[i].dice.map(d => `<span class="sg-die ${d.x ? "dropped" : ""}">${d.r}</span>`).join("")}</span>`
        : "";
      return `<div class="sg-chip ${this.selected === i ? "selected" : ""}" draggable="true" data-index="${i}"><span class="sg-chip-value">${value}</span>${dice}</div>`;
    }).join("");
    const empty = chips ? "" : `<span class="sg-pool-empty">${esc(t("PoolEmpty"))}</span>`;
    return `<div class="sg-chips ${chips ? "" : "empty"}" data-drop="pool">${chips}${empty}</div>`;
  }

  #renderTable(values, { bonus, sources }) {
    const isPoint = this.method === "point";
    const pool = this.pool;
    const budget = Number(setting("pointBuyBudget"));
    const remaining = budget - pointsSpent(this.points);

    const rows = ABILITIES.map(key => {
      const { label } = abilityInfo(key);
      const current = this.actor.system.abilities?.[key]?.value ?? "—";
      const value = values[key];
      let input;

      if (isPoint) {
        const v = this.points[key];
        const step = v < PB_MAX ? POINT_COSTS[v + 1] - POINT_COSTS[v] : Infinity;
        input = `
          <div class="sg-stepper">
            <button type="button" data-action="dec" data-ability="${key}" ${v <= PB_MIN ? "disabled" : ""}><i class="fas fa-minus"></i></button>
            <span class="sg-value">${v}</span>
            <button type="button" data-action="inc" data-ability="${key}" ${step > remaining ? "disabled" : ""}><i class="fas fa-plus"></i></button>
          </div>`;
      } else {
        const idx = this.assign[key];
        const filled = idx !== null && pool[idx] !== undefined;
        const inner = filled
          ? `<div class="sg-chip placed ${this.selected === idx ? "selected" : ""}" draggable="true" data-index="${idx}" data-from="${key}"><span class="sg-chip-value">${pool[idx]}</span></div>`
          : `<span class="sg-slot-empty">${esc(t("DropHere"))}</span>`;
        input = `<div class="sg-slot ${filled ? "" : "empty"}" data-drop="slot" data-ability="${key}">${inner}</div>`;
      }

      const costCell = isPoint ? `<td class="sg-cost">${POINT_COSTS[this.points[key]]}</td>` : "";
      const b = bonus[key];
      const bonusCell = b
        ? `<td class="sg-bonus"><span class="sg-bonus-value" data-tooltip="${esc(sources[key].join(", "))}" data-tooltip-direction="UP">${b > 0 ? "+" : ""}${b}</span></td>`
        : `<td class="sg-bonus none">—</td>`;
      const final = value === null ? null : Math.min(value + b, abilityMax(this.actor, key));
      const finalCell = final === null
        ? `<td class="sg-final">—</td>`
        : `<td class="sg-final"><strong>${final}</strong> <span class="sg-mod">(${fmtMod(final)})</span></td>`;
      return `
        <tr>
          <th scope="row" class="sg-label">${esc(label)}</th>
          <td class="sg-current">${esc(current)}</td>
          <td class="sg-input">${input}</td>
          ${costCell}
          ${bonusCell}
          ${finalCell}
        </tr>`;
    }).join("");

    return `
      <table class="sg-table">
        <thead><tr>
          <th>${esc(t("Ability"))}</th>
          <th>${esc(t("Current"))}</th>
          <th>${esc(t("New"))}</th>
          ${isPoint ? `<th>${esc(t("Cost"))}</th>` : ""}
          <th>${esc(t("Bonus"))}</th>
          <th>${esc(t("Final"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${ABILITIES.some(k => bonus[k]) ? `<p class="sg-hint">${esc(t("BonusHint"))}</p>` : ""}`;
  }

  /* ---------- Handlers ---------- */

  static #onMethod(event, target) {
    const method = target.dataset.method;
    if (method === this.method || !this.allowedMethods.includes(method)) return;
    this.method = method;
    this.assign = blankAssign();
    this.selected = null;
    this.render();
  }

  static async #onRoll() {
    if (this.#busy) return;
    if (this.rollsRemaining <= 0) return ui.notifications.warn(t("Notify.NoRerolls"));

    const formula = String(setting("rollFormula") || "4d6kh3").trim();
    if (!Roll.validate(formula)) return ui.notifications.error(t("Notify.BadFormula", { formula }));

    const previous = this.rollState;
    if (previous && !(await confirmDialog(t("Confirm.RerollTitle"), esc(t("Confirm.RerollContent"))))) return;

    this.#busy = true;
    this.render();
    try {
      const rolls = [];
      for (let i = 0; i < ABILITIES.length; i++) rolls.push(await new Roll(formula).evaluate());

      const values = rolls.map(r => ({
        total: r.total,
        dice: r.dice.flatMap(d => d.results.map(res => ({
          r: res.result,
          x: res.active === false || res.discarded === true || res.rerolled === true
        })))
      }));

      await this.actor.setFlag(MODULE_ID, "rolls", {
        values,
        formula,
        count: (previous?.count ?? 0) + 1
      });
      this.assign = blankAssign();
      this.selected = null;

      if (setting("postToChat")) await postRollMessage(this.actor, rolls, values, formula);
    } catch (err) {
      console.error(`${MODULE_ID} | Roll failed`, err);
      ui.notifications.error(err.message);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  static #onIncrement(event, target) {
    const key = target.dataset.ability;
    const v = this.points[key];
    if (v >= PB_MAX) return;
    const remaining = Number(setting("pointBuyBudget")) - pointsSpent(this.points);
    if (POINT_COSTS[v + 1] - POINT_COSTS[v] > remaining) return;
    this.points[key] = v + 1;
    this.render();
  }

  static #onDecrement(event, target) {
    const key = target.dataset.ability;
    if (this.points[key] <= PB_MIN) return;
    this.points[key] -= 1;
    this.render();
  }

  static #onInOrder() {
    const pool = this.pool;
    ABILITIES.forEach((k, i) => { this.assign[k] = i < pool.length ? i : null; });
    this.selected = null;
    this.render();
  }

  static #onClear() {
    if (this.method === "point") this.points = basePoints();
    else this.assign = blankAssign();
    this.selected = null;
    this.render();
  }

  static async #onApply() {
    const values = this.finalValues;
    if (ABILITIES.some(k => values[k] === null)) return ui.notifications.warn(t("Notify.Incomplete"));

    if (this.method === "point") {
      const left = Number(setting("pointBuyBudget")) - pointsSpent(this.points);
      if (left < 0) return ui.notifications.warn(t("Notify.OverBudget"));
      if (left > 0 && !(await confirmDialog(t("Confirm.ApplyTitle"), esc(t("Confirm.UnspentContent", { left }))))) return;
    }

    if (!(await confirmDialog(t("Confirm.ApplyTitle"), esc(t("Confirm.ApplyContent", { name: this.actor.name }))))) return;

    // Re-read bonuses at apply time in case items changed while the window was open.
    const { bonus } = advancementBonuses(this.actor);
    const finals = Object.fromEntries(ABILITIES.map(k =>
      [k, Math.min(values[k] + bonus[k], abilityMax(this.actor, k))]
    ));

    const update = {};
    for (const k of ABILITIES) update[`system.abilities.${k}.value`] = finals[k];
    update[`flags.${MODULE_ID}.applied`] = {
      method: this.method,
      base: values,
      bonus,
      values: finals,
      user: game.user.id,
      time: Date.now()
    };
    await this.actor.update(update);

    if (setting("postToChat")) await postApplyMessage(this.actor, this.method, finals);
    ui.notifications.info(t("Notify.Applied", { name: this.actor.name }));
    this.close();
  }

  static async #onReset() {
    if (!game.user.isGM) return;
    if (!(await confirmDialog(t("Confirm.ResetTitle"), esc(t("Confirm.ResetContent", { name: this.actor.name }))))) return;
    // Every ability goes back to 10, keeping only what ASI advancements (background, feats, class) contribute.
    const { bonus } = advancementBonuses(this.actor);
    const update = {};
    for (const k of ABILITIES) {
      update[`system.abilities.${k}.value`] = Math.min(10 + bonus[k], abilityMax(this.actor, k));
    }
    await this.actor.update(update);
    await this.actor.unsetFlag(MODULE_ID, "rolls");
    await this.actor.unsetFlag(MODULE_ID, "applied");
    this.assign = blankAssign();
    this.points = basePoints();
    ui.notifications.info(t("Notify.Reset", { name: this.actor.name }));
    this.render();
  }
}

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

async function postRollMessage(actor, rolls, values, formula) {
  const items = values.map(v => {
    const dice = v.dice.map(d => `<span class="sg-die ${d.x ? "dropped" : ""}">${d.r}</span>`).join("");
    return `<li><strong>${v.total}</strong> <span class="sg-dice">${dice}</span></li>`;
  }).join("");
  const total = values.reduce((s, v) => s + v.total, 0);
  const content = `
    <div class="dnd5e-stat-gen-chat">
      <p class="sg-chat-title">${esc(t("Chat.Rolled", { name: actor.name }))}</p>
      <p class="sg-meta">${esc(t("Formula", { formula }))}</p>
      <ul class="sg-chat-list">${items}</ul>
      <p class="sg-meta">${esc(t("Total", { total }))}</p>
    </div>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls,
    sound: CONFIG.sounds.dice
  });
}

async function postApplyMessage(actor, method, values) {
  const items = ABILITIES.map(k => {
    const { abbr } = abilityInfo(k);
    return `<li><span class="sg-abbr">${esc(abbr)}</span> <strong>${values[k]}</strong> <span class="sg-meta">(${fmtMod(values[k])})</span></li>`;
  }).join("");
  const content = `
    <div class="dnd5e-stat-gen-chat">
      <p class="sg-chat-title">${esc(t("Chat.Applied", { name: actor.name, method: t(`Method.${method}`) }))}</p>
      <ul class="sg-chat-grid">${items}</ul>
    </div>`;
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const register = (key, type, defaultValue, extra = {}) => game.settings.register(MODULE_ID, key, {
    name: `DND5ESG.Settings.${key}.Name`,
    hint: `DND5ESG.Settings.${key}.Hint`,
    scope: "world",
    config: true,
    type,
    default: defaultValue,
    ...extra
  });

  register("allowRoll", Boolean, true);
  register("allowPointBuy", Boolean, true);
  register("allowArray", Boolean, true);
  register("rollFormula", String, "4d6kh3");
  register("pointBuyBudget", Number, 27);
  register("playerRerolls", Number, 0);
  register("rollCommits", Boolean, true);
  register("includeAdvancementBonuses", Boolean, true);
  register("postToChat", Boolean, true);
  register("playersCanUse", Boolean, true);
  register("lockAfterApply", Boolean, true);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { open: openGenerator, StatGenerator };
});

// ApplicationV2 actor sheets (dnd5e 5.x / 6.x on Foundry v13 / v14).
// The button lands in the sheet's header controls (the ⋮ menu).
Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  const actor = app.document ?? app.actor;
  if (!canOpen(actor)) return;
  const action = "dnd5eStatGenerator";
  if (app.options?.actions && !app.options.actions[action]) {
    app.options.actions[action] = () => openGenerator(app.document ?? app.actor);
  }
  if (controls.some(c => c.action === action)) return;
  controls.unshift({
    action,
    icon: ICON,
    label: "DND5ESG.Button",
    onClick: () => openGenerator(actor)
  });
});

// Keep an open generator in sync if the actor changes elsewhere (e.g. GM reset from another client).
Hooks.on("updateActor", actor => {
  const app = foundry.applications.instances?.get(`${MODULE_ID}-${actor.id}`);
  if (app?.rendered) app.render();
});
