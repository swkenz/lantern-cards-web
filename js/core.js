// Lantern Cards - save data, gacha, run and battle rules (port of LcCore.cs).
// Pure ES module: no DOM, no three.js, no Node APIs.

import { Db, CardDef, HeroineDef, Element, Rarity, Motion, MoveKind, NodeKind, CompanionSkill, f32, roundToInt } from './data.js';

// ---------- RNG (stands in for System.Random) ----------

/** Seedable mulberry32 generator with System.Random-style overloads. */
export class Rng {
  constructor(seed) {
    if (seed === undefined || seed === null) seed = Math.floor(Math.random() * 4294967296);
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Raw 32-bit unsigned output. */
  nextUint32() {
    let t = (this.state = (this.state + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Double in [0, 1). */
  nextDouble() {
    return this.nextUint32() / 4294967296;
  }

  /**
   * next()          -> int in [0, 2147483647)
   * next(max)       -> int in [0, max)
   * next(min, max)  -> int in [min, max)
   */
  next(a, b) {
    if (a === undefined) return Math.floor(this.nextDouble() * 2147483647);
    if (b === undefined) {
      const max = Math.trunc(a);
      if (max < 0) throw new RangeError('maxValue must be non-negative');
      return Math.floor(this.nextDouble() * max);
    }
    const min = Math.trunc(a);
    const max = Math.trunc(b);
    if (min > max) throw new RangeError('minValue must not exceed maxValue');
    return min + Math.floor(this.nextDouble() * (max - min));
  }
}

/** LINQ OrderBy(_ => rng.Next()): one key per element, then a stable sort. */
function shuffled(list, rng) {
  return list.map(item => ({ item, key: rng.next() })).sort((x, y) => x.key - y.key).map(e => e.item);
}

/** LINQ OrderBy(selector) (stable). */
function orderBy(list, selector) {
  return list.map((item, i) => ({ item, key: selector(item), i }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.i - y.i))
    .map(e => e.item);
}

function removeFirst(list, value) {
  const i = list.indexOf(value);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

function int(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

// ---------- Save data ----------

export class Owned {
  constructor(id = null) {
    this.id = id;
    this.level = 1;
    this.copies = 0;
  }

  static from(obj) {
    const owned = new Owned(obj && obj.id != null ? String(obj.id) : null);
    if (obj) {
      owned.level = int(obj.level, 1);
      owned.copies = int(obj.copies, 0);
    }
    return owned;
  }
}

export class SaveData {
  constructor() {
    this.crystals = 1500;
    this.cards = [];
    this.companions = [];
    this.heroines = [];
    this.team = [];
    this.activeCompanion = '';
    this.talismans = new Array(5).fill(0);
    this.pity = 0;
    this.runs = 0;
    this.wins = 0;
    this.bestFloor = 0;
    this.totalPulls = 0;
    this.seeded = false;
  }

  /** Revives parsed JSON into a SaveData (missing fields keep their defaults, like JsonUtility). */
  static fromJSON(obj) {
    const data = new SaveData();
    if (!obj || typeof obj !== 'object') return data;
    data.crystals = int(obj.crystals, data.crystals);
    if (Array.isArray(obj.cards)) data.cards = obj.cards.filter(o => o && typeof o === 'object').map(Owned.from);
    if (Array.isArray(obj.companions)) data.companions = obj.companions.filter(o => o && typeof o === 'object').map(Owned.from);
    if (Array.isArray(obj.heroines)) data.heroines = obj.heroines.filter(o => o && typeof o === 'object').map(Owned.from);
    else if (obj.heroines === null) data.heroines = null;
    if (Array.isArray(obj.team)) data.team = obj.team.filter(id => typeof id === 'string');
    else if (obj.team === null) data.team = null;
    if (typeof obj.activeCompanion === 'string') data.activeCompanion = obj.activeCompanion;
    if (Array.isArray(obj.talismans)) data.talismans = obj.talismans.map(v => int(v, 0));
    else if (obj.talismans === null) data.talismans = null;
    data.pity = int(obj.pity, 0);
    data.runs = int(obj.runs, 0);
    data.wins = int(obj.wins, 0);
    data.bestFloor = int(obj.bestFloor, 0);
    data.totalPulls = int(obj.totalPulls, 0);
    data.seeded = obj.seeded === true;
    return data;
  }

  card(id) { return this.cards.find(c => c.id === id) ?? null; }
  companion(id) { return this.companions.find(c => c.id === id) ?? null; }
  heroine(id) { return this.heroines.find(h => h.id === id) ?? null; }

  addHeroine(id) {
    const owned = this.heroine(id);
    if (owned != null) {
      owned.copies++;
      return false;
    }
    this.heroines.push(new Owned(id));
    if (this.team.length < Db.teamSize) this.team.push(id);
    return true;
  }

  /** Adds a heroine to the team, or takes her out if she is already in it. */
  toggleTeam(id) {
    if (this.heroine(id) == null) return false;
    if (removeFirst(this.team, id)) return true;
    if (this.team.length >= Db.teamSize) return false;
    this.team.push(id);
    return true;
  }

  cardLevel(id) { return this.card(id)?.level ?? 1; }
  talisman(index) { return index < this.talismans.length ? this.talismans[index] : 0; }

  addCard(id) {
    const owned = this.card(id);
    if (owned != null) {
      owned.copies++;
      return false;
    }
    this.cards.push(new Owned(id));
    return true;
  }

  addCompanion(id) {
    const owned = this.companion(id);
    if (owned != null) {
      owned.copies++;
      return false;
    }
    this.companions.push(new Owned(id));
    if (!this.activeCompanion) this.activeCompanion = id;
    return true;
  }

  static upgradeCrystals(level) { return 60 * level; }

  /** Level L to L+1 needs L duplicate copies and some crystals. */
  canUpgrade(owned) {
    return owned != null && owned.level < Db.maxLevel && owned.copies >= owned.level && this.crystals >= SaveData.upgradeCrystals(owned.level);
  }

  upgrade(owned) {
    if (!this.canUpgrade(owned)) return false;
    this.crystals -= SaveData.upgradeCrystals(owned.level);
    owned.copies -= owned.level;
    owned.level++;
    return true;
  }

  buyTalisman(index) {
    const def = Db.talismans[index];
    if (!def) return false;
    const level = this.talisman(index);
    if (level >= def.maxLevel || this.crystals < def.costAt(level)) return false;
    this.crystals -= def.costAt(level);
    this.talismans[index] = level + 1;
    return true;
  }
}

const memoryStore = new Map();

function storage() {
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  } catch {
    // localStorage can throw when site data is blocked; fall back to memory.
  }
  return null;
}

export const SaveSystem = {
  defaultKey: 'lanterncards.save.v1',
  /** Test hook (C# OverridePath): when set, replaces the storage key. */
  overrideKey: null,

  get key() { return SaveSystem.overrideKey ?? SaveSystem.defaultKey; },

  read() {
    const ls = storage();
    if (ls) {
      try { return ls.getItem(SaveSystem.key); } catch { /* fall through */ }
    }
    return memoryStore.has(SaveSystem.key) ? memoryStore.get(SaveSystem.key) : null;
  },

  write(text) {
    const ls = storage();
    if (ls) {
      try { ls.setItem(SaveSystem.key, text); return; } catch (e) {
        console.warn('[LanternCards] Save could not be written: ' + (e && e.message));
      }
    }
    memoryStore.set(SaveSystem.key, text);
  },

  /** Deletes the save under the current key (the probe deletes its test file before starting). */
  clear() {
    const ls = storage();
    if (ls) {
      try { ls.removeItem(SaveSystem.key); } catch { /* ignore */ }
    }
    memoryStore.delete(SaveSystem.key);
  },

  load() {
    let data = null;
    try {
      const text = SaveSystem.read();
      if (text != null) data = SaveData.fromJSON(JSON.parse(text));
    } catch (e) {
      console.warn('[LanternCards] Save could not be read, starting fresh: ' + (e && e.message));
    }
    data ??= new SaveData();
    data.cards ??= [];
    data.companions ??= [];
    data.heroines ??= [];
    data.team ??= [];
    if (data.talismans == null || data.talismans.length < Db.talismans.length) {
      const talismans = new Array(Db.talismans.length).fill(0);
      if (data.talismans != null) data.talismans.forEach((v, i) => { talismans[i] = v; });
      data.talismans = talismans;
    }
    if (!data.seeded) {
      for (const id of Db.starterUnlocked) data.addCard(id);
      data.addCompanion('toki');
      data.seeded = true;
    }
    return data;
  },

  save(data) {
    SaveSystem.write(JSON.stringify(data));
  },
};

// ---------- Gacha ----------

export class PullResult {
  constructor() {
    this.isCompanion = false;
    this.isHeroine = false;
    this.id = null;
    this.rarity = Rarity.N;
    this.isNew = false;
  }

  get name() {
    return this.isHeroine ? Db.heroine(this.id).name : this.isCompanion ? Db.companion(this.id).name : Db.card(this.id).name;
  }
}

export const Gacha = {
  pull(save, count, rng) {
    const results = [];
    let highSeen = false;
    for (let i = 0; i < count; i++) {
      save.pity++;
      save.totalPulls++;
      let rarity;
      const roll = rng.nextDouble();
      if (save.pity >= Db.ssrPity) rarity = Rarity.SSR;
      else if (roll < 0.03) rarity = Rarity.SSR;
      else if (roll < 0.17) rarity = Rarity.SR;
      else if (roll < 0.52) rarity = Rarity.R;
      else rarity = Rarity.N;
      // A ten-pull always contains at least one SR or better.
      if (count >= 10 && i === count - 1 && !highSeen && rarity < Rarity.SR) rarity = Rarity.SR;
      if (rarity >= Rarity.SR) highSeen = true;
      if (rarity === Rarity.SSR) save.pity = 0;

      const companions = Db.companions.filter(c => c.rarity === rarity);
      const heroines = Db.heroines.filter(h => h.rarity === rarity && HeroineDef.hasArt(h.id));
      const result = new PullResult();
      result.rarity = rarity;
      if (heroines.length > 0 && rng.nextDouble() < 0.3) {
        result.isHeroine = true;
        result.id = heroines[rng.next(heroines.length)].id;
        result.isNew = save.addHeroine(result.id);
      } else if (companions.length > 0 && rng.nextDouble() < 0.22) {
        result.isCompanion = true;
        result.id = companions[rng.next(companions.length)].id;
        result.isNew = save.addCompanion(result.id);
      } else {
        const cards = Db.cards.filter(c => c.rarity === rarity && c.heroineId == null && c.id !== 'slash' && c.id !== 'guard');
        result.id = cards[rng.next(cards.length)].id;
        result.isNew = save.addCard(result.id);
      }
      results.push(result);
    }
    return results;
  },
};

// ---------- Run ----------

export class RunCard {
  constructor(def = null, level = 1, bonus = 0) {
    this.def = def;
    this.level = level;
    this.bonus = bonus;
  }

  get effective() { return Math.min(this.level + this.bonus, Db.maxLevel + 2); }
}

export class MapNode {
  constructor(props = {}) {
    this.row = 0;
    this.index = 0;
    this.kind = NodeKind.Battle;
    this.x = 0;
    this.done = false;
    this.next = [];
    Object.assign(this, props);
  }
}

const F012 = f32(0.12);
const F076 = f32(0.76);
const F008 = f32(0.08);
const F015 = f32(0.15);
const F007 = f32(0.07);
const F075 = f32(0.75);

export class RunState {
  static rows = 7;

  constructor({ save = null, rng = null } = {}) {
    this.deck = [];
    this.hp = 0;
    this.maxHp = 0;
    this.gold = 0;
    this.act = 0;
    this.floor = 0;
    this.crystalsEarned = 0;
    this.battles = 0;
    this.map = [];
    this.current = null;
    this.over = false;
    this.victory = false;
    this.save = save;
    this.rng = rng;
  }

  static begin(save, rng) {
    const run = new RunState({ save, rng });
    run.maxHp = 60 + 8 * save.talisman(0);
    run.hp = run.maxHp;
    run.gold = 40 + 30 * save.talisman(1);
    for (const id of Db.starterDeck) run.addCard(id);
    // Every heroine in the team brings two copies of her signature card and extra health.
    for (const id of save.team) {
      const heroine = Db.heroine(id);
      const owned = save.heroine(id);
      if (heroine == null || owned == null) continue;
      run.maxHp += heroine.hpAt(owned.level);
      run.addCard(heroine.cardId);
      run.addCard(heroine.cardId);
    }
    run.hp = run.maxHp;
    run.buildMap();
    return run;
  }

  addCard(id) {
    const def = Db.card(id);
    const level = def.heroineId != null ? this.save.heroine(def.heroineId)?.level ?? 1 : this.save.cardLevel(id);
    const card = new RunCard(def, level);
    this.deck.push(card);
    return card;
  }

  get actDef() { return Db.acts[this.act]; }

  buildMap() {
    const Rows = RunState.rows;
    const rng = this.rng;
    this.map.length = 0;
    this.current = null;
    const rows = [];
    for (let r = 0; r < Rows; r++) {
      const count = r === 0 ? 3 : r === Rows - 1 ? 1 : 2 + rng.next(3);
      const row = [];
      for (let i = 0; i < count; i++) {
        const x = count === 1 ? 0.5
          : f32(f32(F012 + f32(f32(F076 * i) / (count - 1))) + f32(f32(rng.nextDouble() - 0.5) * F008));
        const node = new MapNode({ row: r, index: i, x, kind: this.pickKind(r) });
        row.push(node);
        this.map.push(node);
      }
      rows.push(row);
    }

    // Every act has at least one elite and one shop on the way.
    const middle = this.map.filter(n => n.row >= 2 && n.row <= 4);
    if (!this.map.some(n => n.kind === NodeKind.Elite)) middle[rng.next(middle.length)].kind = NodeKind.Elite;
    const shopRows = this.map.filter(n => n.row >= 1 && n.row <= 4 && n.kind !== NodeKind.Elite);
    if (!this.map.some(n => n.kind === NodeKind.Shop) && shopRows.length > 0) shopRows[rng.next(shopRows.length)].kind = NodeKind.Shop;

    for (let r = 0; r < Rows - 1; r++) {
      const next = rows[r + 1];
      for (const node of rows[r]) {
        const sorted = orderBy(next, n => Math.abs(f32(n.x - node.x)));
        node.next.push(sorted[0]);
        if (sorted.length > 1 && rng.nextDouble() < 0.45) node.next.push(sorted[1]);
      }
      for (const target of next) {
        if (rows[r].some(n => n.next.includes(target))) continue;
        orderBy(rows[r], n => Math.abs(f32(n.x - target.x)))[0].next.push(target);
      }
    }
  }

  pickKind(row) {
    if (row === 0) return NodeKind.Battle;
    if (row === RunState.rows - 1) return NodeKind.Boss;
    const roll = this.rng.nextDouble();
    switch (row) {
      case 1:
      case 2:
        return roll < 0.6 ? NodeKind.Battle : roll < 0.75 ? NodeKind.Treasure : roll < 0.88 ? NodeKind.Shop : NodeKind.Rest;
      case 3:
      case 4:
        return roll < 0.4 ? NodeKind.Battle : roll < 0.62 ? NodeKind.Elite : roll < 0.76 ? NodeKind.Shop : roll < 0.88 ? NodeKind.Treasure : NodeKind.Rest;
      default:
        return roll < 0.55 ? NodeKind.Rest : roll < 0.8 ? NodeKind.Shop : NodeKind.Battle;
    }
  }

  choices() {
    return this.current == null ? this.map.filter(n => n.row === 0) : this.current.next;
  }

  crystalReward(amount) {
    const total = roundToInt(f32(amount * f32(1 + f32(F015 * this.save.talisman(3)))));
    this.crystalsEarned += total;
    this.save.crystals += total;
    return total;
  }

  rewardChoices(count, rich) {
    const pool = this.save.cards.map(o => Db.card(o.id))
      .filter(c => c != null && c.heroineId == null && c.id !== 'slash' && c.id !== 'guard');
    const picks = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const roll = this.rng.nextDouble() + (rich ? 0.25 : 0.0);
      const wanted = roll > 1.12 ? Rarity.SSR : roll > 0.9 ? Rarity.SR : roll > 0.55 ? Rarity.R : Rarity.N;
      let candidates = pool.filter(c => c.rarity === wanted && !picks.includes(c));
      if (candidates.length === 0) candidates = pool.filter(c => !picks.includes(c));
      if (candidates.length === 0) break;
      picks.push(candidates[this.rng.next(candidates.length)]);
    }
    return picks;
  }

  static price(card) {
    return card.rarity === Rarity.SSR ? 200 : card.rarity === Rarity.SR ? 120 : card.rarity === Rarity.R ? 75 : 45;
  }

  pickEnemy(kind) {
    const act = this.actDef;
    if (kind === NodeKind.Boss) return Db.enemy(act.boss);
    if (kind === NodeKind.Elite) return Db.enemy(act.elite[this.rng.next(act.elite.length)]);
    return Db.enemy(act.normal[this.rng.next(act.normal.length)]);
  }
}

// ---------- Battle ----------

export const Ev = Object.freeze({
  HeroMotion: 0, EnemyHit: 1, HeroHit: 2, HeroBlock: 3, HeroHeal: 4, EnemyMotion: 5, EnemyBlock: 6, EnemyBuff: 7,
  EnemyStatus: 8, HeroStatus: 9, CompanionAct: 10, Burn: 11, Draw: 12, Message: 13, EnemyDefeated: 14, HeroDefeated: 15,
});

/** BattleEvent is a C# struct: every field not set is zero/null (mult defaults to 0, only E() sets it to 1). */
export function battleEvent(props = {}) {
  return {
    kind: Ev.HeroMotion,
    amount: 0,
    element: Element.None,
    mult: 0,
    text: null,
    motion: Motion.Slash,
    heroineId: null,
    ...props,
  };
}

/** BattleState.E(kind, amount, text): the helper that sets mult to 1. */
function E(kind, amount = 0, text = null) {
  return battleEvent({ kind, amount, text, mult: 1 });
}

export class BattleState {
  constructor({ hpScale = 1 } = {}) {
    this.run = null;
    this.enemy = null;
    this.companion = null;
    this.companionLevel = 1;
    this.enemyHp = 0;
    this.enemyMax = 0;
    this.enemyBlock = 0;
    this.enemyStrength = 0;
    this.enemyWeak = 0;
    this.enemyBurn = 0;
    this.enemyStun = 0;
    this.moveIndex = 0;
    this.block = 0;
    this.energy = 0;
    this.strength = 0;
    this.heroWeak = 0;
    this.heroBurn = 0;
    this.turn = 0;
    this.maxEnergy = 3;
    this.firstTurnBonus = 0;
    this.won = false;
    this.lost = false;
    this.hpScale = hpScale;
    this.drawPile = [];
    this.hand = [];
    this.discard = [];
    this.exhausted = [];
    this.rng = null;
  }

  get nextMove() { return this.enemy.moves[this.moveIndex % this.enemy.moves.length]; }

  begin(run, enemy, companion, companionLevel) {
    this.run = run;
    this.rng = run.rng;
    this.enemy = enemy;
    this.companion = companion;
    this.companionLevel = companionLevel;
    // Later floors in an act toughen ordinary enemies a little.
    this.enemyMax = roundToInt(f32(enemy.hp * this.hpScale));
    this.enemyHp = this.enemyMax;
    this.firstTurnBonus = run.save.talisman(4);
    this.drawPile.push(...shuffled(run.deck, this.rng));
    const events = [];
    this.startTurn(events);
    return events;
  }

  drawCards(count, events) {
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) {
        if (this.discard.length === 0) break;
        this.drawPile.push(...shuffled(this.discard, this.rng));
        this.discard.length = 0;
      }
      const card = this.drawPile.pop();
      this.hand.push(card);
    }
    events.push(E(Ev.Draw));
  }

  startTurn(events) {
    this.turn++;
    this.block = 0;
    this.energy = this.maxEnergy + (this.turn === 1 ? this.firstTurnBonus : 0);
    if (this.heroBurn > 0) {
      this.run.hp = Math.max(0, this.run.hp - this.heroBurn);
      events.push(battleEvent({ kind: Ev.HeroHit, amount: this.heroBurn, mult: 1, element: Element.Fire, text: 'เผาไหม้' }));
      this.heroBurn--;
      if (this.run.hp <= 0) {
        this.lost = true;
        events.push(E(Ev.HeroDefeated));
        return;
      }
    }
    let extraDraw = 0;
    if (this.companion != null) {
      const value = this.companion.valueAt(this.companionLevel);
      switch (this.companion.skill) {
        case CompanionSkill.BlockStart:
          this.block += value;
          events.push(battleEvent({ kind: Ev.CompanionAct, element: this.companion.element, text: 'โล่ +' + value }));
          events.push(E(Ev.HeroBlock, value));
          break;
        case CompanionSkill.HealStart: {
          const before = this.run.hp;
          this.run.hp = Math.min(this.run.maxHp, this.run.hp + value);
          events.push(battleEvent({ kind: Ev.CompanionAct, element: this.companion.element, text: 'ฟื้น +' + value }));
          events.push(E(Ev.HeroHeal, this.run.hp - before));
          break;
        }
        case CompanionSkill.DrawStart:
          extraDraw = value;
          events.push(battleEvent({ kind: Ev.CompanionAct, element: this.companion.element, text: 'จั่ว +' + value }));
          break;
      }
    }
    this.drawCards(5 + extraDraw, events);
  }

  canPlay(card) {
    return !this.won && !this.lost && this.hand.includes(card) && card.def.cost <= this.energy;
  }

  hitEnemy(baseDamage, element, events) {
    const mult = Db.multiplier(element, this.enemy.element);
    const raw = f32(f32((baseDamage + this.strength) * (this.heroWeak > 0 ? F075 : 1)) * mult);
    let damage = Math.max(0, roundToInt(raw));
    const absorbed = Math.min(this.enemyBlock, damage);
    this.enemyBlock -= absorbed;
    damage -= absorbed;
    this.enemyHp = Math.max(0, this.enemyHp - damage);
    events.push(battleEvent({ kind: Ev.EnemyHit, amount: damage, mult, element, text: absorbed > 0 && damage === 0 ? 'กันได้' : null }));
    return damage;
  }

  hitHero(baseDamage, events, text = null) {
    const raw = f32((baseDamage + this.enemyStrength) * (this.enemyWeak > 0 ? F075 : 1));
    let damage = Math.max(0, roundToInt(raw));
    const absorbed = Math.min(this.block, damage);
    this.block -= absorbed;
    damage -= absorbed;
    this.run.hp = Math.max(0, this.run.hp - damage);
    events.push(battleEvent({ kind: Ev.HeroHit, amount: damage, mult: 1, element: this.enemy.element, text: absorbed > 0 && damage === 0 ? 'กันได้' : text }));
  }

  checkEnemyDead(events) {
    if (this.enemyHp > 0 || this.won) return this.won;
    this.won = true;
    events.push(E(Ev.EnemyDefeated));
    return true;
  }

  play(card) {
    const events = [];
    if (!this.canPlay(card)) return events;
    const def = card.def;
    const level = card.effective;
    this.energy -= def.cost;
    removeFirst(this.hand, card);
    (def.exhaust ? this.exhausted : this.discard).push(card);
    events.push(battleEvent({ kind: Ev.HeroMotion, motion: def.motion, element: def.element, text: def.name, heroineId: def.heroineId }));

    const damage = CardDef.scale(def.damage, level);
    if (damage > 0) {
      for (let i = 0; i < def.hits && !this.won; i++) {
        this.hitEnemy(damage, def.element, events);
        this.checkEnemyDead(events);
      }
    }
    if (def.block > 0) {
      const amount = CardDef.scale(def.block, level);
      this.block += amount;
      events.push(E(Ev.HeroBlock, amount));
    }
    if (def.heal > 0) {
      const before = this.run.hp;
      this.run.hp = Math.min(this.run.maxHp, this.run.hp + CardDef.scale(def.heal, level));
      events.push(E(Ev.HeroHeal, this.run.hp - before));
    }
    if (!this.won) {
      if (def.burn > 0) {
        this.enemyBurn += CardDef.scale(def.burn, level);
        events.push(battleEvent({ kind: Ev.EnemyStatus, element: Element.Fire, text: 'เผาไหม้ ' + this.enemyBurn }));
      }
      if (def.weak > 0) {
        this.enemyWeak += def.weak;
        events.push(battleEvent({ kind: Ev.EnemyStatus, element: Element.Dark, text: 'อ่อนแอ' }));
      }
      if (def.stun > 0) {
        this.enemyStun += def.stun;
        events.push(battleEvent({ kind: Ev.EnemyStatus, element: Element.Wood, text: 'ถูกผนึก' }));
      }
    }
    if (def.strength > 0) {
      this.strength += def.strength;
      events.push(battleEvent({ kind: Ev.HeroStatus, element: def.element, text: 'พลังโจมตี +' + def.strength }));
    }
    this.energy += def.energy;
    if (def.draw > 0) this.drawCards(def.draw, events);
    return events;
  }

  endTurn() {
    const events = [];
    if (this.won || this.lost) return events;
    this.discard.push(...this.hand);
    this.hand.length = 0;
    if (this.heroWeak > 0) this.heroWeak--;

    if (this.companion != null) {
      const value = this.companion.valueAt(this.companionLevel);
      switch (this.companion.skill) {
        case CompanionSkill.DamageEnd:
          events.push(battleEvent({ kind: Ev.CompanionAct, element: this.companion.element }));
          this.hitEnemy(value, this.companion.element, events);
          break;
        case CompanionSkill.WeakEnd:
          events.push(battleEvent({ kind: Ev.CompanionAct, element: this.companion.element }));
          this.hitEnemy(value, this.companion.element, events);
          this.enemyWeak += 1;
          events.push(battleEvent({ kind: Ev.EnemyStatus, element: Element.Dark, text: 'อ่อนแอ' }));
          break;
        case CompanionSkill.BurnEnd:
          events.push(battleEvent({ kind: Ev.CompanionAct, element: this.companion.element }));
          this.hitEnemy(value, this.companion.element, events);
          this.enemyBurn += 2;
          break;
      }
      if (this.checkEnemyDead(events)) return events;
    }

    // Enemy turn: its block fades, burning hurts, then it acts.
    this.enemyBlock = 0;
    if (this.enemyBurn > 0) {
      this.enemyHp = Math.max(0, this.enemyHp - this.enemyBurn);
      events.push(battleEvent({ kind: Ev.Burn, amount: this.enemyBurn, element: Element.Fire, mult: 1 }));
      this.enemyBurn--;
      if (this.checkEnemyDead(events)) return events;
    }

    if (this.enemyStun > 0) {
      this.enemyStun--;
      events.push(E(Ev.Message, 0, this.enemy.name + ' ถูกผนึก ขยับไม่ได้'));
    } else {
      const move = this.nextMove;
      switch (move.kind) {
        case MoveKind.Attack:
          for (let i = 0; i < move.hits && this.run.hp > 0; i++) {
            events.push(battleEvent({ kind: Ev.EnemyMotion, element: this.enemy.element }));
            this.hitHero(move.value, events);
          }
          break;
        case MoveKind.Block:
          this.enemyBlock += move.value;
          events.push(E(Ev.EnemyBlock, move.value));
          break;
        case MoveKind.Buff:
          this.enemyStrength += move.value;
          events.push(E(Ev.EnemyBuff, move.value, 'พลังเพิ่มขึ้น'));
          break;
        case MoveKind.Drain: {
          events.push(battleEvent({ kind: Ev.EnemyMotion, element: this.enemy.element }));
          const before = this.run.hp;
          this.hitHero(move.value, events);
          this.enemyHp = Math.min(this.enemyMax, this.enemyHp + (before - this.run.hp));
          break;
        }
        case MoveKind.Weaken:
          this.heroWeak += move.value;
          events.push(battleEvent({ kind: Ev.HeroStatus, element: Element.Dark, text: 'อาการิอ่อนแอ' }));
          break;
        case MoveKind.Burn:
          events.push(battleEvent({ kind: Ev.EnemyMotion, element: this.enemy.element }));
          this.heroBurn += move.value;
          events.push(battleEvent({ kind: Ev.HeroStatus, element: Element.Fire, text: 'ติดไฟ ' + this.heroBurn }));
          break;
      }
      this.moveIndex++;
    }
    if (this.enemyWeak > 0) this.enemyWeak--;

    if (this.run.hp <= 0) {
      this.lost = true;
      events.push(E(Ev.HeroDefeated));
      return events;
    }
    this.startTurn(events);
    return events;
  }

  intentText() {
    if (this.enemyStun > 0) return 'ถูกผนึก ขยับไม่ได้';
    const move = this.nextMove;
    const damage = roundToInt(f32((move.value + this.enemyStrength) * (this.enemyWeak > 0 ? F075 : 1)));
    switch (move.kind) {
      case MoveKind.Attack: return move.hits > 1 ? 'จะโจมตี ' + damage + ' x' + move.hits : 'จะโจมตี ' + damage;
      case MoveKind.Block: return 'จะตั้งโล่ ' + move.value;
      case MoveKind.Buff: return 'จะเพิ่มพลัง +' + move.value;
      case MoveKind.Drain: return 'จะดูดพลังชีวิต ' + damage;
      case MoveKind.Weaken: return 'จะทำให้อ่อนแอ';
      default: return 'จะจุดไฟ ' + move.value;
    }
  }

  incoming() {
    if (this.enemyStun > 0) return 0;
    const move = this.nextMove;
    const damage = roundToInt(f32((move.value + this.enemyStrength) * (this.enemyWeak > 0 ? F075 : 1)));
    return move.kind === MoveKind.Attack ? damage * move.hits : move.kind === MoveKind.Drain ? damage : 0;
  }
}

/** Battle HP scale for a map node (LcGame.StartBattle: 1 + 0.07 * row, bosses unscaled). */
export function hpScaleFor(node) {
  return node.kind === NodeKind.Boss ? 1 : f32(1 + f32(F007 * node.row));
}
