// Every screen of Lantern Cards as HTML on a 1920x1080 stage (port of LcUi.cs).
import { Db, Rarity, NodeKind, HeroineDef } from './data.js';
import { RunState, SaveData } from './core.js';

const C = {
  gold: '#e3bf7a', ivory: '#f2ebd9', muted: '#bdb0d6', crimson: '#bd384a', night: '#120e21', sky: '#7dc4ff',
  hp: '#d94560', violet: '#997dff', green: '#6edb94', purpleBtn: '#2b2149', dark: '#241c3a', teal: '#2e664d', plum: '#593d8c', off: '#262133',
};
const NODE_COLORS = ['#bd384a', '#8c59f2', '#e6b34d', '#59bf80', '#f28c40', '#991a33'];

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shade = (hex, k, a = 1) => { const [r, g, b] = hexRgb(hex); return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`; };
const tint = (hex, k) => { const [r, g, b] = hexRgb(hex); return `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`; };

function el(tag, cls, style, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) Object.assign(e.style, style);
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
const px = (v) => (typeof v === 'number' ? v + 'px' : v);
function at(e, left, top, right, bottom) {
  e.style.position = 'absolute';
  if (left != null) e.style.left = px(left);
  if (top != null) e.style.top = px(top);
  if (right != null) e.style.right = px(right);
  if (bottom != null) e.style.bottom = px(bottom);
  return e;
}
function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return kids[0];
}
const text = (value, size, color = C.ivory, weight = 400, extra = {}) => el('div', null, { fontSize: size + 'px', color, fontWeight: weight, ...extra }, value);

/**
 * Developer mode, remembered on this device: open the game with ?dev (?dev=0 turns it off), or tap the crystal
 * counter 7 times quickly. While it is on, the crystal counter has a "+" that fills the crystals up.
 */
const DEV_KEY = 'lanterncards.dev';
export const Dev = {
  get on() {
    try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; }
  },
  set(on) {
    try { if (on) localStorage.setItem(DEV_KEY, '1'); else localStorage.removeItem(DEV_KEY); } catch { /* site data blocked */ }
  },
};

export const art = {
  card: (key) => (!key ? '' : key.startsWith('heroine_') ? `assets/art/heroines/${key.slice(8)}_card.png` : `assets/art/cards/${key}.png`),
  heroineFace: (id) => `assets/art/heroines/${id}_card.png`,
  heroineWide: (id) => `assets/art/heroines/${id}.png`,
  portrait: (i) => `assets/art/portraits/portrait_${i}.png`,
  logo: 'assets/art/ui/logo.png',
  banner: 'assets/art/ui/gacha_banner.png',
};
const url = (u) => `url("${u}")`;

export class Ui {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.floats = document.getElementById('floats');
    this.layer = add(this.root, el('div', 'layer'));
    this.toastBox = add(this.root, el('div', null, null));
    this.toastBox.id = 'toast';
    this.chapterBox = add(this.root, el('div'));
    this.chapterBox.id = 'chapter';
    this.chapterTitle = add(this.chapterBox, el('div', 't'));
    this.chapterSub = add(this.chapterBox, el('div', 's'));
    this.flashEl = document.getElementById('flash');
    this.floaters = [];
    this.hud = null;
    this.fit();
    window.addEventListener('resize', () => this.fit());
    const tick = () => {
      requestAnimationFrame(tick);
      this.updateFloats();
    };
    tick();
  }

  get flow() { return this.game.flow; }
  get save() { return this.game.flow.save; }

  fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    this.scale = s;
    this.root.style.transform = `translate(${-960 * s}px, ${-540 * s}px) scale(${s})`;
  }

  click(fn) {
    return (e) => {
      e?.stopPropagation?.();
      this.game.sound.unlock();
      this.game.sound.play('ui');
      fn();
    };
  }

  // ---------- Building blocks ----------

  button(parent, caption, color, onClick, width = 0, height = 60, size = 24) {
    const b = add(parent, el('div', 'btn', { background: color, height: px(height), fontSize: size + 'px' }, caption));
    if (width) b.style.width = px(width);
    b.addEventListener('pointerdown', this.click(onClick));
    return b;
  }

  chip(parent, value, color, size = 16) {
    return add(parent, el('span', 'chip', { background: shade(color, 0.35, 0.95), borderColor: color, color: tint(color, 0.45), fontSize: size + 'px' }, value));
  }

  bar(parent, width, height, fill) {
    const track = add(parent, el('div', 'bar', { width: px(width), height: px(height) }));
    const f = add(track, el('div', 'fill', { background: fill, width: '100%' }));
    const t = add(track, el('div', 'text', { fontSize: Math.round(height * 0.66) + 'px' }));
    return { track, fill: f, text: t, set: (value, label) => { f.style.width = Math.max(0, Math.min(1, value)) * 100 + '%'; t.textContent = label; } };
  }

  face(parent, size, image, border, width = 2) {
    return add(parent, el('div', 'face', { width: px(size), height: px(size), backgroundImage: image ? url(image) : 'none', border: `${width}px solid ${border}`, backgroundColor: C.night }));
  }

  screen(title, { dim = true, through = false } = {}) {
    this.layer.innerHTML = '';
    const s = add(this.layer, el('div', 'screen' + (dim ? ' dim' : '') + (through ? ' through' : '')));
    if (title) at(add(s, el('div', 'heading', null, title)), 60, 40);
    return s;
  }

  crystalPill(parent, right, top) {
    const pill = at(add(parent, el('div', 'crystal-pill panel', { borderColor: C.gold })), null, top, right);
    add(pill, el('div', 'gemi'));
    const label = add(pill, el('span', null, null, this.save.crystals.toLocaleString('en-US') + ' คริสตัล'));
    // 7 quick taps switch developer mode on or off.
    pill.addEventListener('click', () => {
      const now = performance.now();
      this.devTaps = (this.devTaps || []).filter((t) => now - t < 3000).concat(now);
      if (this.devTaps.length < 7) return;
      this.devTaps = [];
      Dev.set(!Dev.on);
      this.toast(Dev.on ? 'โหมดนักพัฒนา: เปิด  (กด + เพื่อเติมคริสตัล)' : 'โหมดนักพัฒนา: ปิด');
      pill.remove();
      this.crystalPill(parent, right, top);
    });
    if (Dev.on) {
      const plus = add(pill, el('button', 'dev-plus', null, '+'));
      plus.title = 'เติมคริสตัล (โหมดนักพัฒนา)';
      plus.addEventListener('click', (e) => {
        e.stopPropagation();
        this.flow.devCrystals();
        label.textContent = this.save.crystals.toLocaleString('en-US') + ' คริสตัล';
      });
    }
  }

  /** Same picture placement rules as Unity's Picture(): a square image at a fixed size and offset inside a frame. */
  picture(frame, image, size, x, y) {
    if (!image) return;
    frame.style.backgroundImage = url(image);
    frame.style.backgroundSize = `${size}px ${size}px`;
    frame.style.backgroundPosition = `${x}px ${y}px`;
  }

  // ---------- Card view ----------

  cardView(parent, def, level, onClick, footer = null, scale = 1, dimmed = false) {
    const slot = add(parent, el('div', 'card-slot' + (onClick ? ' click' : ''), { width: px(190 * scale), height: px(272 * scale) }));
    const element = Db.elementColors[def.element];
    const rarity = Db.rarityColors[def.rarity];
    const card = add(slot, el('div', 'card' + (dimmed ? ' dimmed' : '') + (def.heroineId ? ' heroine' : ''), { scale: String(scale), borderColor: def.rarity >= Rarity.SR ? rarity : C.gold }));
    add(card, el('div', 'name', { background: shade(element, 0.32) }, def.name));
    const pic = add(card, el('div', 'pic', { background: shade(element, 0.45) }));
    if (def.heroineId) this.picture(pic, art.card(def.art), 180, -3, -40);
    else this.picture(pic, art.card(def.art), 200, -13, -4);
    const tags = add(card, el('div', 'tags'));
    this.chip(tags, Db.elementNames[def.element], element, 14);
    this.chip(tags, Db.typeNames[def.type], C.muted, 14);
    this.chip(tags, Db.rarityNames[def.rarity], rarity, 14);
    add(card, el('div', 'desc', null, def.describe(level)));
    if (level > 1 || footer != null) add(card, el('div', 'foot', null, footer ?? 'Lv.' + level));
    const gem = add(card, el('div', 'gem'));
    add(gem, el('span', null, null, String(def.cost)));
    if (onClick) slot.addEventListener('pointerdown', this.click(onClick));
    return slot;
  }

  // ---------- Floating text, toast, chapter card, flash ----------

  float(world, value, color, big = false) {
    if (this.game.fast) return;
    const label = add(this.floats, el('div', 'float', { fontSize: (big ? 62 : 44) * this.scale + 'px', color }, value));
    const w = world.clone();
    w.x += (Math.random() - 0.5) * 0.5;
    w.y += (Math.random() - 0.5) * 0.5;
    w.z += (Math.random() - 0.5) * 0.5;
    this.floaters.push({ label, world: w, age: 0, life: big ? 1.1 : 0.9, last: performance.now() });
  }

  updateFloats() {
    const now = performance.now();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += (now - f.last) / 1000;
      f.last = now;
      if (f.age >= f.life) {
        f.label.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const t = f.age / f.life;
      const p = this.game.stage.toScreen(f.world.clone().setY(f.world.y + t * 0.8));
      f.label.style.left = p.x + 'px';
      f.label.style.top = p.y + 'px';
      f.label.style.opacity = String(1 - t * t);
      const pop = t < 0.12 ? 1.5 + (1 - 1.5) * (t / 0.12) : 1;
      f.label.style.transform = `scale(${pop})`;
    }
  }

  toast(value) {
    this.toastBox.textContent = value;
    this.toastBox.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastBox.style.opacity = '0'), 2000);
  }

  chapterCard(title, subtitle) {
    this.chapterTitle.textContent = title;
    this.chapterSub.textContent = subtitle;
    this.chapterBox.style.opacity = '1';
    clearTimeout(this.chapterTimer);
    this.chapterTimer = setTimeout(() => (this.chapterBox.style.opacity = '0'), 2700);
  }

  flash(color, strength = 0.4) {
    if (this.game.fast) return;
    const f = this.flashEl;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = String(strength);
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.22s ease-out';
      f.style.opacity = '0';
    });
  }

  /** Full-width cut-in for a heroine's signature card: portrait slides in from the right, name and skill from the left. */
  cutIn(heroine, skill) {
    if (this.game.fast || !heroine) return Promise.resolve();
    const element = Db.elementColors[heroine.element];
    const dim = add(this.root, el('div', 'cutin-dim'));
    const band = add(this.root, el('div', 'cutin', { borderColor: element }));
    const streaks = [];
    for (let i = 0; i < 18; i++) {
      const s = add(band, el('div', 'streak', { top: px(10 + Math.random() * 390), width: px(220 + Math.random() * 460), height: px(2 + Math.random() * 3), background: shade(element, 1, 0.18 + Math.random() * 0.32) }));
      streaks.push({ s, x: -200 + Math.random() * 2100, speed: 2400 + Math.random() * 1800 });
    }
    const portrait = add(band, el('div', 'portrait', { backgroundImage: url(art.heroineWide(heroine.id)) }));
    const words = add(band, el('div', 'words'));
    add(words, text(heroine.title, 26, C.muted, 700, { textShadow: '0 2px 4px #000' }));
    add(words, text(heroine.name, 96, C.ivory, 700, { lineHeight: '1.1', textShadow: '0 3px 6px #000' }));
    add(words, text('「' + skill + '」', 46, tint(element, 0.35), 700, { textShadow: '0 2px 4px #000' }));
    add(words, el('div', null, { width: '420px', height: '4px', background: element, marginTop: '10px' }));
    const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    const total = 1.15;
    return new Promise((resolve) => {
      let t = 0, last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        t += dt;
        const open = Math.min(ease(t / 0.14), Math.max(0, Math.min(1, (total - t) / 0.16)));
        band.style.transform = `scaleY(${open})`;
        dim.style.opacity = String(open);
        portrait.style.transform = `translateX(${520 + (0 - 520) * ease(t / 0.28) - t * 36}px)`;
        words.style.transform = `translateX(${-420 + 420 * ease((t - 0.06) / 0.28) + t * 20}px)`;
        words.style.opacity = String(Math.max(0, Math.min(1, (t - 0.04) / 0.15)));
        for (const st of streaks) {
          st.x -= st.speed * dt;
          if (st.x < -700) st.x += 2600;
          st.s.style.left = st.x + 'px';
        }
        if (t < total) requestAnimationFrame(step);
        else {
          band.remove();
          dim.remove();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  // ---------- Home ----------

  showHome() {
    this.hud = null;
    const s = this.screen(null, { dim: false });
    const side = add(s, el('div', 'home-side'));
    add(side, el('div', 'logo', { backgroundImage: url(art.logo) }));
    add(side, el('div', null, { width: '160px', height: '3px', background: C.gold, marginBottom: '18px' }));
    add(side, text('อาการิ มิโกะจิ้งจอกเก้าหาง และเหล่าสหายผู้กล้า ออกเดินทางด้วยไพ่เวท\nฝ่าหมอกสีม่วง 3 บท เพื่อจุดโคมไฟให้สว่างอีกครั้ง', 24, C.ivory, 400, { whiteSpace: 'pre-line', marginBottom: '30px' }));
    this.button(side, 'เริ่มการเดินทาง', C.crimson, () => this.flow.startRun(), 520, 76, 30).style.marginBottom = '14px';
    const menu = add(side, el('div', null, { display: 'flex', flexWrap: 'wrap', width: '560px', gap: '12px' }));
    const small = (caption, fn) => this.button(menu, caption, C.purpleBtn, fn, 250, 58, 22);
    small('สุ่มกาชา', () => this.flow.openGacha());
    small('ทีมสหาย', () => this.flow.openTeam());
    small('คลังการ์ด', () => this.flow.openCollection());
    small('ภูตคู่หู', () => this.flow.openCompanions());
    small('เครื่องราง', () => this.flow.openTalismans());
    small(this.game.sound.muted ? 'เปิดเสียง' : 'ปิดเสียง', () => { this.game.sound.toggleMute(); this.showHome(); });

    const team = this.save.team.map((id) => Db.heroine(id)).filter(Boolean);
    const teamRow = add(side, el('div', 'row', { marginTop: '18px', gap: '10px' }));
    add(teamRow, text('ทีม', 20, C.gold, 700));
    if (team.length === 0) add(teamRow, text('ยังไม่มีสหาย  สุ่มกาชาเพื่อพบสหายคนแรก', 18, C.muted));
    for (const h of team) this.face(teamRow, 58, art.heroineFace(h.id), Db.elementColors[h.element], 3);
    add(side, text(`เล่นแล้ว ${this.save.runs} รอบ   ชนะ ${this.save.wins} รอบ   ไปได้ไกลสุด ${this.save.bestFloor} ชั้น`, 18, C.muted, 400, { marginTop: '14px' }));
    this.crystalPill(s, 40, 36);
  }

  // ---------- Map ----------

  showMap(run) {
    this.hud = null;
    const s = this.screen(null, { dim: false });
    this.runPanel(s, run);
    const frame = at(add(s, el('div', 'panel', { width: '1240px', height: '1000px', background: 'rgba(10,8,23,0.86)' })), 620, 40);
    at(add(frame, text(run.actDef.name, 34, C.gold, 700, { textAlign: 'center', textShadow: '0 2px 4px #000' })), 0, 16, 0);
    at(add(frame, text('เลือกเส้นทาง  จุดที่เรืองแสงคือทางที่ไปได้', 18, C.muted, 400, { textAlign: 'center' })), 0, 62, 0);
    const canvas = at(add(frame, el('div', null, { width: '1120px', height: '860px' })), 60, 110);
    const choices = run.choices();
    const center = (n) => ({ x: n.x * 1120, y: 860 - (n.row + 0.5) * (860 / RunState.rows) });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '1120');
    svg.setAttribute('height', '860');
    svg.style.position = 'absolute';
    for (const node of run.map) {
      for (const next of node.next) {
        const a = center(node), b = center(next);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }).forEach(([k, v]) => line.setAttribute(k, v));
        const travelled = node.done && (next.done || choices.includes(next));
        line.setAttribute('stroke', travelled ? 'rgba(227,191,122,0.8)' : 'rgba(227,191,122,0.22)');
        line.setAttribute('stroke-width', '3');
        svg.appendChild(line);
      }
    }
    canvas.appendChild(svg);
    for (const node of run.map) {
      const available = choices.includes(node);
      const boss = node.kind === NodeKind.Boss;
      const size = boss ? 130 : 84;
      const p = center(node);
      const color = NODE_COLORS[node.kind];
      const dot = at(add(canvas, el('div', 'map-dot' + (available ? ' go' : ''), {
        width: px(size), height: px(size), fontSize: (boss ? 26 : 18) + 'px',
        background: node.done ? '#332e40' : shade(color, 0.55),
        border: `${available ? 4 : 1}px solid ${available ? C.gold : 'rgba(227,191,122,0.35)'}`,
        opacity: node.done ? 0.55 : available || node.row > (run.current?.row ?? -1) ? 1 : 0.35,
      }, node.done ? 'ผ่าน' : Db.nodeNames[node.kind])), p.x - size / 2, p.y - size / 2);
      if (available) dot.addEventListener('pointerdown', this.click(() => this.flow.chooseNode(node)));
    }
  }

  runPanel(s, run) {
    const panel = at(add(s, el('div', 'panel', { width: '540px', padding: '24px 28px' })), 40, 40);
    add(panel, text('อาการิ', 34, C.gold, 700));
    add(panel, text(run.actDef.subtitle, 18, C.muted, 400, { marginBottom: '16px' }));
    this.bar(panel, 480, 30, C.hp).set(run.hp / run.maxHp, `${run.hp} / ${run.maxHp}`);
    const info = add(panel, el('div', null, { marginTop: '16px' }));
    const line = (label, value) => {
      const row = add(info, el('div', 'row', { justifyContent: 'space-between', marginBottom: '6px' }));
      add(row, text(label, 21, C.muted));
      add(row, text(value, 21, C.ivory, 700));
    };
    line('เหรียญ', String(run.gold));
    line('คริสตัลที่ได้รอบนี้', String(run.crystalsEarned));
    line('การ์ดในเด็ค', run.deck.length + ' ใบ');
    line('ชั้นที่ผ่าน', String(run.floor));
    const companion = Db.companion(this.save.activeCompanion);
    if (companion) line('ภูตคู่หู', companion.name);
    const team = this.save.team.map((id) => Db.heroine(id)).filter(Boolean).map((h) => h.name);
    if (team.length) line('ทีมสหาย', team.join(', '));
    const deck = add(panel, el('div', null, { marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }));
    const groups = new Map();
    for (const c of run.deck) {
      if (!groups.has(c.def.id)) groups.set(c.def.id, []);
      groups.get(c.def.id).push(c);
    }
    for (const g of groups.values()) {
      const first = g[0];
      this.chip(deck, first.def.name + (g.length > 1 ? ' x' + g.length : '') + (first.bonus > 0 ? ' +' + first.bonus : ''), Db.elementColors[first.def.element], 15);
    }
  }

  // ---------- Battle ----------

  showBattle() {
    const s = this.screen(null, { dim: false, through: true });
    this.hud = s;
    const flow = this.flow;

    const heroFrame = at(add(s, el('div', 'panel row', { padding: '12px 14px' })), 40, 30);
    this.face(heroFrame, 110, art.card('card_portrait'), C.gold, 3);
    const heroInfo = add(heroFrame, el('div', null, { marginLeft: '16px' }));
    add(heroInfo, text('อาการิ', 28, C.ivory, 700));
    this.heroHp = this.bar(heroInfo, 340, 28, C.hp);
    const heroRow = add(heroInfo, el('div', 'row', { marginTop: '8px', gap: '10px' }));
    this.heroBlock = this.chip(heroRow, '', C.sky, 17);
    this.heroStatus = add(heroRow, text('', 17, C.muted, 700));
    const wallet = add(heroInfo, el('div', 'row', { marginTop: '6px', gap: '18px' }));
    this.goldLabel = add(wallet, text('', 17, C.gold, 700));
    this.crystalLabel = add(wallet, text('', 17, C.sky, 700));

    const companion = Db.companion(this.save.activeCompanion);
    let top = 214;
    if (companion) {
      const owned = this.save.companion(companion.id);
      const chip = at(add(s, el('div', 'panel row', { padding: '8px 10px', borderColor: 'rgba(227,191,122,0.4)' })), 40, 214);
      this.face(chip, 54, art.portrait(companion.portrait), Db.elementColors[companion.element]);
      const words = add(chip, el('div', null, { marginLeft: '10px' }));
      add(words, text(`${companion.name}  Lv.${owned?.level ?? 1}`, 17, C.ivory, 700));
      add(words, text(companion.text.replace('{0}', companion.valueAt(owned?.level ?? 1)), 15, C.muted));
      top = 300;
    }
    const team = this.save.team.map((id) => Db.heroine(id)).filter(Boolean);
    if (team.length) {
      const box = at(add(s, el('div', 'panel row', { padding: '8px 12px', gap: '8px', borderColor: 'rgba(227,191,122,0.4)' })), 40, top);
      add(box, text('ทีม', 17, C.gold, 700, { marginRight: '2px' }));
      for (const h of team) this.face(box, 54, art.heroineFace(h.id), Db.elementColors[h.element]);
    }

    const enemyFrame = at(add(s, el('div', 'panel', { width: '480px', padding: '14px 20px' })), null, 30, 40);
    const nameRow = add(enemyFrame, el('div', 'row', { justifyContent: 'space-between' }));
    this.enemyName = add(nameRow, text('', 28, C.ivory, 700));
    this.enemyElement = add(nameRow, text('', 18, C.ivory, 700));
    this.enemyHp = this.bar(enemyFrame, 440, 28, C.violet);
    this.enemyHp.track.style.marginTop = '8px';
    this.enemyStatus = add(enemyFrame, text('', 17, C.muted, 700, { marginTop: '6px', minHeight: '22px' }));
    const intentBox = add(enemyFrame, el('div', null, { marginTop: '8px', background: 'rgba(64,13,26,0.9)', border: '1px solid #ff7373', borderRadius: '6px', padding: '6px 12px' }));
    this.intent = add(intentBox, text('', 22, '#ffdb9e', 700, { textAlign: 'center' }));

    const stagePill = at(add(s, el('div', 'panel', { padding: '6px 22px', transform: 'translateX(-50%)' })), 960, 30);
    this.stageLabel = add(stagePill, text('', 22, C.gold, 700));

    const orb = at(add(s, el('div', null, { width: '120px', height: '120px', borderRadius: '60px', background: C.night, border: `4px solid ${C.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px rgba(227,191,122,0.45)' })), 50, null, null, 300);
    this.energy = add(orb, text('', 40, C.gold, 700));
    at(add(s, text('พลังงาน', 18, C.muted, 700, { width: '120px', textAlign: 'center' })), 50, null, null, 268);
    this.piles = at(add(s, text('', 19, C.ivory, 700, { textShadow: '0 2px 4px #000' })), 200, null, null, 312);
    this.endTurn = at(this.button(s, 'จบเทิร์น  (E)', C.crimson, () => flow.endTurn(), 220, 70, 26), null, null, 50, 300);

    this.hand = at(add(s, el('div', null, { height: '290px', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', pointerEvents: 'none' })), 0, null, 0, 14);
    this.rebuildHand();
    this.refreshBattle();
  }

  rebuildHand() {
    const battle = this.flow.battle;
    if (!this.hand || !battle || !this.hud) return;
    this.hand.innerHTML = '';
    for (const card of battle.hand) {
      const mult = Db.multiplier(card.def.element, battle.enemy.element);
      const footer = (card.def.damage > 0 && mult > 1 ? 'ได้เปรียบ x1.5   ' : card.def.damage > 0 && mult < 1 ? 'เสียเปรียบ   ' : '') + 'Lv.' + card.effective;
      const view = this.cardView(this.hand, card.def, card.effective, () => {
        if (!this.flow.playCard(card) && !this.flow.busy && card.def.cost > battle.energy) this.toast('พลังงานไม่พอ');
      }, footer, 0.92, card.def.cost > battle.energy);
      view.style.margin = '0 -4px';
      view.style.pointerEvents = 'auto';
    }
  }

  refreshBattle() {
    const battle = this.flow.battle;
    if (!this.hud || !battle) return;
    const run = this.flow.run;
    this.heroHp.set(run.hp / run.maxHp, `${run.hp} / ${run.maxHp}`);
    this.heroBlock.style.display = battle.block > 0 ? 'inline-flex' : 'none';
    this.heroBlock.textContent = 'โล่ ' + battle.block;
    const status = [];
    if (battle.strength > 0) status.push('พลัง +' + battle.strength);
    if (battle.heroWeak > 0) status.push('อ่อนแอ ' + battle.heroWeak);
    if (battle.heroBurn > 0) status.push('ติดไฟ ' + battle.heroBurn);
    this.heroStatus.textContent = status.join('   ');
    this.goldLabel.textContent = 'เหรียญ ' + run.gold;
    this.crystalLabel.textContent = 'คริสตัล ' + this.save.crystals.toLocaleString('en-US');
    const e = battle.enemy;
    this.enemyName.textContent = e.name + (e.boss ? '  [บอส]' : e.elite ? '  [หัวหน้า]' : '');
    this.enemyElement.textContent = 'ธาตุ' + Db.elementNames[e.element];
    this.enemyElement.style.color = Db.elementColors[e.element];
    this.enemyHp.set(battle.enemyHp / battle.enemyMax, `${battle.enemyHp} / ${battle.enemyMax}`);
    const st = [];
    if (battle.enemyBlock > 0) st.push('โล่ ' + battle.enemyBlock);
    if (battle.enemyStrength > 0) st.push('พลัง +' + battle.enemyStrength);
    if (battle.enemyBurn > 0) st.push('เผาไหม้ ' + battle.enemyBurn);
    if (battle.enemyWeak > 0) st.push('อ่อนแอ ' + battle.enemyWeak);
    if (battle.enemyStun > 0) st.push('ถูกผนึก');
    this.enemyStatus.textContent = st.join('   ');
    this.intent.textContent = battle.won ? 'หลุดพ้นจากหมอกแล้ว' : battle.intentText();
    this.energy.textContent = `${battle.energy}/${battle.maxEnergy}`;
    this.piles.textContent = `กองจั่ว ${battle.drawPile.length}     กองทิ้ง ${battle.discard.length}`;
    this.stageLabel.textContent = `${run.actDef.name}   ชั้น ${run.floor + 1}`;
    this.endTurn.style.opacity = this.flow.busy ? '0.5' : '1';
  }

  // ---------- Node screens ----------

  dialog(title, width, height) {
    const s = this.screen(null);
    const panel = add(s, el('div', 'dialog', { width: px(width), height: px(height) }));
    add(panel, el('div', 'heading', { fontSize: '44px', textAlign: 'center' }, title));
    add(panel, el('div', 'line'));
    return panel;
  }

  showReward(gold, crystals, cards) {
    this.hud = null;
    const panel = this.dialog('ชนะแล้ว', 1160, 640);
    add(panel, text(`ได้รับ ${gold} เหรียญ  และ ${crystals} คริสตัล   เลือกการ์ด 1 ใบเข้าเด็ค`, 22, C.ivory, 400, { marginBottom: '18px' }));
    const row = add(panel, el('div', 'row'));
    for (const card of cards) this.cardView(row, card, this.save.cardLevel(card.id), () => this.flow.pickReward(card));
    this.button(panel, 'ข้าม', C.dark, () => this.flow.pickReward(null), 200, 56, 22).style.marginTop = '10px';
  }

  showShop(cards, sold, healed) {
    this.hud = null;
    const panel = this.dialog('ร้านของปู่พันดะ', 1500, 760);
    add(panel, text('เหรียญที่มี  ' + this.flow.run.gold, 24, C.gold, 700, { marginBottom: '14px' }));
    const row = add(panel, el('div', 'row'));
    cards.forEach((card, i) => {
      const col = add(row, el('div', 'col', { alignItems: 'center' }));
      this.cardView(col, card, this.save.cardLevel(card.id), sold[i] ? null : () => this.flow.shopBuy(i), null, 0.92, sold[i]);
      add(col, text(sold[i] ? 'ขายแล้ว' : RunState.price(card) + ' เหรียญ', 22, sold[i] ? C.muted : C.gold, 700));
    });
    const actions = add(panel, el('div', 'row', { marginTop: '22px', gap: '20px' }));
    if (!healed) this.button(actions, 'ฟื้นพลังชีวิต 25%  (40 เหรียญ)', C.teal, () => this.flow.shopHeal(), 420, 60, 22);
    this.button(actions, 'ออกจากร้าน', C.crimson, () => this.flow.leaveShop(), 260, 60, 24);
  }

  showRest() {
    this.hud = null;
    const panel = this.dialog('จุดพักโคมไฟ', 1000, 520);
    add(panel, text('เลือกอย่างใดอย่างหนึ่ง', 22, C.muted, 400, { marginBottom: '30px' }));
    const row = add(panel, el('div', 'row', { gap: '40px' }));
    this.button(row, 'พักผ่อน\nฟื้นพลังชีวิต 30%', C.teal, () => this.flow.restHeal(), 400, 200, 28);
    this.button(row, 'ฝึกฝน\nอัพเกรดการ์ด 1 ใบ', C.plum, () => this.showDeckPicker(), 400, 200, 28);
  }

  showDeckPicker() {
    const s = this.screen('เลือกการ์ดที่จะอัพเกรด');
    const scroll = at(add(s, el('div', 'scroll', { display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' })), 60, 130, 60, 40);
    for (const card of this.flow.run.deck) this.cardView(scroll, card.def, card.effective, () => this.flow.restUpgrade(card), `Lv.${card.effective} → ${card.effective + 1}`, 0.9);
  }

  showTreasure(gold, crystals) {
    this.hud = null;
    const panel = this.dialog('หีบสมบัติโคมไฟ', 860, 420);
    add(panel, text(`ได้รับ ${gold} เหรียญ`, 34, C.gold, 700, { marginTop: '20px' }));
    add(panel, text(`และ ${crystals} คริสตัล`, 34, C.sky, 700, { marginBottom: '40px' }));
    this.button(panel, 'เก็บของแล้วเดินทางต่อ', C.crimson, () => this.flow.closeTreasure(), 400, 64, 26);
  }

  showResult(victory, run) {
    this.hud = null;
    const panel = this.dialog(victory ? 'การเดินทางสำเร็จ' : 'อาการิหมดแรง', 900, 560);
    add(panel, text(victory ? 'โคมไฟทุกดวงสว่างอีกครั้ง หุบเขากลับมาสงบสุข' : 'หมอกยังไม่จางหาย แต่คริสตัลที่เก็บได้ยังอยู่กับเรา', 24, C.ivory, 400, { textAlign: 'center', marginBottom: '26px' }));
    add(panel, text(`ผ่านไป ${run.floor} ชั้น   ชนะ ${run.battles} การต่อสู้`, 26, C.muted, 700));
    add(panel, text('ได้คริสตัล ' + run.crystalsEarned, 34, C.sky, 700, { marginBottom: '36px' }));
    this.button(panel, 'กลับหมู่บ้าน', C.crimson, () => this.flow.goHome(), 320, 64, 26);
  }

  // ---------- Gacha ----------

  menuScreen(title) {
    const s = this.screen(title);
    this.crystalPill(s, 40, 36);
    at(this.button(s, 'กลับ  (Esc)', C.dark, () => this.flow.goHome(), 180, 54, 22), null, 110, 40);
    return s;
  }

  showGacha() {
    this.hud = null;
    const s = this.screen('เทศกาลโคมไฟ  สุ่มกาชา', { dim: false });
    s.style.background = 'rgba(8,5,20,0.35)';
    this.crystalPill(s, 40, 36);
    at(this.button(s, 'กลับ  (Esc)', C.dark, () => this.flow.goHome(), 180, 54, 22), null, 110, 40);
    at(add(s, el('div', 'panel', { width: '960px', height: '540px', backgroundImage: url(art.banner), backgroundSize: 'cover', border: `2px solid ${C.gold}`, borderRadius: '14px' })), null, 180, 60);
    const featured = at(add(s, el('div', 'panel row', { width: '960px', padding: '12px 20px', gap: '8px' })), null, 740, 60);
    add(featured, text('สหายที่สุ่มได้', 22, C.gold, 700, { marginRight: '10px' }));
    for (const h of Db.heroines.filter((x) => HeroineDef.hasArt(x.id))) {
      this.face(featured, 84, art.heroineFace(h.id), Db.elementColors[h.element], 3);
      const w = add(featured, el('div', null, { marginRight: '16px' }));
      add(w, text(h.name, 20, C.ivory, 700));
      add(w, text(`${Db.rarityNames[h.rarity]}  ธาตุ${Db.elementNames[h.element]}`, 15, Db.elementColors[h.element], 700));
    }

    const panel = at(add(s, el('div', 'panel', { width: '760px', padding: '30px 36px', border: `2px solid ${C.gold}`, borderRadius: '14px' })), 60, 140);
    add(panel, text('ภูตและไพ่เวทแห่งหุบเขา', 34, C.ivory, 700));
    add(panel, text('ใช้คริสตัลที่ได้จากการเดินทาง สุ่มรับการ์ด ภูตคู่หู และสหายร่วมทีม\nได้ของซ้ำจะเก็บไว้ใช้อัพเกรด  สุ่ม 10 ครั้งรับประกัน SR ขึ้นไป 1 ใบ', 20, C.muted, 400, { whiteSpace: 'pre-line', margin: '8px 0 20px' }));
    const rates = add(panel, el('div', 'row', { gap: '10px' }));
    const chances = ['48%', '35%', '14%', '3%'];
    for (let i = 3; i >= 0; i--) this.chip(rates, `${Db.rarityNames[i]}  ${chances[i]}`, Db.rarityColors[i], 18);
    add(panel, text(`SSR การันตีภายใน ${Db.ssrPity - this.save.pity} ครั้ง`, 22, C.gold, 700, { margin: '18px 0 26px' }));
    const buttons = add(panel, el('div', 'row', { gap: '24px' }));
    this.button(buttons, `สุ่ม 1 ครั้ง\n${Db.pullCost} คริสตัล`, '#334d8c', () => this.flow.pull(1), 320, 110, 24);
    this.button(buttons, `สุ่ม 10 ครั้ง\n${Db.tenPullCost} คริสตัล`, C.crimson, () => this.flow.pull(10), 320, 110, 24);
  }

  showPullResults(results) {
    const s = this.screen('ผลการสุ่ม');
    this.crystalPill(s, 40, 36);
    const grid = at(add(s, el('div', null, { display: 'flex', flexWrap: 'wrap', justifyContent: 'center' })), 80, 150, 80);
    results.forEach((r, i) => {
      const color = Db.rarityColors[r.rarity];
      const tile = add(grid, el('div', 'col', {
        width: '300px', height: '330px', margin: '0 12px 18px', padding: '12px', alignItems: 'center', borderRadius: '12px',
        background: shade(color, 0.18, 0.96), border: `${r.rarity >= Rarity.SR ? 4 : 2}px solid ${color}`,
        opacity: '0', transform: 'scale(0.6)', transition: 'opacity 0.25s, transform 0.25s',
        boxShadow: r.rarity === Rarity.SSR ? `0 0 30px ${color}` : 'none',
      }));
      const pic = add(tile, el('div', null, { width: '270px', height: '200px', borderRadius: '8px', background: shade(color, 0.35), backgroundRepeat: 'no-repeat', flex: 'none' }));
      if (r.isHeroine) {
        this.picture(pic, art.heroineFace(r.id), 270, 0, -35);
        pic.style.border = `3px solid ${Db.elementColors[Db.heroine(r.id).element]}`;
      } else if (r.isCompanion) this.picture(pic, art.portrait(Db.companion(r.id).portrait), 270, 0, -35);
      else this.picture(pic, art.card(Db.card(r.id).art), 310, -20, -16);
      const tags = add(tile, el('div', 'row', { marginTop: '10px', gap: '8px' }));
      this.chip(tags, Db.rarityNames[r.rarity], color, 18);
      this.chip(tags, r.isHeroine ? 'สหาย' : r.isCompanion ? 'ภูตคู่หู' : 'การ์ด', r.isHeroine ? C.gold : C.muted, 16);
      if (r.isNew) this.chip(tags, 'ใหม่!', C.gold, 16);
      add(tile, text(r.name, 22, C.ivory, 700, { marginTop: '8px', textAlign: 'center' }));
      setTimeout(() => { tile.style.opacity = '1'; tile.style.transform = 'scale(1)'; }, this.game.fast ? 0 : 150 + i * 160);
    });
    const actions = at(add(s, el('div', 'row', { justifyContent: 'center', gap: '20px' })), 0, null, 0, 40);
    this.button(actions, 'สุ่มต่อ', '#334d8c', () => this.flow.openGacha(), 240, 64, 24);
    this.button(actions, 'กลับหมู่บ้าน', C.crimson, () => this.flow.goHome(), 260, 64, 24);
  }

  // ---------- Collection, companions, team, talismans ----------

  upgradeButton(parent, owned, fn, width, height, size) {
    const can = this.save.canUpgrade(owned);
    const b = this.button(parent, 'อัพ ' + SaveData.upgradeCrystals(owned.level), can ? C.plum : C.off, fn, width, height, size);
    if (!can) b.classList.add('off');
    return b;
  }

  showCollection() {
    this.hud = null;
    const s = this.menuScreen('คลังการ์ด');
    at(add(s, text(`ได้การ์ดซ้ำจากกาชา ใช้ซ้ำ + คริสตัล อัพเกรดได้ถึง Lv.${Db.maxLevel}  การ์ดที่อัพแล้วแรงขึ้นทุกการเดินทาง`, 20, C.muted)), 62, 104);
    const scroll = at(add(s, el('div', 'scroll', { display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' })), 50, 180, 50, 30);
    const cards = Db.cards.filter((c) => !c.heroineId).sort((a, b) => a.element - b.element || a.rarity - b.rarity);
    for (const def of cards) {
      const owned = this.save.card(def.id);
      const col = add(scroll, el('div', 'col', { alignItems: 'center', marginBottom: '14px' }));
      this.cardView(col, def, owned?.level ?? 1, null, owned ? 'Lv.' + owned.level : 'ยังไม่ได้รับ', 0.82, !owned);
      if (owned) {
        const max = owned.level >= Db.maxLevel;
        add(col, text(max ? 'ระดับสูงสุด' : `ซ้ำ ${owned.copies} / ${owned.level}`, 16, C.muted));
        if (!max) this.upgradeButton(col, owned, () => this.flow.upgradeCard(def.id), 150, 40, 17);
      }
    }
  }

  showCompanions() {
    this.hud = null;
    const s = this.menuScreen('ภูตคู่หู');
    const scroll = at(add(s, el('div', 'scroll')), 60, 170, 60, 30);
    for (const def of Db.companions) {
      const owned = this.save.companion(def.id);
      const active = def.id === this.save.activeCompanion;
      const row = add(scroll, el('div', 'panel row', { padding: '14px 18px', marginBottom: '12px', opacity: owned ? 1 : 0.45, border: `${active ? 3 : 1}px solid ${active ? C.gold : 'rgba(227,191,122,0.3)'}` }));
      this.face(row, 110, art.portrait(def.portrait), Db.rarityColors[def.rarity], 3);
      const words = add(row, el('div', null, { marginLeft: '22px', flex: '1' }));
      const title = add(words, el('div', 'row', { gap: '10px' }));
      add(title, text(def.name, 28, C.ivory, 700));
      this.chip(title, Db.rarityNames[def.rarity], Db.rarityColors[def.rarity], 16);
      this.chip(title, 'ธาตุ' + Db.elementNames[def.element], Db.elementColors[def.element], 16);
      const level = owned?.level ?? 1;
      add(words, text(def.text.replace('{0}', def.valueAt(level)), 21, C.muted, 400, { marginTop: '6px' }));
      add(words, text(owned ? `Lv.${level}   ซ้ำ ${owned.copies} / ${level}` : 'ยังไม่ได้รับ  สุ่มกาชาเพื่อพบภูตตัวนี้', 18, C.gold, 700, { marginTop: '4px' }));
      if (!owned) continue;
      if (!active) this.button(row, 'เลือกเป็นคู่หู', C.teal, () => this.flow.setCompanion(def.id), 220, 56, 21).style.marginRight = '12px';
      else add(row, text('กำลังร่วมทาง', 21, C.gold, 700, { marginRight: '24px' }));
      if (owned.level < Db.maxLevel) this.upgradeButton(row, owned, () => this.flow.upgradeCompanion(def.id), 170, 56, 21);
    }
  }

  showTeam() {
    this.hud = null;
    const s = this.menuScreen('ทีมสหาย');
    const save = this.save;
    at(add(s, text(`เลือกสหายร่วมทางได้ ${Db.teamSize} คน  แต่ละคนเพิ่มพลังชีวิตสูงสุด และใส่การ์ดท่าไม้ตายของเธอ 2 ใบในเด็ค`, 20, C.muted)), 62, 104);
    const slots = at(add(s, el('div', 'row', { gap: '24px' })), 60, 150);
    for (let i = 0; i < Db.teamSize; i++) {
      const def = i < save.team.length ? Db.heroine(save.team[i]) : null;
      const slot = add(slots, el('div', null, { position: 'relative', width: '460px', height: '230px', borderRadius: '14px', overflow: 'hidden' }));
      if (!def) {
        Object.assign(slot.style, { background: 'rgba(15,11,33,0.88)', border: '1px solid rgba(227,191,122,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' });
        add(slot, text('ช่องว่าง', 26, C.muted, 700));
        add(slot, text('เลือกสหายจากรายชื่อด้านล่าง', 17, C.muted));
        continue;
      }
      Object.assign(slot.style, { border: `3px solid ${Db.elementColors[def.element]}`, backgroundImage: url(art.heroineWide(def.id)), backgroundSize: 'cover', cursor: 'pointer' });
      const cap = at(add(slot, el('div', 'row', { justifyContent: 'space-between', background: 'rgba(8,5,20,0.8)', padding: '6px 16px' })), 0, null, 0, 0);
      add(cap, text(`${def.name}  Lv.${save.heroine(def.id)?.level ?? 1}`, 24, C.ivory, 700));
      add(cap, text('คลิกเพื่อถอดออก', 15, C.muted));
      slot.addEventListener('pointerdown', this.click(() => this.flow.toggleTeam(def.id)));
    }
    const scroll = at(add(s, el('div', 'scroll')), 60, 404, 60, 30);
    for (const def of Db.heroines) {
      const available = HeroineDef.hasArt(def.id);
      const owned = save.heroine(def.id);
      const inTeam = save.team.includes(def.id);
      const element = Db.elementColors[def.element];
      const level = owned?.level ?? 1;
      const card = Db.card(def.cardId);
      const row = add(scroll, el('div', 'panel row', { padding: '12px 18px', marginBottom: '12px', opacity: owned ? 1 : 0.5, border: `${inTeam ? 3 : 1}px solid ${inTeam ? C.gold : 'rgba(227,191,122,0.3)'}` }));
      const face = this.face(row, 116, available ? art.heroineFace(def.id) : null, element, 3);
      face.style.background = available ? `${url(art.heroineFace(def.id))} center/cover, ${shade(element, 0.3)}` : shade(element, 0.3);
      if (!available) Object.assign(face.style, { display: 'flex', alignItems: 'center', justifyContent: 'center' }), add(face, text('?', 54, tint(element, 0.4), 700));
      const words = add(row, el('div', null, { marginLeft: '22px', flex: '1', minWidth: '0' }));
      const title = add(words, el('div', 'row', { gap: '10px' }));
      add(title, text(def.name, 30, C.ivory, 700));
      this.chip(title, Db.rarityNames[def.rarity], Db.rarityColors[def.rarity], 16);
      this.chip(title, 'ธาตุ' + Db.elementNames[def.element], element, 16);
      add(title, text(def.title, 19, C.muted));
      add(words, text(def.text, 19, C.muted, 400, { marginTop: '4px' }));
      add(words, text(`พลังชีวิตสูงสุด +${def.hpAt(level)}     ท่าไม้ตาย  ${card.name} x2  :  ${card.describe(level)}`, 19, tint(element, 0.45), 700, { marginTop: '4px' }));
      add(words, text(!available ? 'เร็ว ๆ นี้' : !owned ? 'ยังไม่ได้รับ  สุ่มกาชาเพื่อพบสหายคนนี้' : `Lv.${level}   ซ้ำ ${owned.copies} / ${level}`, 18, C.gold, 700, { marginTop: '4px' }));
      if (!owned) continue;
      if (inTeam) this.button(row, 'ถอดออกจากทีม', '#66293a', () => this.flow.toggleTeam(def.id), 230, 56, 20).style.marginRight = '12px';
      else {
        const room = save.team.length < Db.teamSize;
        const b = this.button(row, 'ใส่ในทีม', room ? C.teal : C.off, () => this.flow.toggleTeam(def.id), 230, 56, 20);
        b.style.marginRight = '12px';
        if (!room) b.classList.add('off');
      }
      if (owned.level < Db.maxLevel) this.upgradeButton(row, owned, () => this.flow.upgradeHeroine(def.id), 170, 56, 20);
      else add(row, text('ระดับสูงสุด', 20, C.gold, 700));
    }
  }

  showTalismans() {
    this.hud = null;
    const s = this.menuScreen('เครื่องราง');
    at(add(s, text('พลังถาวรที่ติดตัวอาการิไปทุกการเดินทาง', 20, C.muted)), 62, 104);
    const list = at(add(s, el('div')), 60, 170, 60);
    Db.talismans.forEach((def, i) => {
      const level = this.save.talisman(i);
      const row = add(list, el('div', 'panel row', { padding: '16px 24px', marginBottom: '12px', borderColor: 'rgba(227,191,122,0.4)' }));
      const words = add(row, el('div', null, { flex: '1' }));
      add(words, text(def.name, 28, C.ivory, 700));
      add(words, text(def.text, 20, C.muted));
      const pips = add(row, el('div', 'row', { gap: '10px', marginRight: '30px' }));
      for (let p = 0; p < def.maxLevel; p++) add(pips, el('div', null, { width: '20px', height: '20px', transform: 'rotate(45deg)', borderRadius: '3px', border: `1px solid ${C.gold}`, background: p < level ? C.gold : '#261f38' }));
      if (level >= def.maxLevel) add(row, text('ครบแล้ว', 22, C.gold, 700));
      else {
        const can = this.save.crystals >= def.costAt(level);
        const b = this.button(row, 'ซื้อ ' + def.costAt(level), can ? C.crimson : C.off, () => this.flow.buyTalisman(i), 200, 56, 22);
        if (!can) b.classList.add('off');
      }
    });
  }
}
