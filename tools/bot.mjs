// Lantern Cards bot test (port of LcProbe.cs): gacha, upgrades, saving, and complete runs played by a bot.
// Usage: node tools/bot.mjs [--seed N] [--runs N]
import { registerHooks } from 'node:module';

// The project's package.json says "type": "commonjs", so Node would load js/*.js as CommonJS.
// Force the game modules to load as ES modules (they are plain browser ESM).
const jsDir = new URL('../js/', import.meta.url).href;
if (typeof registerHooks === 'function') {
  registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith(jsDir) && url.endsWith('.js')) {
        const result = nextLoad(url, { ...context, format: 'module' });
        return { ...result, format: 'module' };
      }
      return nextLoad(url, context);
    },
  });
}

const { Db, Element, Rarity, NodeKind, CardDef, HeroineDef, roundToInt } = await import('../js/data.js');
const { Rng, SaveSystem, SaveData, Owned, RunState, Ev } = await import('../js/core.js');
const { Flow } = await import('../js/flow.js');

// ---------- Args ----------

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? Number(process.argv[i + 1]) : fallback;
}
const baseSeed = arg('seed', 20261124) >>> 0;
const balanceRuns = Math.max(1, arg('runs', 60) | 0);
const seeds = new Rng(baseSeed);
const nextSeed = () => seeds.nextUint32();

// ---------- Check ----------

let failures = 0;
let signaturesPlayed = 0;

function check(name, passed, detail = '') {
  if (!passed) failures++;
  const d = String(detail);
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (d.length > 0 ? ' (' + d + ')' : ''));
}

function removeFirst(list, value) {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
}

// ---------- Bot policy (LcProbe.Value / BotPick / PlayRun) ----------

function value(c) {
  return (c.damage * c.hits + c.block * 0.8 + c.energy * 6 + c.stun * 10 + c.burn * 2 + c.strength * 5) / Math.max(1, c.cost);
}

function botPick(battle) {
  if (battle == null || battle.won || battle.lost) return null;
  const need = battle.incoming() - battle.block;
  let best = null;
  let bestScore = 0.5;
  for (const card of battle.hand) {
    if (!battle.canPlay(card)) continue;
    const d = card.def;
    const level = card.effective;
    const damage = CardDef.scale(d.damage, level) * d.hits * Db.multiplier(d.element, battle.enemy.element);
    let score = damage;
    if (need > 0) score += Math.min(CardDef.scale(d.block, level), need) * 1.4 + d.stun * need;
    score += Math.min(CardDef.scale(d.heal, level), battle.run.maxHp - battle.run.hp);
    score += d.energy * 8 + d.draw * 4 + d.strength * 6 + CardDef.scale(d.burn, level) * 2 + d.weak * 3;
    if (damage > 0 && damage >= battle.enemyHp + battle.enemyBlock) score += 100;
    score = d.cost > 0 ? score / d.cost : score + 5;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

/** OrderByDescending(key).First(): first element with the highest key. */
function maxBy(list, key) {
  let best = null;
  let bestKey = -Infinity;
  for (const item of list) {
    const k = key(item);
    if (best === null || k > bestKey) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

const STEP_CAP = 6000;

async function playRun(flow, unbeatable) {
  flow.startRun();
  const run = flow.run;
  if (unbeatable) {
    run.maxHp = 99999;
    run.hp = 99999;
  }
  let step = 0;
  for (; step < STEP_CAP && !run.over; step++) {
    await flow.idle();
    if (run.over) break;
    switch (flow.screen) {
      case 'map': {
        const choices = run.choices();
        const pick = choices.find(n => n.kind === NodeKind.Rest && run.hp < Math.trunc(run.maxHp / 2)) ?? choices[0];
        flow.chooseNode(pick);
        break;
      }
      case 'battle': {
        const card = botPick(flow.battle);
        if (card != null) {
          if (flow.playCard(card) && card.def.heroineId != null) signaturesPlayed++;
        } else flow.endTurn();
        break;
      }
      case 'reward':
        flow.pickReward(maxBy(flow.lastRewardChoices, value));
        break;
      case 'shop': {
        const cards = flow.shopCards;
        let affordable = cards.findIndex(c => RunState.price(c) <= run.gold);
        if (affordable < 0) affordable = 0;
        if (cards.length > 0 && RunState.price(cards[affordable]) <= run.gold) flow.shopBuy(affordable);
        flow.leaveShop();
        break;
      }
      case 'rest':
        if (run.hp < run.maxHp * Math.fround(0.6)) flow.restHeal();
        else flow.restUpgrade(maxBy(run.deck, c => c.def.damage * c.def.hits));
        break;
      case 'treasure':
        flow.closeTreasure();
        break;
    }
  }
  await flow.idle();
  return { run, steps: step, capped: !run.over };
}

function outcome(run) {
  return run.victory ? 'win' : 'act' + (run.act + 1) + '-floor' + run.floor;
}

// ---------- Recording view (checks the view interface is driven) ----------

function recordingView(log) {
  const names = ['home', 'gacha', 'pullResults', 'collection', 'companions', 'talismans', 'team', 'map', 'battleStart',
    'refresh', 'rebuildHand', 'reward', 'shop', 'rest', 'treasure', 'result', 'toast', 'sound'];
  const view = {};
  for (const name of names) view[name] = (...args) => { log.push({ name, args }); };
  view.present = events => { log.push({ name: 'present', args: [events] }); return Promise.resolve(); };
  return view;
}

// ---------- Sequence ----------

async function main() {
  console.log('SEED ' + baseSeed);

  // Isolated save so the real progress key is never touched.
  SaveSystem.overrideKey = 'lanterncards.probe';
  SaveSystem.clear();
  const flow = new Flow({ view: null, rng: new Rng(nextSeed()), save: SaveSystem.load() });
  flow.goHome();
  const save = flow.save;
  check('fresh save has starter cards and a companion', save.cards.length === Db.starterUnlocked.length && save.companions.length === 1, save.cards.length + ' cards');

  // Gacha
  const before = save.crystals;
  check('ten-pull works', flow.pull(10) && flow.lastPull.length === 10 && save.crystals === before - Db.tenPullCost, save.crystals);
  check('ten-pull has SR or better', flow.lastPull.some(r => r.rarity >= Rarity.SR), flow.lastPull.map(r => Db.rarityNames[r.rarity]).join(','));
  check('single pull works', flow.pull(1) && flow.lastPull.length === 1);
  save.crystals = 200;
  check('pull refused without crystals', !flow.pull(10));
  save.pity = Db.ssrPity - 1;
  save.crystals = 1000;
  flow.pull(1);
  check('SSR pity triggers', flow.lastPull[0].rarity === Rarity.SSR && save.pity === 0, flow.lastPull[0].name);

  // Upgrades
  const owned = save.card('slash');
  owned.copies = 1;
  save.crystals = 1000;
  check('card upgrade with a duplicate', flow.upgradeCard('slash') && save.card('slash').level === 2);
  check('card upgrade refused without duplicates', !flow.upgradeCard('slash'));
  const companion = save.companions[0];
  companion.copies = 1;
  check('companion upgrade', flow.upgradeCompanion(companion.id) && companion.level === 2);
  save.crystals = 5000;
  check('talisman purchase', flow.buyTalisman(0) && save.talisman(0) === 1);
  check('elements: fire beats wood', Db.multiplier(Element.Fire, Element.Wood) > 1 && Db.multiplier(Element.Wood, Element.Fire) < 1);
  check('elements: light and dark', Db.multiplier(Element.Light, Element.Dark) > 1 && Db.multiplier(Element.Dark, Element.Light) > 1);

  // Save and load
  SaveSystem.save(save);
  const loaded = SaveSystem.load();
  check('save and load round trip', loaded.crystals === save.crystals && loaded.card('slash').level === 2 && loaded.talisman(0) === 1);
  check('loaded save is revived into classes', loaded instanceof SaveData && loaded.cards.every(o => o instanceof Owned)
    && loaded.canUpgrade(loaded.card('slash')) === save.canUpgrade(save.card('slash')));

  // Load migrations (port check): old save without heroines/team and a short talisman array; unseeded save gets seeded.
  {
    const key = SaveSystem.overrideKey;
    SaveSystem.overrideKey = 'lanterncards.probe.migrate';
    SaveSystem.write(JSON.stringify({ crystals: 7, talismans: [2], seeded: true, cards: [{ id: 'skycut', level: 3 }] }));
    const old = SaveSystem.load();
    const okOld = old.crystals === 7 && old.talismans.length === Db.talismans.length && old.talismans.join() === '2,0,0,0,0'
      && Array.isArray(old.heroines) && Array.isArray(old.team) && old.cards.length === 1 && old.card('skycut').copies === 0 && old.companions.length === 0;
    SaveSystem.write(JSON.stringify({ crystals: 9 }));
    const unseeded = SaveSystem.load();
    const okSeed = unseeded.seeded && unseeded.cards.length === Db.starterUnlocked.length && unseeded.activeCompanion === 'toki';
    SaveSystem.write('{ not json');
    const warn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    const broken = SaveSystem.load();
    console.warn = warn;
    const okBroken = warned && broken.crystals === 1500 && broken.seeded;
    SaveSystem.clear();
    SaveSystem.overrideKey = key;
    check('load migrations and null guards', okOld && okSeed && okBroken, 'old=' + okOld + ' seed=' + okSeed + ' broken=' + okBroken);
  }

  // Port checks: Unity float math and rounding, RNG overloads, event defaults.
  {
    const okRound = roundToInt(10.5) === 10 && roundToInt(11.5) === 12 && roundToInt(-2.5) === -2 && CardDef.scale(5, 3) === 6
      && CardDef.scale(6, 2) === 7 && Db.card('foxfire').describe(2) === 'โจมตี 6 x2  เผาไหม้ 2'
      && Db.companion('toki').valueAt(2) === 5 && Db.card('blessing').describe(1) === 'พลังงาน +2  จั่ว 2  ใช้แล้วหายไป';
    check('Unity float math and banker\'s rounding', okRound);
    const r1 = new Rng(42);
    const r2 = new Rng(42);
    let okRng = true;
    for (let i = 0; i < 2000; i++) {
      const a = r1.next(3), b = r1.next(5, 8), c = r1.next(), d = r1.nextDouble(), z = r1.next(0);
      if (!(Number.isInteger(a) && a >= 0 && a < 3 && b >= 5 && b < 8 && Number.isInteger(c) && c >= 0 && c < 2147483647 && d >= 0 && d < 1 && z === 0)) okRng = false;
      r2.next(3); r2.next(5, 8); r2.next(); r2.nextDouble(); r2.next(0);
    }
    okRng = okRng && r1.nextUint32() === r2.nextUint32() && new Rng(7).next(5, 5) === 5;
    check('Rng overloads and seeding', okRng);
  }

  // Heroines and the team
  check('five heroines with signature cards', Db.heroines.length === 5 && Db.heroines.every(h => Db.card(h.cardId)?.heroineId === h.id));
  const withArt = Db.heroines.filter(h => HeroineDef.hasArt(h.id)).map(h => h.id);
  check('heroine art loads', withArt.length >= 3, withArt.join(','));
  save.crystals = 100000;
  save.heroines.length = 0;
  save.team.length = 0;
  let tenPulls = 0;
  let shownHeroine = false;
  while (save.heroines.length === 0 && tenPulls < 60) {
    flow.pull(10);
    tenPulls++;
    shownHeroine ||= flow.lastPull.some(r => r.isHeroine);
  }
  check('gacha can give a heroine', save.heroines.length > 0 && shownHeroine, tenPulls + ' ten-pulls');
  check('new heroine joins the team', save.team.length === Math.min(save.heroines.length, Db.teamSize));
  for (const id of withArt) save.addHeroine(id);
  check('team is capped at three', save.team.length === Math.min(withArt.length, Db.teamSize), save.team.length);
  const lead = save.team[0];
  check('take a heroine out of the team', flow.toggleTeam(lead) && !save.team.includes(lead));
  check('put her back', flow.toggleTeam(lead) && save.team.includes(lead));
  save.heroine(lead).copies = 1;
  check('heroine upgrade', flow.upgradeHeroine(lead) && save.heroine(lead).level === 2);
  flow.openTeam();
  check('team screen opens', flow.screen === 'team');
  flow.goHome();
  const trial = RunState.begin(save, new Rng(1));
  const signatures = trial.deck.filter(c => c.def.heroineId != null).length;
  const expectedHp = 60 + 8 * save.talisman(0) + save.team.reduce((sum, id) => sum + Db.heroine(id).hpAt(save.heroine(id).level), 0);
  check('team adds signature cards and health', signatures === 2 * save.team.length && trial.maxHp === expectedHp, signatures + ' cards, hp ' + trial.maxHp);
  check('signature cards use the heroine\'s level', trial.deck.filter(c => c.def.heroineId === lead).every(c => c.level === 2));
  check('rewards never offer signature cards', Array.from({ length: 30 }).every(() => trial.rewardChoices(5, true).every(c => c.heroineId == null)));

  // Battle events keep the C# struct defaults (mult 0 unless set; E() sets 1).
  {
    const probeFlow = new Flow({ view: null, rng: new Rng(nextSeed()), save });
    probeFlow.startRun();
    probeFlow.chooseNode(probeFlow.run.choices()[0]);
    await probeFlow.idle();
    const battle = probeFlow.battle;
    const card = battle && battle.hand.find(c => battle.canPlay(c));
    const events = card ? battle.play(card) : [];
    const first = events[0];
    const ok = first && first.kind === Ev.HeroMotion && first.mult === 0 && first.text === card.def.name
      && events.filter(e => e.kind === Ev.EnemyHit).every(e => e.mult === Db.multiplier(card.def.element, battle.enemy.element))
      && ['kind', 'amount', 'element', 'mult', 'text', 'motion', 'heroineId'].every(k => k in first);
    check('battle events carry C# defaults', ok, card ? card.def.id : 'no card');
    probeFlow.goHome();
  }

  // A complete run with the bot made unbeatable: checks the whole path through all three chapters.
  {
    const result = await playRun(flow, true);
    const run = result.run;
    check('full run reaches victory', run != null && run.over && run.victory, run ? 'act ' + (run.act + 1) + ' floor ' + run.floor + ', ' + result.steps + ' steps' : 'no run');
    check('all three chapters visited', run != null && run.act === Db.acts.length - 1);
    check('crystals earned on the way', run != null && run.crystalsEarned > 300, run ? run.crystalsEarned : '');
    check('result screen shown', flow.screen === 'result');
    flow.goHome();
  }

  // Normal runs, to see how far the bot gets.
  {
    const outcomes = [];
    let capped = 0;
    for (let i = 0; i < 4; i++) {
      const result = await playRun(flow, false);
      if (result.capped) capped++;
      outcomes.push(outcome(result.run));
      flow.goHome();
    }
    check('normal runs finish', capped === 0, outcomes.join(' '));
    check('signature cards played in battle', signaturesPlayed > 0, signaturesPlayed + ' times');
  }

  // One signature card through a view whose present takes real time (stands in for the real-time cut-in check).
  {
    flow.startRun();
    const openRun = flow.run;
    const choices = openRun.choices();
    flow.chooseNode(choices.find(n => n.kind === NodeKind.Battle) ?? choices[0]);
    await flow.idle();
    if (flow.screen === 'battle' && flow.battle != null) {
      const battle = flow.battle;
      const sig = openRun.addCard(Db.heroine(lead).cardId);
      removeFirst(openRun.deck, sig);
      battle.hand.push(sig);
      battle.energy = Math.max(battle.energy, sig.def.cost);
      let presented = null;
      flow.view = { present: events => { presented = events; return new Promise(resolve => setTimeout(resolve, 40)); } };
      const started = performance.now();
      const played = flow.playCard(sig);
      const busyDuring = flow.busy;
      const refused = !flow.playCard(battle.hand.find(c => c !== sig) ?? sig) && !flow.chooseNode(openRun.choices()[0]);
      await flow.idle();
      const took = performance.now() - started;
      const cutIn = presented != null && presented[0].kind === Ev.HeroMotion && presented[0].heroineId === lead;
      check('signature card with cut-in plays through an async view', played && busyDuring && refused && !flow.busy && cutIn && took >= 30, took.toFixed(0) + 'ms');
      flow.view = null;
    } else check('signature card with cut-in plays through an async view', false, 'no battle: ' + flow.screen);
    flow.goHome();
  }

  // The view interface is driven at the expected points.
  {
    const log = [];
    const viewFlow = new Flow({ view: recordingView(log), rng: new Rng(nextSeed()), save });
    viewFlow.goHome();
    const result = await playRun(viewFlow, false);
    const names = log.map(e => e.name);
    const firstMap = log.find(e => e.name === 'map');
    const firstBattle = names.indexOf('battleStart');
    const chapterMaps = log.filter(e => e.name === 'map' && e.args[1].chapter).length;
    const resultCall = log.find(e => e.name === 'result');
    const bossCalls = log.filter(e => e.name === 'battleStart' && e.args[0].boss);
    const ok = names[0] === 'home' && firstMap && firstMap.args[0] === result.run && firstMap.args[1].chapter === true
      && firstBattle > 0 && names[firstBattle + 1] === 'refresh' && names[firstBattle + 2] === 'present'
      && chapterMaps === result.run.act + 1 && resultCall && resultCall.args[0] === result.run.victory
      && names.includes('reward') && names.includes('rebuildHand') && names.includes('toast')
      && bossCalls.every(e => e.args[0].chapter && e.args[0].chapter.subtitle.startsWith('บอสประจำบทที่ '));
    check('view interface calls', ok, outcome(result.run) + ', ' + log.length + ' calls');
    viewFlow.goHome();
  }

  // Balance: fresh saves, the bot with no heroine team vs. the three heroines with art at Lv.1.
  async function balance(withTeam) {
    SaveSystem.overrideKey = 'lanterncards.probe.balance';
    SaveSystem.clear();
    const fresh = SaveSystem.load();
    if (withTeam) for (const id of withArt) fresh.addHeroine(id);
    const balanceFlow = new Flow({ view: null, rng: new Rng(nextSeed()), save: fresh });
    balanceFlow.goHome();
    let wins = 0, floors = 0, capped = 0;
    const acts = [0, 0, 0];
    for (let i = 0; i < balanceRuns; i++) {
      const result = await playRun(balanceFlow, false);
      if (result.capped) capped++;
      if (result.run.victory) wins++;
      floors += result.run.floor;
      if (!result.run.victory) acts[result.run.act]++;
      balanceFlow.goHome();
    }
    SaveSystem.clear();
    return { wins, avgFloor: floors / balanceRuns, capped, acts, team: fresh.team.join('+') || 'none' };
  }
  const noTeam = await balance(false);
  const fullTeam = await balance(true);
  check('balance runs finish', noTeam.capped === 0 && fullTeam.capped === 0, 'capped ' + noTeam.capped + '/' + fullTeam.capped);
  check('balance team setup', noTeam.team === 'none' && fullTeam.team.split('+').length === 3, fullTeam.team);
  console.log('BALANCE noTeam=' + noTeam.wins + '/' + balanceRuns + ' fullTeam=' + fullTeam.wins + '/' + balanceRuns
    + ' avgFloor noTeam=' + noTeam.avgFloor.toFixed(1) + ' fullTeam=' + fullTeam.avgFloor.toFixed(1) + ' (of 21)');
  console.log('BALANCE losses by act noTeam=' + noTeam.acts.join('/') + ' fullTeam=' + fullTeam.acts.join('/'));

  // The tests never wrote the real save key.
  SaveSystem.overrideKey = null;
  check('real save key untouched', SaveSystem.read() === null);
}

try {
  await main();
} catch (e) {
  failures++;
  console.log('FAIL exception (' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) + ')');
}
console.log('DONE failures=' + failures);
process.exitCode = failures > 0 ? 1 : 0;
