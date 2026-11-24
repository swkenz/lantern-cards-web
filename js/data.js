// Lantern Cards - static game data (port of LcData.cs).
// Pure ES module: no DOM, no three.js, no Node APIs.

// ---------- Unity math helpers ----------

/** Rounds to float32, like a C# `float` result. */
export const f32 = Math.fround;

/** Mathf.RoundToInt: (int)Math.Round(x), i.e. round half to even (banker's rounding). */
export function roundToInt(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const F015 = f32(0.15);
const F03 = f32(0.3);

function hex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

// ---------- Enums ----------

export const Element = Object.freeze({ None: 0, Fire: 1, Water: 2, Wood: 3, Light: 4, Dark: 5 });
export const Rarity = Object.freeze({ N: 0, R: 1, SR: 2, SSR: 3 });
export const CardType = Object.freeze({ Attack: 0, Skill: 1, Power: 2 });
export const Motion = Object.freeze({ Slash: 0, Heavy: 1, Spin: 2, Dash: 3, Spell: 4, Guard: 5, Drink: 6, Focus: 7, Heroine: 8 });
export const MoveKind = Object.freeze({ Attack: 0, Block: 1, Buff: 2, Drain: 3, Weaken: 4, Burn: 5 });
export const NodeKind = Object.freeze({ Battle: 0, Elite: 1, Shop: 2, Rest: 3, Treasure: 4, Boss: 5 });
export const CompanionSkill = Object.freeze({ BlockStart: 0, DamageEnd: 1, HealStart: 2, WeakEnd: 3, DrawStart: 4, BurnEnd: 5 });

// ---------- Definitions ----------

export class CardDef {
  constructor(props = {}) {
    this.id = null;
    this.name = null;
    this.art = null;
    this.heroineId = null;
    this.element = Element.None;
    this.rarity = Rarity.N;
    this.type = CardType.Attack;
    this.motion = Motion.Slash;
    this.cost = 0;
    this.damage = 0;
    this.hits = 1;
    this.block = 0;
    this.heal = 0;
    this.draw = 0;
    this.energy = 0;
    this.stun = 0;
    this.burn = 0;
    this.weak = 0;
    this.strength = 0;
    this.exhaust = false;
    Object.assign(this, props);
  }

  static scale(value, level) {
    return value === 0 ? 0 : roundToInt(f32(value * f32(1 + f32(F015 * (level - 1)))));
  }

  describe(level) {
    const parts = [];
    const damage = CardDef.scale(this.damage, level);
    if (damage > 0) parts.push(this.hits > 1 ? 'โจมตี ' + damage + ' x' + this.hits : 'โจมตี ' + damage);
    if (this.block > 0) parts.push('โล่ ' + CardDef.scale(this.block, level));
    if (this.heal > 0) parts.push('ฟื้น ' + CardDef.scale(this.heal, level));
    if (this.burn > 0) parts.push('เผาไหม้ ' + CardDef.scale(this.burn, level));
    if (this.weak > 0) parts.push('อ่อนแอ ' + this.weak + ' เทิร์น');
    if (this.stun > 0) parts.push('ผนึก ' + this.stun + ' เทิร์น');
    if (this.strength > 0) parts.push('พลังโจมตี +' + this.strength);
    if (this.energy > 0) parts.push('พลังงาน +' + this.energy);
    if (this.draw > 0) parts.push('จั่ว ' + this.draw);
    if (this.exhaust) parts.push('ใช้แล้วหายไป');
    return parts.join('  ');
  }
}

/** A heroine who joins Akari's team: adds her signature card to the deck and appears in a cut-in. */
export class HeroineDef {
  constructor(props = {}) {
    this.id = null;
    this.name = null;
    this.title = null;
    this.text = null;
    this.cardId = null;
    this.element = Element.None;
    this.rarity = Rarity.N;
    this.hpBonus = 0;
    Object.assign(this, props);
  }

  hpAt(level) {
    return this.hpBonus + 3 * (level - 1);
  }

  /** C# checks Resources/Heroines/<id>; here it is the fixed set Db.heroineArt. */
  static hasArt(id) {
    return Db.heroineArt.has(id);
  }
}

export class CompanionDef {
  constructor(props = {}) {
    this.id = null;
    this.name = null;
    this.model = null;
    this.text = null;
    this.portrait = 0;
    this.element = Element.None;
    this.rarity = Rarity.N;
    this.skill = CompanionSkill.BlockStart;
    this.value = 0;
    Object.assign(this, props);
  }

  valueAt(level) {
    return roundToInt(f32(this.value * f32(1 + f32(F03 * (level - 1)))));
  }
}

export class MoveDef {
  constructor(kind, value, hits = 1) {
    this.kind = kind;
    this.value = value;
    this.hits = hits;
  }
}

export class EnemyDef {
  constructor(props = {}) {
    this.id = null;
    this.name = null;
    this.model = null;
    this.element = Element.None;
    this.hp = 0;
    this.height = 1.3;
    this.boss = false;
    this.elite = false;
    this.moves = [];
    Object.assign(this, props);
  }
}

export class ActDef {
  constructor(props = {}) {
    this.name = null;
    this.subtitle = null;
    this.arena = { x: 0, y: 0 };
    this.yaw = 0;
    this.normal = [];
    this.elite = [];
    this.boss = null;
    Object.assign(this, props);
  }
}

export class TalismanDef {
  constructor(props = {}) {
    this.name = null;
    this.text = null;
    this.maxLevel = 0;
    this.baseCost = 0;
    Object.assign(this, props);
  }

  costAt(level) {
    return this.baseCost * (level + 1);
  }
}

// ---------- Content builders (mirror Db.C / Db.Set / Db.Sig / Db.E / A / B / ...) ----------

function C(id, name, element, rarity, type, motion, cost, art) {
  return new CardDef({ id, name, element, rarity, type, motion, cost, art });
}

function Set_(c, { d = 0, hits = 1, b = 0, heal = 0, draw = 0, energy = 0, stun = 0, burn = 0, weak = 0, str = 0, ex = false } = {}) {
  c.damage = d; c.hits = hits; c.block = b; c.heal = heal; c.draw = draw; c.energy = energy; c.stun = stun;
  c.burn = burn; c.weak = weak; c.strength = str; c.exhaust = ex;
  return c;
}

function Sig(card, heroine) {
  card.heroineId = heroine;
  return card;
}

function E(id, name, model, element, hp, height, ...moves) {
  return new EnemyDef({ id, name, model, element, hp, height, moves });
}

const A = (v, hits = 1) => new MoveDef(MoveKind.Attack, v, hits);
const B = v => new MoveDef(MoveKind.Block, v);
const Up = v => new MoveDef(MoveKind.Buff, v);
const Dr = v => new MoveDef(MoveKind.Drain, v);
const Wk = v => new MoveDef(MoveKind.Weaken, v);
const Bn = v => new MoveDef(MoveKind.Burn, v);

const { None, Fire, Water, Wood, Light, Dark } = Element;
const { N, R, SR, SSR } = Rarity;
const { Attack, Skill, Power } = CardType;

const elementRgb = [
  [0.72, 0.7, 0.78], [1, 0.45, 0.25], [0.3, 0.65, 1],
  [0.4, 0.85, 0.4], [1, 0.86, 0.4], [0.7, 0.45, 1],
];
const rarityRgb = [
  [0.7, 0.7, 0.76], [0.35, 0.65, 1], [0.72, 0.45, 1], [1, 0.78, 0.3],
];

const cards = [
  // Basics
  Set_(C('slash', 'ฟันดาบ', None, N, Attack, Motion.Slash, 1, 'card_slash'), { d: 6 }),
  Set_(C('guard', 'ปัดป้อง', None, N, Skill, Motion.Guard, 1, 'card_guard'), { b: 5 }),
  // Fire
  Set_(C('flameblade', 'ดาบเพลิง', Fire, N, Attack, Motion.Slash, 1, 'card_twin'), { d: 7 }),
  Set_(C('foxfire', 'ไฟจิ้งจอก', Fire, R, Attack, Motion.Spell, 2, 'card_foxfire'), { d: 5, hits: 2, burn: 2 }),
  Set_(C('inferno', 'อัคคีพิโรธ', Fire, SR, Attack, Motion.Heavy, 2, 'card_skycut'), { d: 14, burn: 3 }),
  Set_(C('ninetails', 'เก้าหางพิโรธ', Fire, SSR, Power, Motion.Spin, 3, 'card_ninetails'), { d: 10, hits: 3, ex: true }),
  // Water
  Set_(C('mirrorwave', 'คลื่นกระจก', Water, N, Attack, Motion.Slash, 1, 'card_crescent'), { d: 5, b: 4 }),
  Set_(C('crescent', 'จันทร์เสี้ยว', Water, R, Attack, Motion.Dash, 2, 'card_crescent'), { d: 13 }),
  Set_(C('stream', 'สายน้ำบำบัด', Water, R, Skill, Motion.Drink, 1, 'card_tea'), { heal: 8, ex: true }),
  Set_(C('whirlpool', 'วังวนจันทรา', Water, SR, Attack, Motion.Spin, 2, 'card_petal'), { d: 6, hits: 2, weak: 2 }),
  // Wood
  Set_(C('jadeleaf', 'ใบมีดหยก', Wood, N, Attack, Motion.Slash, 1, 'card_slash'), { d: 4, hits: 2 }),
  Set_(C('petal', 'พายุซากุระ', Wood, R, Attack, Motion.Spin, 2, 'card_petal'), { d: 4, hits: 3, b: 3 }),
  Set_(C('forestward', 'ป่าคุ้มครอง', Wood, R, Skill, Motion.Guard, 2, 'card_lantern'), { b: 13 }),
  Set_(C('roots', 'รากพันธนาการ', Wood, SR, Power, Motion.Spell, 2, 'card_chain'), { d: 6, stun: 1, ex: true }),
  // Light
  Set_(C('dawn', 'แสงอรุณ', Light, N, Attack, Motion.Spell, 1, 'card_foxfire'), { d: 5, draw: 1 }),
  Set_(C('lantern', 'โล่โคมไฟ', Light, R, Skill, Motion.Guard, 2, 'card_lantern'), { b: 11, heal: 3 }),
  Set_(C('skycut', 'ตัดฟ้า', Light, SR, Attack, Motion.Heavy, 3, 'card_skycut'), { d: 24 }),
  Set_(C('blessing', 'พรแห่งโคมไฟ', Light, SSR, Power, Motion.Focus, 1, 'card_focus'), { energy: 2, draw: 2, ex: true }),
  // Dark
  Set_(C('shadowstep', 'ก้าวเงา', Dark, N, Attack, Motion.Dash, 0, 'card_twin'), { d: 3, draw: 1 }),
  Set_(C('mistcurse', 'คำสาปหมอก', Dark, R, Skill, Motion.Spell, 1, 'card_chain'), { d: 4, weak: 2 }),
  Set_(C('soulseal', 'ผนึกวิญญาณ', Dark, SR, Power, Motion.Spell, 2, 'card_chain'), { stun: 1, weak: 1, ex: true }),
  Set_(C('eclipse', 'จันทราคราส', Dark, SSR, Attack, Motion.Heavy, 3, 'card_skycut'), { d: 32, ex: true }),
  // Utility
  Set_(C('tea', 'ชาสมุนไพร', None, N, Skill, Motion.Drink, 1, 'card_tea'), { heal: 7, ex: true }),
  Set_(C('focus', 'สมาธิ', None, R, Power, Motion.Focus, 0, 'card_focus'), { energy: 2, ex: true }),
  Set_(C('battlecry', 'ปลุกพลังจิ้งจอก', Fire, SR, Power, Motion.Focus, 1, 'card_portrait'), { str: 2 }),
  // Heroine signature cards: only come from the team, never from rewards or the gacha card pool.
  Sig(Set_(C('sig_homura', 'เพลิงพิฆาตอสูร', Fire, SSR, Attack, Motion.Heroine, 2, 'heroine_homura'), { d: 9, hits: 2, burn: 3 }), 'homura'),
  Sig(Set_(C('sig_minase', 'ม่านน้ำจันทรา', Water, SR, Skill, Motion.Heroine, 1, 'heroine_minase'), { b: 9, heal: 4 }), 'minase'),
  Sig(Set_(C('sig_tsubaki', 'ศรพันธุ์ไม้', Wood, SR, Attack, Motion.Heroine, 1, 'heroine_tsubaki'), { d: 5, hits: 3 }), 'tsubaki'),
  Sig(Set_(C('sig_teru', 'แสงโคมนิรันดร์', Light, SSR, Power, Motion.Heroine, 2, 'heroine_teru'), { d: 12, energy: 1, draw: 1 }), 'teru'),
  Sig(Set_(C('sig_yoi', 'เงาสังหาร', Dark, SR, Attack, Motion.Heroine, 1, 'heroine_yoi'), { d: 14, weak: 1 }), 'yoi'),
];

const heroines = [
  new HeroineDef({ id: 'homura', name: 'โฮมุระ', title: 'นักดาบเพลิงแห่งศาลแดง', element: Fire, rarity: SSR, hpBonus: 10, cardId: 'sig_homura', text: 'ง้าวเพลิงที่เผาหมอกให้มอดไหม้' }),
  new HeroineDef({ id: 'minase', name: 'มินาเสะ', title: 'มิโกะแห่งทะเลสาบจันทรา', element: Water, rarity: SR, hpBonus: 8, cardId: 'sig_minase', text: 'สายน้ำที่ปกป้องและเยียวยาเพื่อนร่วมทาง' }),
  new HeroineDef({ id: 'tsubaki', name: 'สึบากิ', title: 'นักธนูแห่งป่าศักดิ์สิทธิ์', element: Wood, rarity: SR, hpBonus: 6, cardId: 'sig_tsubaki', text: 'ลูกศรสามดอกที่ไม่เคยพลาดเป้า' }),
  new HeroineDef({ id: 'teru', name: 'เทรุ', title: 'ปราชญ์แห่งโคมไฟทองคำ', element: Light, rarity: SSR, hpBonus: 8, cardId: 'sig_teru', text: 'แสงโคมที่ปลุกพลังให้ทั้งทีม' }),
  new HeroineDef({ id: 'yoi', name: 'โยอิ', title: 'นินจาเงาแห่งเที่ยงคืน', element: Dark, rarity: SR, hpBonus: 6, cardId: 'sig_yoi', text: 'คมกริชจากเงาที่ทำให้ศัตรูอ่อนแรง' }),
];

const companions = [
  new CompanionDef({ id: 'toki', name: 'โทกิ ภูตไก่แสง', model: 'Chicken', portrait: 5, element: Light, rarity: R, skill: CompanionSkill.BlockStart, value: 4, text: 'ต้นเทิร์น ให้โล่อาการิ {0}' }),
  new CompanionDef({ id: 'koro', name: 'โคโระ ภูตเพนกวินน้ำแข็ง', model: 'Penguin', portrait: 3, element: Water, rarity: R, skill: CompanionSkill.DamageEnd, value: 5, text: 'จบเทิร์น ยิงน้ำแข็งใส่ศัตรู {0}' }),
  new CompanionDef({ id: 'miso', name: 'มิโซะ ภูตหมูใบไม้', model: 'Pig', portrait: 2, element: Wood, rarity: R, skill: CompanionSkill.HealStart, value: 3, text: 'ต้นเทิร์น ฟื้นพลังชีวิต {0}' }),
  new CompanionDef({ id: 'shimeji', name: 'ชิเมจิ ภูตเห็ดเงา', model: 'Mushroom', portrait: 4, element: Dark, rarity: SR, skill: CompanionSkill.WeakEnd, value: 6, text: 'จบเทิร์น โจมตีเงา {0} และทำให้อ่อนแอ' }),
  new CompanionDef({ id: 'hana', name: 'ฮานะ ภูตกวางซากุระ', model: 'Deer', portrait: 0, element: Wood, rarity: SR, skill: CompanionSkill.DrawStart, value: 1, text: 'ต้นเทิร์น จั่วการ์ดเพิ่ม {0} ใบ' }),
  new CompanionDef({ id: 'panda', name: 'พันดะ ภูตแพนด้าเพลิง', model: 'Panda', portrait: 1, element: Fire, rarity: SSR, skill: CompanionSkill.BurnEnd, value: 7, text: 'จบเทิร์น พ่นไฟ {0} และเผาไหม้ 2' }),
];

const enemies = [
  // Chapter 1
  E('cactus', 'เจ้ากระบองเพชร', 'Cactus', Wood, 30, 1.3, A(6), A(7), B(6)),
  E('greendemon', 'ปีศาจเขียว', 'GreenDemon', Wood, 38, 1.4, A(8), Up(2), A(5, 2)),
  E('cyclops', 'ไซคลอปส์จิ๋ว', 'Cyclops', Light, 34, 1.4, A(5, 2), B(8), A(9)),
  E('alien', 'ภูตต่างดาว', 'Alien', Dark, 62, 1.6, A(9), Wk(2), A(6, 2), Up(2)),
  E('oni', 'โอนิมารุ', 'GreenDemon', Wood, 120, 3.0, A(12), B(12), A(6, 3), Up(3), A(18)),
  // Chapter 2
  E('crab', 'เจ้าปูก้ามโต', 'Crab', Water, 52, 1.3, B(10), A(13), A(5, 2)),
  E('bee', 'ผึ้งหงุดหงิด', 'Bee', Wood, 44, 1.2, A(4, 3), Bn(3), A(9)),
  E('bat', 'ค้างคาวเงา', 'Bat', Dark, 48, 1.2, Dr(8), A(6, 2), Wk(2)),
  E('tree', 'ต้นไม้เดินได้', 'Tree', Wood, 84, 2.0, B(14), A(14), Up(3), A(8, 2)),
  E('kani', 'ราชาปูคานิ', 'Crab', Water, 160, 3.0, B(14), A(14), A(6, 3), Up(2), A(20)),
  // Chapter 3
  E('ghost', 'ผีน้อยขี้หนาว', 'Ghost', Water, 62, 1.4, A(4, 3), Dr(9), Up(2)),
  E('yeti', 'เยติปุกปุย', 'Yeti', Water, 76, 1.7, A(14), B(12), A(7, 2)),
  E('skull', 'กะโหลกน้อย', 'Skull', Dark, 66, 1.3, A(8, 2), Wk(2), A(15)),
  E('demon', 'ปีศาจแดง', 'Demon', Fire, 110, 1.8, Bn(4), A(16), Up(3), A(9, 2)),
  E('yoru', 'โยรุ หางที่สิบ', 'Demon', Dark, 240, 3.2, A(15), A(6, 3), B(18), Wk(2), Up(3), A(28)),
];

const acts = [
  new ActDef({ name: 'บทที่ 1  ทุ่งดอกไม้', subtitle: 'หมอกสีม่วงลอยต่ำเหนือทุ่ง', arena: { x: -92, y: -48 }, yaw: 262,
    normal: ['cactus', 'greendemon', 'cyclops'], elite: ['alien'], boss: 'oni' }),
  new ActDef({ name: 'บทที่ 2  ทะเลสาบกระจก', subtitle: 'เงาบนผิวน้ำเริ่มขยับเอง', arena: { x: 52, y: -53 }, yaw: 110,
    normal: ['crab', 'bee', 'bat'], elite: ['tree'], boss: 'kani' }),
  new ActDef({ name: 'บทที่ 3  บัลลังก์เมฆา', subtitle: 'หางที่สิบรออยู่บนฟ้า', arena: { x: 0, y: 98 }, yaw: 0,
    normal: ['ghost', 'yeti', 'skull'], elite: ['demon'], boss: 'yoru' }),
];

const talismans = [
  new TalismanDef({ name: 'เครื่องรางอายุยืน', text: 'พลังชีวิตสูงสุด +8 ต่อระดับ', maxLevel: 5, baseCost: 120 }),
  new TalismanDef({ name: 'ถุงเงินโชคดี', text: 'เริ่มรอบด้วยเหรียญ +30 ต่อระดับ', maxLevel: 4, baseCost: 100 }),
  new TalismanDef({ name: 'ดวงตาโคมไฟ', text: 'ตัวเลือกการ์ดรางวัล +1 ใบ', maxLevel: 1, baseCost: 400 }),
  new TalismanDef({ name: 'คริสตัลเรืองแสง', text: 'ได้คริสตัลเพิ่ม 15% ต่อระดับ', maxLevel: 4, baseCost: 150 }),
  new TalismanDef({ name: 'สมาธิแรกเริ่ม', text: 'เทิร์นแรกของทุกการต่อสู้ พลังงาน +1', maxLevel: 1, baseCost: 500 }),
];

// ---------- Db ----------

export const Db = {
  elementNames: ['กลาง', 'ไฟ', 'น้ำ', 'ไม้', 'แสง', 'มืด'],
  elementRgb,
  elementColors: elementRgb.map(hex),
  rarityNames: ['N', 'R', 'SR', 'SSR'],
  rarityRgb,
  rarityColors: rarityRgb.map(hex),
  typeNames: ['โจมตี', 'ทักษะ', 'พิเศษ'],
  nodeNames: ['ต่อสู้', 'หัวหน้า', 'ร้านค้า', 'พักผ่อน', 'สมบัติ', 'บอส'],

  /** Fire beats Wood, Wood beats Water, Water beats Fire; Light and Dark beat each other. */
  multiplier(attack, defend) {
    if ((attack === Fire && defend === Wood) || (attack === Wood && defend === Water) ||
      (attack === Water && defend === Fire)) return 1.5;
    if ((attack === Wood && defend === Fire) || (attack === Water && defend === Wood) ||
      (attack === Fire && defend === Water)) return 0.75;
    if ((attack === Light && defend === Dark) || (attack === Dark && defend === Light)) return 1.5;
    return 1;
  },

  cards,
  heroines,
  companions,
  enemies,
  acts,
  talismans,

  /** Heroines that have portrait art (C#: Resources/Heroines/<id>). Only these appear in the gacha. */
  heroineArt: new Set(['homura', 'minase', 'tsubaki']),

  teamSize: 3,
  starterDeck: ['slash', 'slash', 'slash', 'slash', 'slash', 'guard', 'guard', 'guard', 'guard', 'flameblade'],
  starterUnlocked: ['slash', 'guard', 'flameblade', 'mirrorwave', 'jadeleaf', 'dawn', 'shadowstep', 'tea'],

  maxLevel: 5,
  pullCost: 100,
  tenPullCost: 900,
  ssrPity: 60,

  card(id) { return cards.find(c => c.id === id) ?? null; },
  companion(id) { return companions.find(c => c.id === id) ?? null; },
  heroine(id) { return heroines.find(h => h.id === id) ?? null; },
  enemy(id) { return enemies.find(e => e.id === id) ?? null; },
};
