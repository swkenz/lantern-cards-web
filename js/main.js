// Lantern Cards (web): wires the game flow to the 3D stage, the HTML interface and the sound.
import { Db, Motion } from './data.js';
import { Ev, SaveSystem } from './core.js';
import { Flow } from './flow.js';
import { Stage } from './stage.js';
import { Ui, Dev } from './ui.js';
import { Sound } from './audio.js';

Db.acts.forEach((act, i) => { act.arenaKey = 'act' + (i + 1); });

const params = new URLSearchParams(location.search);
// ?test plays on a separate save, so testing never touches real progress.
if (params.has('test')) SaveSystem.overrideKey = 'lanterncards.test';
// ?dev turns developer mode on for this device (?dev=0 turns it off); see Dev in ui.js.
if (params.has('dev')) Dev.set(params.get('dev') !== '0');

class Game {
  constructor() {
    this.fast = params.has('fast');
    Stage.fast = this.fast;
    this.sound = new Sound();
    this.stage = new Stage(document.getElementById('view'));
    this.ui = new Ui(this);
    this.flow = new Flow({ view: this.view() });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('pointerdown', () => this.sound.unlock(), { once: true });
  }

  async start() {
    const bar = document.querySelector('#loading .fillbar');
    const msg = document.querySelector('#loading .msg');
    try {
      await this.stage.init((k) => { bar.style.width = Math.round(k * 100) + '%'; });
    } catch (e) {
      msg.textContent = 'โหลดโมเดลไม่สำเร็จ: ' + e.message;
      throw e;
    }
    msg.textContent = 'พร้อมแล้ว';
    this.flow.goHome();
    // Warm the team's 3D heroines (parsing and colouring them takes a moment) so battles start instantly.
    setTimeout(() => {
      for (const id of this.flow.save.team) {
        const h = Db.heroine(id);
        if (h) this.stage.heroineModel(h.id, h.element);
      }
    }, 1500);
    const loading = document.getElementById('loading');
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 700);
    window.lc = this; // handy for testing from the console
  }

  key(e) {
    const screen = this.flow.screen;
    if (e.key === 'Escape' && ['gacha', 'collection', 'companions', 'talismans', 'team'].includes(screen)) this.flow.goHome();
    if ((e.key === 'e' || e.key === 'E') && screen === 'battle') this.flow.endTurn();
  }

  wait(seconds) {
    return this.stage.wait(seconds);
  }

  /** The view the Flow talks to: every screen change and battle event lands here. */
  view() {
    const game = this;
    return {
      home: () => { game.stage.showHome(); game.ui.showHome(); },
      gacha: () => { game.stage.showGacha(); game.ui.showGacha(); },
      pullResults: (results) => { game.stage.showGacha(); game.ui.showPullResults(results); },
      collection: () => game.ui.showCollection(),
      companions: () => game.ui.showCompanions(),
      talismans: () => game.ui.showTalismans(),
      team: () => game.ui.showTeam(),
      map: (run, { chapter }) => {
        game.stage.showMap(run.actDef);
        game.ui.showMap(run);
        if (chapter) game.ui.chapterCard(run.actDef.name, run.actDef.subtitle);
      },
      battleStart: async ({ act, enemy, companion, chapter }) => {
        game.ui.showBattle();
        if (chapter) game.ui.chapterCard(chapter.title, chapter.subtitle);
        const team = game.flow.save.team.map((id) => Db.heroine(id)).filter(Boolean);
        game.battleReady = game.stage.beginBattle(act, enemy, companion, team);
        await game.battleReady;
      },
      present: (events) => game.present(events),
      rebuildHand: () => game.ui.rebuildHand(),
      refresh: () => game.ui.refreshBattle(),
      reward: (gold, crystals, cards) => game.ui.showReward(gold, crystals, cards),
      shop: (cards, sold, healed) => game.ui.showShop(cards, sold, healed),
      rest: () => game.ui.showRest(),
      treasure: (gold, crystals) => game.ui.showTreasure(gold, crystals),
      result: (victory, run) => game.ui.showResult(victory, run),
      toast: (text) => game.ui.toast(text),
      sound: (name) => game.sound.play(name),
    };
  }

  /** Plays a list of battle events on the stage (port of LcGame.Present). */
  async present(events) {
    const stage = this.stage, ui = this.ui, play = (n) => this.sound.play(n);
    if (this.battleReady) await this.battleReady;
    let heroOut = false, enemyOut = false;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.kind) {
        case Ev.HeroMotion:
          heroOut = true;
          if (e.heroineId) {
            play('level');
            await ui.cutIn(Db.heroine(e.heroineId), e.text);
            play('skill');
          } else {
            ui.toast(e.text);
            play(e.motion === Motion.Spell || e.motion === Motion.Focus ? 'skill' : 'swing');
          }
          await stage.heroAct(e.motion, e.element, e.heroineId, events.slice(i + 1).some((x) => x.kind === Ev.EnemyHit));
          break;
        case Ev.EnemyHit: {
          const crit = e.mult > 1;
          play(crit ? 'crit' : 'hit');
          stage.enemyHurt(e.amount, e.element, crit);
          if (crit || e.amount >= 15) {
            const [r, g, b] = Db.elementRgb[e.element] || [1, 1, 1];
            const mix = (v) => Math.round((v + (1 - v) * 0.5) * 255);
            ui.flash(`rgb(${mix(r)},${mix(g)},${mix(b)})`, e.amount >= 15 ? 0.45 : 0.3);
          }
          const tag = crit ? '  ได้เปรียบ!' : e.mult < 1 ? '  ต้านทาน' : '';
          ui.float(stage.enemyChest, (e.text ?? String(e.amount)) + tag, crit ? '#ffd959' : '#ffffff', crit);
          ui.refreshBattle();
          await this.wait(0.16);
          break;
        }
        case Ev.Burn:
          stage.burnFx();
          ui.float(stage.enemyChest, e.amount + ' เผาไหม้', '#ff8c40');
          ui.refreshBattle();
          await this.wait(0.35);
          break;
        case Ev.HeroBlock:
          play('block');
          stage.heroBlock();
          ui.float(stage.heroChest, 'โล่ +' + e.amount, '#8ccbff');
          break;
        case Ev.HeroHeal:
          play('potion');
          stage.heroHeal();
          ui.float(stage.heroChest, '+' + e.amount, '#73ff99');
          break;
        case Ev.EnemyStatus:
          stage.statusFx(true, e.element);
          ui.float(stage.enemyTop, e.text, Db.elementColors[e.element]);
          break;
        case Ev.HeroStatus:
          stage.statusFx(false, e.element);
          ui.float(stage.heroChest.setY(stage.heroChest.y + 0.8), e.text, Db.elementColors[e.element]);
          await this.wait(0.3);
          break;
        case Ev.CompanionAct: {
          const attack = i + 1 < events.length && events[i + 1].kind === Ev.EnemyHit;
          await stage.companionAct(e.element, attack);
          if (e.text) ui.float(stage.heroChest.setY(stage.heroChest.y + 0.6), e.text, Db.elementColors[e.element]);
          break;
        }
        case Ev.EnemyMotion:
          if (heroOut) {
            await stage.heroReturn();
            heroOut = false;
          }
          await this.wait(0.25);
          await stage.enemyAttack(e.element);
          enemyOut = true;
          break;
        case Ev.HeroHit:
          play('hit');
          stage.heroHurt(e.amount, e.amount >= 12);
          ui.float(stage.heroChest, e.text != null && e.amount === 0 ? e.text : e.amount + (e.text != null ? ' ' + e.text : ''), '#ff6673', e.amount >= 12);
          ui.refreshBattle();
          await this.wait(0.25);
          if (enemyOut && (i + 1 >= events.length || events[i + 1].kind !== Ev.EnemyMotion)) {
            await stage.enemyReturn();
            enemyOut = false;
          }
          break;
        case Ev.EnemyBlock:
          await this.wait(0.25);
          stage.enemyBlockFx();
          ui.float(stage.enemyTop, 'ตั้งโล่ ' + e.amount, '#8ccbff');
          await this.wait(0.4);
          break;
        case Ev.EnemyBuff:
          await this.wait(0.25);
          stage.enemyBuffFx();
          ui.float(stage.enemyTop, e.text, '#ff7373');
          await this.wait(0.5);
          break;
        case Ev.Message:
          ui.toast(e.text);
          await this.wait(0.6);
          break;
        case Ev.Draw:
          ui.rebuildHand();
          break;
        case Ev.EnemyDefeated:
          if (heroOut) {
            await stage.heroReturn();
            heroOut = false;
          }
          play('death');
          await stage.enemyDefeated();
          play('quest');
          break;
        case Ev.HeroDefeated:
          await stage.heroDefeated();
          break;
      }
    }
    if (heroOut) await stage.heroReturn();
    if (enemyOut) await stage.enemyReturn();
  }
}

const game = new Game();
game.start();
