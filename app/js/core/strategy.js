// Decision engine: preflop charts + postflop EV model over narrowed opponent ranges.
import { classOfCards, className, classType, RANK_NAMES } from './cards.js';
import { rangeWidth, topRange, toCombos } from './ranges.js';
import {
  equityVsRange, eqVsRandom, CLASS_PERCENTILE, PREFLOP_ORDER, ALLIN_ORDER,
} from './preflop.js';
import {
  rfiRange, vsOpenRanges, vs3betRanges, vs4betRanges, vs5betRanges, VILLAIN_TYPES,
  adjustRangeWidth, pushRange, callVsShoveRange, playersBehind, postflopOrder, positionsFor, POS_LABEL,
} from './charts.js';
import { computeEquity } from './equity.js';
import { readHand, comboStrengths, rangeComposition, BUCKET_NAMES, outsSummary } from './board.js';
import { buildVillainRange, combosToGrid, continueProb } from './villain.js';

export const ACTION_ZH = {
  fold: '棄牌', check: '過牌', call: '跟注', bet: '下注', raise: '加注', allin: '全下',
};
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const bb = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '') ;
const fmtBB = (x) => `${bb(x)} BB`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function analyze(spot) {
  if (!spot || !spot.hero || spot.hero.length !== 2) throw new Error('需要兩張手牌');
  const board = spot.board || [];
  if (![0, 3, 4, 5].includes(board.length)) throw new Error('公牌需為 0、3、4 或 5 張');
  return board.length === 0 ? analyzePreflop({ ...spot, board }) : analyzePostflop({ ...spot, board });
}

// =====================================================================================
// PREFLOP
// =====================================================================================
function analyzePreflop(sp) {
  const size = sp.tableSize || 6;
  const heroPos = sp.heroPos || 'BTN';
  const S = sp.stack ?? 100;
  const ante = sp.ante || 0;
  const type = VILLAIN_TYPES[sp.villainType] || VILLAIN_TYPES.unknown;
  const pre = sp.preflop || { scenario: 'unopened' };
  const [h1, h2] = sp.hero;
  const cls = classOfCards(h1, h2);
  const name = className(cls);
  const ctype = classType(cls);
  const perc = CLASS_PERCENTILE[cls];
  const heroBlind = heroPos === 'SB' ? 0.5 : heroPos === 'BB' ? 1 : 0;
  const reasons = [];
  const warnings = [];
  const freq = { fold: 0, check: 0, call: 0, raise: 0, allin: 0 };
  let raiseTo = 0, callAmt = 0, villainClasses = null, rangeDesc = '', pot = 1.5 + ante * size;
  const openDefault = sp.openSize || 2.5;
  const nOpp = Math.max(1, (sp.postflop?.villains) || 1);
  const behind = size === 2 ? 1 : playersBehind(heroPos, size);
  const heroOrder = postflopOrder(heroPos, size);
  const sname = POS_LABEL[heroPos] || heroPos;

  const kind = ctype === 'pair' ? '口袋對' : ctype === 'suited' ? '同花' : '不同花';
  reasons.push(perc <= 0.5
    ? `${name}（${kind}）屬於前 ${Math.max(1, Math.round(perc * 100))}% 的起手牌`
    : `${name}（${kind}）屬於後 ${Math.max(1, Math.round((1 - perc) * 100))}% 的弱起手牌`);

  switch (pre.scenario) {
    case 'limped': {
      const L = Math.max(1, pre.limpers || 1);
      pot += L * 1;
      if (heroPos === 'BB') {
        const iso = topRange(L === 1 ? 0.13 : 0.1, PREFLOP_ORDER);
        freq.raise = iso[cls]; freq.check = 1 - freq.raise;
        raiseTo = 4 + L;
        reasons.push(`大盲面對 ${L} 位跛入：前 ${L === 1 ? 13 : 10}% 強牌加注孤立，其餘免費看翻牌`);
      } else {
        const iso = adjustRangeWidth(rfiRange(heroPos, size), 0.72);
        freq.raise = iso[cls];
        const spec = isSpeculative(cls);
        const inWide = rfiRange(heroPos, size)[cls] > 0 || CLASS_PERCENTILE[cls] < 0.45;
        const sbComplete = heroPos === 'SB' && CLASS_PERCENTILE[cls] < 0.6 && (spec || ctype !== 'offsuit');
        freq.call = Math.max(0, Math.min(1 - freq.raise, (spec && inWide) || sbComplete ? 1 : 0));
        freq.fold = Math.max(0, 1 - freq.raise - freq.call);
        const oop = heroPos === 'SB';
        raiseTo = (oop ? 4 : 3.5) + L;
        callAmt = 1 - heroBlind;
        reasons.push(`面對 ${L} 位跛入：用比開池更緊的範圍「孤立加注」到 ${fmtBB(raiseTo)}；投機牌（小對子、同花連張）可跟入`);
      }
      villainClasses = adjustRangeWidth(limpTypeRange(), type.width);
      rangeDesc = '跛入玩家範圍（偏弱、無頂級牌）';
      break;
    }
    case 'vsOpen': {
      const opener = pre.openerPos || 'CO';
      const O = pre.openSize || openDefault;
      const C = pre.callers || 0;
      pot = ante * size + O * (1 + C) + deadBlinds(opener, heroPos, pre.callerPositions);
      callAmt = Math.max(0, Math.min(S, O) - heroBlind);
      const openerRange = adjustRangeWidth(rfiRange(opener, size), type.width);
      villainClasses = openerRange;
      rangeDesc = `${opener} 開池範圍（約 ${pct(rangeWidth(openerRange), 0)}）`;
      const heroIP = heroOrder > postflopOrder(opener, size);
      if (S <= 14) {
        const w = clamp(rangeWidth(openerRange) * (heroPos === 'BB' ? 0.62 : 0.5), 0.05, 0.4);
        const shove = topRange(w, ALLIN_ORDER);
        freq.allin = shove[cls]; freq.fold = 1 - freq.allin;
        raiseTo = S;
        reasons.push(`有效籌碼僅 ${fmtBB(S)}：面對開池採「全下或棄牌」，全下範圍約前 ${pct(w, 0)}`);
      } else {
        const ch = vsOpenRanges(opener, heroPos, size);
        let r = ch.raise[cls], c = ch.call[cls];
        const top = CLASS_PERCENTILE[cls];
        if (C > 0) { // squeeze spot
          if (top > 0.04) r *= 0.55;
          c *= isSpeculative(cls) ? 1 : 0.65;
          reasons.push(`前面已有 ${C} 人跟注（擠壓局面）：3-bet 以價值為主，邊緣跟注收緊`);
        }
        if (sp.villainType === 'nit') { if (top > 0.03) r *= 0.5; c *= 0.85; reasons.push('對手偏緊：開池範圍很強，減少 3-bet 詐唬、邊緣牌棄牌'); }
        else if (sp.villainType === 'lag' || sp.villainType === 'maniac') { if (top < 0.12) r = Math.min(1, r + c * 0.4); c *= 1.1; reasons.push('對手鬆兇：開池範圍寬，強牌更積極 3-bet 取價值'); }
        else if (sp.villainType === 'station') { if (top > 0.06) r *= 0.5; reasons.push('對手是跟注站：3-bet 只用價值牌，詐唬 3-bet 沒有棄牌率'); }
        r = clamp(r, 0, 1); c = clamp(c, 0, 1 - r);
        if (S <= 30) { // short: no flatting marginal hands, 3-bet = jam
          c *= ctype === 'pair' || top < 0.1 ? 0.6 : 0.2;
        }
        const oop = heroPos === 'SB' || heroPos === 'BB' || !heroIP;
        raiseTo = (oop ? 4 : 3) * O + C * O;
        if (raiseTo >= S * 0.38) { freq.allin = r; raiseTo = S; } else freq.raise = r;
        freq.call = c; freq.fold = Math.max(0, 1 - r - c);
        reasons.push(`面對 ${opener} 開池 ${fmtBB(O)}：${heroPos === 'BB' ? '大盲有價格優勢可較寬防守' : heroIP ? '你有位置，可平跟較多牌' : '你沒位置，策略偏 3-bet 或棄牌'}`);
      }
      break;
    }
    case 'vs3bet': {
      const villainPos = pre.openerPos || 'BB';
      const O = pre.heroOpen || openDefault;
      const T = pre.openSize || O * 3.5;
      pot = ante * size + O + T + deadBlinds2(heroPos, villainPos);
      callAmt = Math.max(0, Math.min(S, T) - O);
      const ch = vs3betRanges(heroPos, size);
      let r = ch.raise[cls], c = ch.call[cls];
      const villainIP = postflopOrder(villainPos, size) > heroOrder;
      if (villainIP) c *= 0.85;
      if (sp.villainType === 'nit') { r = cls === classOfName('AA') || cls === classOfName('KK') ? 1 : r * 0.5; c *= 0.75; reasons.push('對手偏緊：3-bet 範圍幾乎都是強牌，只用頂級牌繼續'); }
      if (sp.villainType === 'lag' || sp.villainType === 'maniac') { c = Math.min(1 - r, c * 1.25 + (CLASS_PERCENTILE[cls] < 0.12 ? 0.3 : 0)); reasons.push('對手 3-bet 範圍很寬：可以更寬地跟注或 4-bet'); }
      if (S <= 40) { c *= 0.6; }
      const vr = vsOpenRanges(heroPos, villainPos, size).raise;
      villainClasses = adjustRangeWidth(vr, type.width);
      rangeDesc = `${villainPos} 的 3-bet 範圍（約 ${pct(rangeWidth(villainClasses), 1)}）`;
      raiseTo = (villainIP ? 2.5 : 2.2) * T;
      if (raiseTo >= S * 0.33) { freq.allin = r; raiseTo = S; } else freq.raise = r;
      freq.call = clamp(c, 0, 1 - r); freq.fold = Math.max(0, 1 - r - freq.call);
      reasons.push(`你開池後被 ${villainPos} 3-bet 到 ${fmtBB(T)}${villainIP ? '（對手有位置）' : ''}：強牌 4-bet，好的可玩性牌跟注，其餘棄牌`);
      break;
    }
    case 'vs4bet': {
      const villainPos = pre.openerPos || 'BTN';
      const T = pre.heroOpen || 9;
      const F = pre.openSize || T * 2.3;
      pot = ante * size + T + F + 1.5;
      callAmt = Math.max(0, Math.min(S, F) - T);
      const ch = vs4betRanges();
      let r = ch.raise[cls], c = ch.call[cls];
      if (S <= 60) { r = Math.min(1, r + c); c = 0; }
      freq.allin = r; freq.call = clamp(c, 0, 1 - r); freq.fold = Math.max(0, 1 - r - freq.call);
      raiseTo = S;
      villainClasses = adjustRangeWidth(vs3betRanges(villainPos, size).raise, type.width);
      rangeDesc = `${villainPos} 的 4-bet 範圍`;
      reasons.push(`面對 4-bet（${fmtBB(F)}）：以 KK+/AK 為核心全下，QQ/JJ 視對手混合跟注`);
      break;
    }
    case 'vs5bet': {
      const F = pre.openSize || S;
      callAmt = Math.max(0, Math.min(S, F) - (pre.heroOpen || 22));
      pot = F + (pre.heroOpen || 22) + 1.5;
      freq.call = vs5betRanges().call[cls]; freq.fold = 1 - freq.call;
      villainClasses = topRange(0.03, ALLIN_ORDER);
      rangeDesc = '5-bet 全下範圍（QQ+/AK 為主）';
      reasons.push('面對 5-bet 全下：只用 QQ+/AK 跟注');
      break;
    }
    default: { // unopened
      if (heroPos === 'BB') {
        freq.check = 1;
        reasons.push('所有人棄牌到大盲：你直接贏得盲注');
        break;
      }
      if (S <= 12) {
        const pr = pushRange(heroPos, size, S, ante);
        freq.allin = pr.range[cls]; freq.fold = 1 - freq.allin;
        raiseTo = S;
        villainClasses = callVsShoveRange(S, pr.width, true, ante);
        rangeDesc = '跟注全下的範圍（納什均衡估算）';
        reasons.push(`短碼 ${fmtBB(S)}：採用推擠/棄牌（Nash），${sname}全下範圍約前 ${pct(pr.width, 0)}`);
      } else {
        const rfi = rfiRange(heroPos, size);
        freq.raise = rfi[cls]; freq.fold = 1 - freq.raise;
        raiseTo = heroPos === 'SB' ? 3 : S <= 25 ? 2.1 : openDefault;
        if (size === 2) raiseTo = S <= 25 ? 2 : 2.5;
        const bbDef = vsOpenRanges(heroPos, 'BB', size);
        villainClasses = new Float32Array(169).map((_, i) => Math.min(1, bbDef.raise[i] + bbDef.call[i]));
        rangeDesc = '大盲防守範圍';
        reasons.push(`${sname}（後面還有 ${behind} 人）開池範圍約 ${pct(rangeWidth(rfi), 0)}，此牌開池頻率 ${pct(freq.raise, 0)}`);
        if (S <= 25) reasons.push('中短碼：開池用小尺寸（約 2 BB），被 3-bet 時以全下或棄牌應對');
      }
    }
  }

  // Equity numbers
  let eqRange = null;
  if (villainClasses && rangeWidth(villainClasses) > 0.001) eqRange = equityVsRange([h1, h2], villainClasses);
  const eqRand = eqVsRandom(cls, nOpp);
  const req = callAmt > 0 ? callAmt / (pot + callAmt) : 0;
  if (eqRange != null) reasons.push(`對抗${rangeDesc}：勝率 ${pct(eqRange)}${callAmt > 0 ? `；跟注需要 ${pct(req)}（未計翻後）` : ''}`);

  // Build mix
  const items = [];
  const add = (key, f, sizeBB, label) => { if (f > 0.001) items.push({ key, freq: f, sizeBB, label }); };
  add('raise', freq.raise, raiseTo, raiseLabel(pre.scenario, raiseTo));
  add('allin', freq.allin, raiseTo, `全下 ${fmtBB(S)}`);
  add('call', freq.call, callAmt, pre.scenario === 'limped' && callAmt <= 1 ? (heroPos === 'SB' ? `補盲跟入 ${fmtBB(callAmt)}` : `跟入 ${fmtBB(callAmt)}`) : `跟注 ${fmtBB(callAmt)}`);
  add('check', freq.check, 0, '過牌');
  add('fold', freq.fold, 0, '棄牌');
  normalize(items);
  items.sort((a, b) => b.freq - a.freq || AGG[b.key] - AGG[a.key]);
  const best = items[0] || { key: 'fold', freq: 1, label: '棄牌' };
  const confidence = best.freq >= 0.85 ? 'clear' : best.freq >= 0.6 ? 'lean' : 'close';
  if (confidence === 'close' && items[1]) reasons.push(`混合策略：${items.map((i) => `${ACTION_ZH[i.key]} ${pct(i.freq, 0)}`).join(' / ')}（接近，兩者皆可）`);

  return {
    street: 'preflop', handName: name, handClass: cls,
    action: { key: best.key, label: best.label, sizeBB: best.sizeBB, zh: ACTION_ZH[best.key] },
    mix: items,
    equity: { value: eqRange ?? eqRand, vsRange: eqRange, vsRandom: eqRand, nOpp, exact: false },
    potOdds: callAmt > 0 ? { toCall: callAmt, pot, required: req, ratio: pot / callAmt } : null,
    pot, spr: null, handPercentile: perc,
    villain: villainClasses ? { grid: normGrid(villainClasses), width: rangeWidth(villainClasses), desc: rangeDesc } : null,
    reasons, warnings, confidence,
  };
}

const AGG = { allin: 5, raise: 4, bet: 3, call: 2, check: 1, fold: 0 };
function normalize(items) {
  const s = items.reduce((a, i) => a + i.freq, 0);
  if (s > 0) for (const i of items) i.freq /= s;
}
function raiseLabel(sc, to) {
  if (sc === 'vsOpen') return `3-bet 到 ${fmtBB(to)}`;
  if (sc === 'vs3bet') return `4-bet 到 ${fmtBB(to)}`;
  if (sc === 'limped') return `加注孤立到 ${fmtBB(to)}`;
  return `開池加注到 ${fmtBB(to)}`;
}
function isSpeculative(cls) {
  const t = classType(cls);
  const row = Math.floor(cls / 13), col = cls % 13;
  if (t === 'pair') return true;
  if (t === 'suited') { const gap = Math.abs(row - col) - 1; return gap <= 2 || Math.min(row, col) === 0; }
  return false;
}
function classOfName(n) { for (let c = 0; c < 169; c++) if (className(c) === n) return c; return -1; }
function limpTypeRange() {
  const all = topRange(0.6, PREFLOP_ORDER), prem = topRange(0.06, PREFLOP_ORDER);
  return all.map((w, i) => Math.max(0, w - prem[i] * 0.85));
}
function deadBlinds(opener, heroPos, callerPositions = []) {
  let d = 0;
  const involved = new Set([opener, ...callerPositions]);
  if (!involved.has('SB')) d += 0.5;
  if (!involved.has('BB')) d += 1;
  return d;
}
function deadBlinds2(a, b) {
  let d = 0;
  if (a !== 'SB' && b !== 'SB') d += 0.5;
  if (a !== 'BB' && b !== 'BB') d += 1;
  return d;
}
function normGrid(classes) {
  let mx = 0;
  for (const v of classes) mx = Math.max(mx, v);
  return Float32Array.from(classes, (v) => (mx > 0 ? v / mx : 0));
}

// =====================================================================================
// POSTFLOP
// =====================================================================================
const SIZES = { flop: [0.33, 0.5, 0.75, 1.0], turn: [0.5, 0.75, 1.0, 1.5], river: [0.33, 0.5, 0.75, 1.0, 1.5] };
const IMPLIED_K = { station: 0.3, unknown: 0.18, tag: 0.16, lag: 0.22, maniac: 0.25, nit: 0.1 };
const AIR_CUT = { station: 0.06, maniac: 0.12, lag: 0.16, unknown: 0.2, tag: 0.2, nit: 0.26 };

function analyzePostflop(sp) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const hero = sp.hero, board = sp.board;
  const P = sp.postflop || {};
  const street = board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river';
  const typeKey = sp.villainType || 'unknown';
  const type = VILLAIN_TYPES[typeKey] || VILLAIN_TYPES.unknown;
  const nV = Math.max(1, Math.min(8, P.villains || 1));
  const potStart = Math.max(0.5, P.pot ?? 6);
  const facing = P.facing || 'none';
  const bet = facing !== 'none' ? Math.max(0, P.bet || 0) : 0;
  const heroBet = facing === 'raise' ? Math.max(0, P.heroBet || 0) : 0;
  const callersInFront = P.callersInFront || 0;
  const effStack = Math.max(0, P.effStack ?? Math.max(0, (sp.stack ?? 100) - potStart / 2));
  const toCall = facing !== 'none' ? Math.max(0, Math.min(bet - heroBet, effStack)) : 0;
  const potNow = potStart + (facing !== 'none' ? bet * (1 + callersInFront) + heroBet : 0);
  const heroIP = P.heroIP ?? true;
  const spr = effStack / Math.max(0.5, potNow);

  // --- opponent range
  const vr = buildVillainRange({
    hero, board, tableSize: sp.tableSize || 6, heroPos: sp.heroPos || 'BTN', villainPos: P.villainPos,
    potType: P.potType || 'srp', heroAggressor: P.heroAggressor ?? true, villainType: typeKey,
    history: P.history || [], facing, bet, heroBet, potStart, villainChecked: !!P.villainChecked, heroIP,
  });
  let cw = vr.cw;
  let wsum = 0;
  for (let k = 0; k < cw.length; k++) wsum += cw[k];
  const warnings = [];
  if (wsum <= 1e-6) {
    warnings.push('依目前資訊，對手範圍被排除到幾乎為零，改用較寬範圍估算');
    cw = toCombos(topRange(0.5, PREFLOP_ORDER), [...hero, ...board]);
  }

  // --- hand reading and equities
  const hand = readHand(hero, board);
  const st = comboStrengths(board, hero);
  const comp = rangeComposition(cw, st);
  let eqRes, perCombo = null;
  if (nV === 1) { eqRes = computeEquity({ hero, board, villains: [cw] }); perCombo = eqRes.perCombo; }
  else eqRes = computeEquity({ hero, board, villains: Array(nV).fill(cw), maxMs: 260, maxIters: 120000 });
  const eqAll = eqRes.equity;
  const eqRand = computeEquity({ hero, board, villains: Array(nV).fill(null), maxMs: 90, maxIters: 60000 }).equity;
  let huEq = eqAll, huPer = perCombo;
  if (nV > 1) { const hu = computeEquity({ hero, board, villains: [cw] }); huEq = hu.equity; huPer = hu.perCombo; }

  // villain continue model (absolute, size-dependent thresholds)
  const liveW = st.live.filter((k) => cw[k] > 0);
  let totW = 0;
  for (const k of liveW) totW += cw[k];
  function continueStats(req, isRaise) {
    let contW = 0, eqNum = 0, foldEqNum = 0;
    for (const k of liveW) {
      const w = cw[k];
      const p = continueProb(st.s[k], st.draw[k], street, req, type, isRaise);
      contW += w * p; eqNum += w * p * huPer[k]; foldEqNum += w * (1 - p) * huPer[k];
    }
    let cont = contW / Math.max(1e-9, totW);
    let eqC = contW > 0 ? eqNum / contW : huEq;
    // population never folds *everything*: keep a floor of light calls (hero-calls / floats)
    const floor = (isRaise ? 0.1 : 0.18) * (1 - req) * Math.min(1.4, type.callAdj);
    if (cont < floor) {
      const extra = floor - cont;
      const foldW = totW - contW;
      const eqF = foldW > 0 ? foldEqNum / foldW : eqC;
      eqC = (eqC * cont + eqF * extra) / floor;
      cont = floor;
    }
    return { cont, fold: 1 - cont, eqC };
  }
  // equity realisation
  let R = street === 'river' ? 1 : heroIP ? 1.0 : street === 'flop' ? 0.87 : 0.93;
  if (street !== 'river') {
    if (hand.hs != null && hand.hs >= 0.95) R += 0.04;
    if (hand.outsCount >= 8) R += heroIP ? 0.02 : -0.02;
    if (['second', 'bottom', 'under'].includes(hand.pairType) || (hand.pairType === 'top' && hand.kicker === 'weak')) R -= heroIP ? 0.02 : 0.05;
    if (nV > 1) R *= 0.93;
  }
  const scaleMW = (eqC) => (nV > 1 ? clamp(eqC * (eqAll / Math.max(0.01, huEq)), 0, 1) : eqC);

  // --- enumerate actions
  const acts = [];
  if (facing === 'none') {
    acts.push({ key: 'check', ev: R * eqAll * potStart, label: '過牌' });
    const sizes = SIZES[street].slice();
    const cand = [];
    for (const f of sizes) {
      let b = potStart * f;
      if (b >= effStack * 0.55) b = effStack;
      if (b <= 0) continue;
      if (!cand.some((x) => Math.abs(x - b) < 0.01)) cand.push(b);
    }
    if (spr <= 3 && effStack > 0 && !cand.includes(effStack)) cand.push(effStack);
    for (const b of cand) {
      const cs = continueStats(b / (potStart + 2 * b), false);
      const fAll = nV > 1 ? Math.pow(cs.fold, nV) : cs.fold;
      const expCallers = nV > 1 ? (nV * cs.cont) / Math.max(0.05, 1 - fAll) : 1;
      const eqC = scaleMW(cs.eqC);
      let ev = fAll * potStart + (1 - fAll) * (R * eqC * (potStart + b * (1 + expCallers)) - b)
        + sizePrior(b / potStart, street, hand, eqC, P.heroAggressor ?? true) * potStart * (typeKey === 'unknown' || typeKey === 'tag' ? 1.6 : 0.7);
      if (eqC < 0.2) ev -= 0.04 * b + (b > 0.5 * effStack ? 0.1 * potStart : 0); // risk-adjust pure bluffs
      const allin = b >= effStack - 1e-6;
      acts.push({
        key: allin ? 'allin' : 'bet', family: 'bet', ev, sizeBB: b, potFrac: b / potStart,
        fold: fAll, eqC, label: allin ? `全下 ${fmtBB(b)}` : `下注 ${fmtBB(b)}（${potFracLabel(b / potStart)}）`,
      });
    }
  } else {
    const potOddsReq = toCall / (potNow + toCall);
    let implied = 0;
    if (street !== 'river' && hand.outsCount >= 4 && (hand.cat ?? 0) <= 2) {
      let k = IMPLIED_K[typeKey] ?? 0.18;
      if (hand.draws?.flush && hand.draws.flush !== 'nut') k *= 0.7;
      if (hand.texture?.pairs) k *= 0.7;
      implied = hand.pNext * Math.min(Math.max(0, effStack - toCall), potNow + toCall) * k;
    }
    const evCall = R * eqAll * (potNow + toCall) - toCall + implied;
    acts.push({ key: 'fold', ev: 0, label: '棄牌' });
    acts.push({ key: 'call', ev: evCall, sizeBB: toCall, label: `跟注 ${fmtBB(toCall)}`, implied, req: potOddsReq });
    // raises
    const maxTo = effStack + heroBet;
    if (effStack > toCall + 0.01) {
      const mult = heroIP ? 3 : 3.5;
      const cand = [];
      let X = bet * mult + callersInFront * bet;
      if (X >= maxTo * 0.45) X = maxTo;
      cand.push(X);
      if (X < maxTo && (spr <= 4 || street === 'river')) cand.push(maxTo);
      for (const X2 of cand) {
        const x = X2 - heroBet, y = Math.min(X2, maxTo) - bet;
        const cs = continueStats(y / (potNow + x + y), true);
        const fAll = nV > 1 ? Math.pow(cs.fold, nV) : cs.fold;
        const eqC = scaleMW(cs.eqC);
        let ev = fAll * potNow + (1 - fAll) * (R * eqC * (potNow + x + y) - x);
        // risk-adjust pure-bluff raises: fold-rate estimates are uncertain, and big bluffs burn showdown value
        if (eqC < 0.2) ev -= 0.08 * x + (x > 0.5 * effStack ? 0.2 * potNow : 0);
        const allin = X2 >= maxTo - 1e-6;
        acts.push({
          key: allin ? 'allin' : 'raise', family: 'raise', ev, sizeBB: X2, fold: fAll, eqC,
          label: allin ? `全下 ${fmtBB(effStack)}` : `加注到 ${fmtBB(X2)}`,
        });
      }
    }
  }

  // --- choose: best per family, then softmax into a mix
  const fam = new Map();
  for (const a of acts) {
    const f = a.family || a.key;
    if (!fam.has(f) || fam.get(f).ev < a.ev) fam.set(f, a);
  }
  const fams = [...fam.values()];
  const potRef = Math.max(1, potNow);
  const evMax = Math.max(...fams.map((a) => a.ev));
  const TAU = 0.045;
  let z = 0;
  for (const a of fams) { a.w = Math.exp((a.ev - evMax) / (TAU * potRef)); z += a.w; }
  for (const a of fams) a.freq = a.w / z;
  let mix = fams.filter((a) => a.freq >= 0.04);
  normalize(mix);
  mix.sort((a, b) => b.freq - a.freq || AGG[b.key] - AGG[a.key]);
  const best = mix[0];
  const sortedEv = fams.map((a) => a.ev).sort((a, b) => b - a);
  const gap = (sortedEv[0] - (sortedEv[1] ?? sortedEv[0])) / potRef;
  const confidence = gap > 0.12 ? 'clear' : gap > 0.04 ? 'lean' : 'close';

  // --- explanations
  const reasons = [];
  const hsTxt = hand.hs != null ? `（勝過 ${pct(hand.hs, 0)} 的可能手牌）` : '';
  reasons.push(`你的牌：${hand.label}${hand.detail ? ' — ' + hand.detail : ''}${hsTxt}`);
  if (hand.drawLabels?.length && street !== 'river') {
    const outsTxt = hand.outsCount ? `，${hand.outsCount} 張 outs：下一張 ${pct(hand.pNext, 0)}${street === 'flop' ? `，到河牌 ${pct(hand.pRiver, 0)}` : ''}` : '';
    reasons.push(`聽牌：${hand.drawLabels.join(' + ')}${outsTxt}`);
  }
  reasons.push(`對手範圍（${vr.desc}）：${comp.map((x, i) => `${BUCKET_NAMES[i]} ${pct(x, 0)}`).filter((_, i) => comp[i] >= 0.005).join(' · ')}`);
  reasons.push(`你的勝率：對此範圍 ${pct(eqAll)}${nV > 1 ? `（${nV} 位對手）` : ''}；對隨機手牌 ${pct(eqRand)}`);
  if (facing !== 'none') {
    const c = acts.find((a) => a.key === 'call');
    reasons.push(`底池賠率 ${(potNow / Math.max(0.01, toCall)).toFixed(1)} : 1 → 跟注需要 ${pct(c.req)} 勝率${c.implied > 0.05 ? `；隱含賠率約 +${fmtBB(c.implied)}` : ''}`);
  }
  const bestBet = fam.get('bet') || fam.get('raise');
  if (best.key === 'bet' || best.key === 'raise' || best.key === 'allin') {
    const valueOrBluff = best.eqC >= 0.5 ? '價值下注：被跟注時仍領先' : best.eqC >= 0.3 ? '半詐唬：有棄牌率也有後門/聽牌' : '詐唬：主要靠對手棄牌';
    reasons.push(`${ACTION_ZH[best.key]} ${fmtBB(best.sizeBB)}：對手約 ${pct(best.fold, 0)} 會棄牌，被跟注時你的勝率 ${pct(best.eqC, 0)} → ${valueOrBluff}`);
  } else if (best.key === 'check' && bestBet) {
    reasons.push(`過牌優於下注：下注時多半只被更強的牌跟注（被跟注勝率 ${pct(bestBet.eqC, 0)}），過牌可控池並實現勝率`);
  } else if (best.key === 'call') {
    reasons.push(bestBet && bestBet.ev > 0 && fam.get('raise')?.ev > best.ev - 0.03 * potRef ? '跟注與加注接近，跟注可保留對手的詐唬' : '跟注最有利：勝率足夠支付價格，加注只會讓弱牌棄牌');
  } else if (best.key === 'fold') {
    reasons.push('勝率不足以支付價格，長期跟注會虧損 → 棄牌');
  }
  const tex = hand.texture;
  if (tex) {
    let t = `牌面${tex.label}（${tex.tags.join('、')}）`;
    if (best.family === 'bet') {
      const f = best.potFrac ?? 0.5;
      if (tex.wetness < 0.25) t += f <= 0.5 ? '：乾燥牌面用小尺寸即可，讓對手的弱牌繼續付錢' : '：牌面乾燥，但對手的跟注範圍以對子為主，大尺寸能收取更多價值';
      else if (tex.wetness > 0.5) t += f >= 0.66 ? '：濕潤牌面用較大尺寸，讓聽牌付出代價' : '：濕潤牌面，小尺寸也能保護並收取價值';
    }
    reasons.push(t);
  }
  // bet sizes with nearly the same EV
  let sizeAlts = [];
  const betFam = acts.filter((a) => a.family === (best.family || best.key) && a !== best && a.sizeBB);
  for (const a of betFam) if (best.ev - a.ev <= 0.035 * potRef) sizeAlts.push({ label: a.key === 'allin' ? '全下' : potFracLabel(a.sizeBB / (a.family === 'bet' ? potStart : potNow)), sizeBB: a.sizeBB, diff: a.ev - best.ev });
  sizeAlts = sizeAlts.sort((a, b) => b.diff - a.diff).slice(0, 3);
  if (sizeAlts.length && (best.family === 'bet')) reasons.push(`尺寸彈性：${sizeAlts.map((x) => x.label).join('、')} 的 EV 也很接近，可依對手調整`);
  const tips = {
    station: '對手是跟注站：不要詐唬，價值下注可以更大更薄',
    nit: '對手很緊：他下注/加注時多半是強牌，詐唬成功率高',
    lag: '對手鬆兇：範圍寬、詐唬多，中等牌可以抓詐唬',
    maniac: '對手極度激進：讓他主動下注，用強牌跟注或加注',
    tag: '對手緊兇：尊重他的大尺寸下注',
  };
  if (tips[typeKey]) reasons.push(tips[typeKey]);
  if (spr <= 2.5 && (hand.hs ?? 0) >= 0.85) reasons.push(`SPR 只有 ${spr.toFixed(1)}：強牌已承諾，可直接把籌碼打進去`);

  const evs = {};
  for (const a of fams) evs[a.family || a.key] = a.ev;

  return {
    street, hand,
    action: { key: best.key, label: best.label, sizeBB: best.sizeBB, potFrac: best.potFrac, zh: ACTION_ZH[best.key] },
    mix: mix.map((a) => ({ key: a.key, freq: a.freq, label: a.label, ev: a.ev, sizeBB: a.sizeBB })),
    allActions: acts.map((a) => ({ key: a.key, label: a.label, ev: a.ev, sizeBB: a.sizeBB, fold: a.fold, eqC: a.eqC })),
    equity: {
      value: eqAll, win: eqRes.win, tie: eqRes.tie, lose: eqRes.lose, vsRandom: eqRand, exact: eqRes.exact,
      heroCats: Array.from(eqRes.heroCats || []), nOpp: nV,
    },
    potOdds: facing !== 'none' ? { toCall, pot: potNow, required: toCall / (potNow + toCall), ratio: potNow / Math.max(0.01, toCall) } : null,
    pot: potNow, potStart, spr, effStack, evs, R,
    villain: { grid: combosToGrid(cw, [...hero, ...board]), composition: comp, desc: vr.desc, combos: totW },
    outs: outsSummary(hand.outs || []),
    reasons, warnings, confidence, sizeAlts,
    ms: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0,
  };
}

/**
 * Small EV tie-breaker (fraction of pot) encoding standard theory sizing preferences that a
 * one-street model can't see: range bets small on dry boards, bigger on wet boards and turns,
 * polarised river sizing (big for nutted value & bluffs, small for thin value).
 */
function sizePrior(f, street, hand, eqC, heroPFR) {
  const wet = hand.texture?.wetness ?? 0.3;
  let pref;
  if (street === 'flop') pref = !heroPFR ? 0.66 : wet < 0.25 ? 0.33 : wet < 0.45 ? 0.5 : 0.75;
  else if (street === 'turn') pref = wet > 0.45 || eqC > 0.85 ? 1.0 : 0.75;
  else pref = eqC > 0.85 || eqC < 0.3 ? 1.0 : eqC > 0.6 ? 0.5 : 0.33;
  const d = Math.abs(Math.log(f / pref));
  return 0.03 * Math.max(0, 1 - d / 0.9);
}

export function potFracLabel(f) {
  const table = [[0.25, '1/4 池'], [0.33, '1/3 池'], [0.5, '1/2 池'], [0.66, '2/3 池'], [0.75, '3/4 池'], [1, '滿池'], [1.25, '1.25 倍池'], [1.5, '1.5 倍池'], [2, '2 倍池']];
  let best = table[0];
  for (const t of table) if (Math.abs(t[0] - f) < Math.abs(best[0] - f)) best = t;
  return Math.abs(best[0] - f) < 0.06 ? best[1] : `${Math.round(f * 100)}% 池`;
}

export { positionsFor };
