// Lantern Cards - flow controller (state logic of LcGame.cs).
// Owns the flow between home, menus, map, nodes and battles. All presentation goes through `view`
// (every view method is optional). Pure ES module: no DOM, no three.js, no Node APIs.

import { Db, NodeKind, Rarity } from './data.js';
import { Rng, SaveSystem, Gacha, RunState, BattleState, hpScaleFor } from './core.js';

export class Flow {
  /** What the developer top-up fills the crystals to. */
  static devCrystals = 9_999_999;

  /**
   * @param {{ view?: object|null, rng?: Rng, save?: import('./core.js').SaveData }} [options]
   * Call goHome() once the view is ready (LcGame.Start does the same).
   */
  constructor({ view = null, rng = new Rng(), save = SaveSystem.load() } = {}) {
    this.view = view;
    this.rng = rng;
    this.save = save;
    this.run = null;
    this.battle = null;
    this.busy = false;
    this.screen = 'home';
    this.lastPull = null;
    this.lastRewardChoices = null;
    this.shopCards = null;
    this.shopSold = null;
    this.shopHealed = false;
    this.pendingNode = null;
    /** Promise of the battle presentation in progress (or the last one). */
    this.pending = null;
  }

  get screenName() { return this.screen; }

  /** Test hook: swap in a separate save so automated tests never touch the player's progress. */
  useSave(data) { this.save = data; }

  persist() { SaveSystem.save(this.save); }

  toast(text) { this.view?.toast?.(text); }

  sound(name) { this.view?.sound?.(name); }

  /** Resolves once no battle presentation is running. */
  async idle() {
    for (let guard = 0; this.busy && guard < 100000; guard++) {
      const pending = this.pending;
      if (pending) {
        try { await pending; } catch { /* surfaced by whoever started it */ }
      }
      if (this.busy) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // ---------- Home and menus ----------

  goHome() {
    this.screen = 'home';
    this.run = null;
    this.battle = null;
    this.busy = false;
    this.persist();
    this.view?.home?.();
  }

  openGacha() {
    this.screen = 'gacha';
    this.view?.gacha?.();
  }

  openCollection() {
    this.screen = 'collection';
    this.view?.collection?.();
  }

  openCompanions() {
    this.screen = 'companions';
    this.view?.companions?.();
  }

  openTalismans() {
    this.screen = 'talismans';
    this.view?.talismans?.();
  }

  openTeam() {
    this.screen = 'team';
    this.view?.team?.();
  }

  /** Adds a heroine to the team, or takes her out. Returns false when she is not owned or the team is full. */
  toggleTeam(id) {
    const ok = this.save.toggleTeam(id);
    if (ok) this.persist();
    else if (this.save.heroine(id) != null) this.toast('ทีมเต็มแล้ว  ถอดสหายออกก่อน (สูงสุด ' + Db.teamSize + ' คน)');
    if (this.screen === 'team') this.view?.team?.();
    return ok;
  }

  upgradeHeroine(id) {
    const ok = this.save.upgrade(this.save.heroine(id));
    if (ok) {
      this.persist();
      this.toast('อัพเกรด ' + Db.heroine(id).name + ' เป็น Lv.' + this.save.heroine(id).level);
    } else this.toast('ต้องมีสหายซ้ำและคริสตัลพอ');
    if (this.screen === 'team') this.view?.team?.();
    return ok;
  }

  /** Developer tool (see Dev in ui.js): fills the crystals up so the gacha and upgrades can be tried freely. */
  devCrystals() {
    this.save.crystals = Math.max(this.save.crystals, Flow.devCrystals);
    this.persist();
    this.toast('เติมคริสตัลเป็น ' + this.save.crystals.toLocaleString('en-US'));
    // Menu screens draw their buttons from the amount, so draw them again.
    if (['collection', 'companions', 'talismans', 'team'].includes(this.screen)) this.view?.[this.screen]?.();
  }

  pull(count) {
    const cost = count >= 10 ? Db.tenPullCost : Db.pullCost * count;
    if (this.save.crystals < cost) {
      this.toast('คริสตัลไม่พอ  ออกเดินทางเพื่อเก็บเพิ่ม');
      return false;
    }
    this.save.crystals -= cost;
    this.lastPull = Gacha.pull(this.save, count, this.rng);
    this.persist();
    this.sound(this.lastPull.some(r => r.rarity === Rarity.SSR) ? 'level' : 'lantern');
    this.screen = 'gacha';
    this.view?.pullResults?.(this.lastPull);
    return true;
  }

  upgradeCard(id) {
    const ok = this.save.upgrade(this.save.card(id));
    if (ok) {
      this.persist();
      this.toast('อัพเกรด ' + Db.card(id).name + ' เป็น Lv.' + this.save.card(id).level);
    } else this.toast('ต้องมีการ์ดซ้ำและคริสตัลพอ');
    this.view?.collection?.();
    return ok;
  }

  upgradeCompanion(id) {
    const ok = this.save.upgrade(this.save.companion(id));
    if (ok) {
      this.persist();
      this.toast('อัพเกรด ' + Db.companion(id).name);
    } else this.toast('ต้องมีภูตซ้ำและคริสตัลพอ');
    this.view?.companions?.();
    return ok;
  }

  setCompanion(id) {
    if (this.save.companion(id) == null) return;
    this.save.activeCompanion = id;
    this.persist();
    this.view?.companions?.();
  }

  buyTalisman(index) {
    const ok = this.save.buyTalisman(index);
    if (ok) {
      this.persist();
      this.toast(Db.talismans[index].name + ' ระดับ ' + this.save.talisman(index));
    } else this.toast('คริสตัลไม่พอ');
    this.view?.talismans?.();
    return ok;
  }

  // ---------- Run flow ----------

  startRun() {
    this.run = RunState.begin(this.save, this.rng);
    this.save.runs++;
    this.persist();
    this.showMap(true);
  }

  /** Internal. chapter: true where LcGame shows the ChapterCard (run start and each new act). */
  showMap(chapter = false) {
    this.screen = 'map';
    this.battle = null;
    this.view?.map?.(this.run, { chapter });
  }

  chooseNode(node) {
    if (this.run == null || this.busy || !this.run.choices().includes(node)) return false;
    this.pendingNode = node;
    switch (node.kind) {
      case NodeKind.Battle:
      case NodeKind.Elite:
      case NodeKind.Boss:
        this.startBattle(node);
        break;
      case NodeKind.Shop:
        this.screen = 'shop';
        this.shopCards = this.run.rewardChoices(5, false);
        this.shopSold = new Array(this.shopCards.length).fill(false);
        this.shopHealed = false;
        this.view?.shop?.(this.shopCards, this.shopSold, this.shopHealed);
        break;
      case NodeKind.Rest:
        this.screen = 'rest';
        this.view?.rest?.();
        break;
      default: {
        this.screen = 'treasure';
        const gold = 40 + this.rng.next(31);
        this.run.gold += gold;
        const crystals = this.run.crystalReward(30);
        this.persist();
        this.view?.treasure?.(gold, crystals);
        break;
      }
    }
    return true;
  }

  /** Internal. */
  completeNode() {
    const node = this.pendingNode;
    const run = this.run;
    node.done = true;
    run.current = node;
    run.floor++;
    this.save.bestFloor = Math.max(this.save.bestFloor, run.floor);
    if (node.kind === NodeKind.Boss) {
      if (run.act < Db.acts.length - 1) {
        run.act++;
        run.buildMap();
        run.hp = Math.min(run.maxHp, run.hp + Math.trunc(run.maxHp * 3 / 10));
        this.persist();
        this.showMap(true);
        return;
      }
      this.endRun(true);
      return;
    }
    this.persist();
    this.showMap(false);
  }

  /** Internal. */
  endRun(victory) {
    this.screen = 'result';
    this.run.over = true;
    this.run.victory = victory;
    if (victory) this.save.wins++;
    this.persist();
    this.view?.result?.(victory, this.run);
  }

  // ---------- Battle ----------

  /** Internal. */
  startBattle(node) {
    const run = this.run;
    this.screen = 'battle';
    const enemy = run.pickEnemy(node.kind);
    this.battle = new BattleState({ hpScale: hpScaleFor(node) });
    enemy.elite = node.kind === NodeKind.Elite;
    enemy.boss = node.kind === NodeKind.Boss;
    const companion = Db.companion(this.save.activeCompanion);
    const companionLevel = companion != null ? this.save.companion(companion.id)?.level ?? 1 : 1;
    const events = this.battle.begin(run, enemy, companion, companionLevel);
    const boss = node.kind === NodeKind.Boss;
    this.view?.battleStart?.({
      act: run.actDef,
      enemy,
      companion,
      companionLevel,
      node,
      boss,
      chapter: boss ? { title: enemy.name, subtitle: 'บอสประจำบทที่ ' + (run.act + 1) } : null,
    });
    this.pending = this.present(events);
  }

  playCard(card) {
    if (this.busy || this.battle == null || !this.battle.canPlay(card)) {
      if (this.battle != null && !this.busy && card && card.def.cost > this.battle.energy) this.toast('พลังงานไม่พอ');
      return false;
    }
    const events = this.battle.play(card);
    this.view?.rebuildHand?.();
    this.pending = this.present(events);
    return true;
  }

  /** C# returns void; here it also returns whether the turn was ended. */
  endTurn() {
    if (this.busy || this.battle == null || this.battle.won || this.battle.lost) return false;
    const events = this.battle.endTurn();
    this.view?.rebuildHand?.();
    this.pending = this.present(events);
    return true;
  }

  /** Internal: plays the events through the view, then resolves the battle (end of LcGame.Present). */
  async present(events) {
    this.busy = true;
    this.view?.refresh?.();
    try {
      await this.view?.present?.(events);
    } catch (e) {
      console.error('[LanternCards] view.present failed', e);
    }
    this.busy = false;
    this.view?.rebuildHand?.();
    this.view?.refresh?.();

    if (this.battle != null && this.battle.won) this.battleWon();
    else if (this.battle != null && this.battle.lost) this.endRun(false);
  }

  /** Internal. */
  battleWon() {
    const run = this.run;
    this.screen = 'reward';
    const kind = this.pendingNode.kind;
    const gold = kind === NodeKind.Boss ? 90 : kind === NodeKind.Elite ? 40 + this.rng.next(15) : 14 + this.rng.next(12);
    const crystals = run.crystalReward(kind === NodeKind.Boss ? 120 + 40 * run.act : kind === NodeKind.Elite ? 45 : 15 + run.floor);
    run.gold += gold;
    run.battles++;
    this.persist();
    const choices = run.rewardChoices(3 + this.save.talisman(2), kind !== NodeKind.Battle);
    this.lastRewardChoices = choices;
    this.view?.reward?.(gold, crystals, choices);
  }

  pickReward(card) {
    if (this.screen !== 'reward') return;
    if (card != null) {
      this.run.addCard(card.id);
      this.toast('ได้การ์ด ' + card.name);
    }
    this.completeNode();
  }

  // ---------- Shop, rest and treasure ----------

  shopBuy(index) {
    if (this.screen !== 'shop' || this.shopCards == null || index < 0 || index >= this.shopCards.length || this.shopSold[index]) return false;
    const card = this.shopCards[index];
    const price = RunState.price(card);
    if (this.run.gold < price) {
      this.toast('เหรียญไม่พอ');
      return false;
    }
    this.run.gold -= price;
    this.run.addCard(card.id);
    this.shopSold[index] = true;
    this.view?.shop?.(this.shopCards, this.shopSold, this.shopHealed);
    this.toast('ซื้อ ' + card.name);
    return true;
  }

  shopHeal() {
    if (this.screen !== 'shop' || this.shopHealed || this.run.gold < 40) return;
    this.run.gold -= 40;
    this.run.hp = Math.min(this.run.maxHp, this.run.hp + Math.trunc(this.run.maxHp / 4));
    this.shopHealed = true;
    this.view?.shop?.(this.shopCards, this.shopSold, this.shopHealed);
  }

  leaveShop() {
    if (this.screen === 'shop') this.completeNode();
  }

  restHeal() {
    if (this.screen !== 'rest') return;
    this.run.hp = Math.min(this.run.maxHp, this.run.hp + Math.trunc(this.run.maxHp * 3 / 10));
    this.completeNode();
  }

  restUpgrade(card) {
    if (this.screen !== 'rest') return;
    card.bonus++;
    this.toast(card.def.name + ' แรงขึ้นเป็น Lv.' + card.effective);
    this.completeNode();
  }

  closeTreasure() {
    if (this.screen === 'treasure') this.completeNode();
  }
}
