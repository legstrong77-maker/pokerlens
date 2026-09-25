// Board texture, hero hand reading (made hand / draws / outs) and per-combo strengths.
import {
  rankOf, suitOf, RANK_NAMES, SUIT_SYMBOLS, COMBO_A, COMBO_B, NUM_COMBOS, cardPretty,
} from './cards.js';
import { evaluate, masksOf, evalWith, STRAIGHT_HI, POPCNT, CAT_NAMES } from './evaluator.js';

const bitOf = (r) => 1 << r;
const rankMaskOf = (cards) => cards.reduce((m, c) => m | bitOf(rankOf(c)), 0);

// Number of ranks x that complete a straight with mask m (m has no straight yet).
const COMPLETERS = new Uint16Array(8192); // bitmask of completing ranks
for (let m = 0; m < 8192; m++) {
  if (STRAIGHT_HI[m] >= 0) continue;
  let out = 0;
  for (let x = 0; x < 13; x++) {
    if (m & (1 << x)) continue;
    if (STRAIGHT_HI[m | (1 << x)] >= 0) out |= 1 << x;
  }
  COMPLETERS[m] = out;
}

/** Board texture analysis. */
export function analyzeBoard(board) {
  const n = board.length;
  const suitCount = [0, 0, 0, 0];
  const rankCount = new Array(13).fill(0);
  for (const c of board) { suitCount[suitOf(c)]++; rankCount[rankOf(c)]++; }
  const maxSuit = Math.max(...suitCount);
  const mask = rankMaskOf(board);
  const pairs = rankCount.filter((x) => x === 2).length;
  const trips = rankCount.some((x) => x >= 3);
  const high = n ? Math.max(...board.map(rankOf)) : -1;
  const broadway = board.filter((c) => rankOf(c) >= 8).length;
  const flushOnBoard = maxSuit >= 3;
  const flushDrawOnBoard = n < 5 && maxSuit === 2;

  // Straight combinatorics: how many distinct 2-rank holdings make a straight / strong draw
  let straightMakers = 0, straightDraws = 0;
  for (let x = 0; x < 13; x++) for (let y = x; y < 13; y++) {
    const m = mask | bitOf(x) | bitOf(y);
    if (x === y && (mask & bitOf(x))) continue;
    if (STRAIGHT_HI[m] >= 0 && STRAIGHT_HI[mask] < 0) { straightMakers++; continue; }
    if (n < 5 && POPCNT[COMPLETERS[m]] >= 2 && (m !== mask)) straightDraws++;
  }
  const straightOnBoard = STRAIGHT_HI[mask] >= 0;

  let wet = 0;
  if (n >= 3) {
    if (maxSuit >= 3) wet += n === 3 ? 0.55 : 0.4;
    else if (flushDrawOnBoard) wet += suitCount.filter((x) => x === 2).length >= 2 ? 0.4 : 0.28;
    wet += Math.min(1, straightMakers / 8) * 0.35 + Math.min(1, straightDraws / 6) * 0.25;
    if (pairs || trips) wet -= 0.12;
    if (broadway >= 2) wet += 0.06;
    wet = Math.max(0, Math.min(1, wet));
  }
  let label = '—';
  if (n >= 3) label = wet < 0.22 ? '乾燥' : wet < 0.45 ? '半濕' : wet < 0.68 ? '濕潤' : '極濕';

  const tags = [];
  if (n >= 3) {
    if (maxSuit === n && n >= 3) tags.push('單色');
    else if (maxSuit >= 3) tags.push(`三張${SUIT_SYMBOLS[suitCount.indexOf(maxSuit)]}`);
    else if (flushDrawOnBoard) tags.push(suitCount.filter((x) => x === 2).length >= 2 ? '雙同花聽牌' : '雙色');
    else tags.push('彩虹');
    if (trips) tags.push('三條公牌');
    else if (pairs === 2) tags.push('兩對公牌');
    else if (pairs === 1) tags.push('公對');
    if (straightOnBoard) tags.push('公牌成順');
    else if (straightMakers >= 6) tags.push('高連接');
    else if (straightMakers >= 1) tags.push('可成順');
    else if (straightDraws >= 3) tags.push('聽順多');
    else tags.push('不連接');
    if (high === 12) tags.push('A 高');
    else if (high === 11) tags.push('K 高');
    else if (high <= 7) tags.push('低牌面');
    if (broadway >= 2) tags.push('大牌多');
  }
  return {
    n, suitCount, maxSuit, rankCount, mask, pairs, trips, high, broadway,
    flushOnBoard, flushDrawOnBoard, straightMakers, straightDraws, straightOnBoard,
    wetness: wet, label, tags,
  };
}

/** Category of board-only cards (for < 5 cards too): 0 none,1 pair,2 two pair,3 trips,... */
function boardOnlyCategory(cards) {
  if (cards.length >= 5) return evaluate(cards) >> 20;
  const rc = new Array(13).fill(0);
  for (const c of cards) rc[rankOf(c)]++;
  const mx = Math.max(...rc);
  if (mx >= 4) return 7;
  if (mx === 3) return 3;
  const p = rc.filter((x) => x === 2).length;
  return p >= 2 ? 2 : p === 1 ? 1 : 0;
}

/** Hand strength vs all live random combos: fraction of combos hero beats (ties half). */
export function handStrength(hero, board) {
  if (board.length < 3) return null;
  const dead = new Uint8Array(52);
  for (const c of hero) dead[c] = 1;
  for (const c of board) dead[c] = 1;
  const hs = evaluate([...hero, ...board]);
  const bm = masksOf(board);
  let win = 0, tie = 0, tot = 0, better = 0;
  for (let k = 0; k < NUM_COMBOS; k++) {
    const a = COMBO_A[k], b = COMBO_B[k];
    if (dead[a] || dead[b]) continue;
    const v = evalWith(bm, a, b);
    tot++;
    if (hs > v) win++; else if (hs === v) tie++; else better++;
  }
  return { hs: (win + tie / 2) / tot, beatenBy: better, total: tot };
}

/** Detailed reading of hero's hand on this board. */
export function readHand(hero, board) {
  const n = board.length;
  const all = [...hero, ...board];
  const res = { street: n === 0 ? 'preflop' : n === 3 ? 'flop' : n === 4 ? 'turn' : 'river' };
  if (n < 3) return res;
  const score = evaluate(all);
  const cat = score >> 20;
  const hr = hero.map(rankOf).sort((a, b) => b - a);
  const boardRanks = board.map(rankOf).sort((a, b) => b - a);
  const uniqBoard = [...new Set(boardRanks)];
  const topB = uniqBoard[0];
  const bCat = boardOnlyCategory(board);
  const tex = analyzeBoard(board);

  // ---- made hand label
  let label = CAT_NAMES[cat], detail = '', pairType = null, kicker = null;
  const pocketPair = hr[0] === hr[1];
  const heroPairsBoard = hr.filter((r) => boardRanks.includes(r));
  if (cat === 1) {
    if (bCat >= 1 && !pocketPair && heroPairsBoard.length === 0) {
      pairType = 'board'; label = '公牌對子'; detail = `只有公牌的一對，${RANK_NAMES[hr[0]]} 高`;
    } else if (pocketPair) {
      if (hr[0] > topB) { pairType = 'overpair'; label = '超對'; detail = `口袋 ${RANK_NAMES[hr[0]]} 高於所有公牌`; }
      else {
        const above = uniqBoard.filter((r) => r > hr[0]).length;
        pairType = above === 1 ? 'second' : 'under';
        label = above === 1 ? '口袋次對' : '口袋小對';
        detail = `口袋 ${RANK_NAMES[hr[0]]}，公牌有 ${above} 張比它大`;
      }
    } else {
      const pr = heroPairsBoard[0];
      const pos = uniqBoard.indexOf(pr);
      const kick = hr.find((r) => r !== pr) ?? pr;
      const higherKickers = [];
      for (let r = 12; r > kick; r--) if (r !== pr && !boardRanks.includes(r)) higherKickers.push(r);
      kicker = higherKickers.length === 0 ? 'top' : higherKickers.length <= 2 ? 'good' : 'weak';
      const kickName = { top: '頂踢腳', good: '好踢腳', weak: '弱踢腳' }[kicker];
      if (pos === 0) { pairType = 'top'; label = '頂對'; }
      else if (pos === uniqBoard.length - 1) { pairType = 'bottom'; label = '底對'; }
      else if (pos === 1) { pairType = 'second'; label = '第二對'; }
      else { pairType = 'bottom'; label = `第${pos + 1}對`; }
      detail = `${label} ${RANK_NAMES[pr]}，${kickName} ${RANK_NAMES[kick]}`;
      label = `${label}${kicker === 'top' ? '頂踢' : ''}`;
    }
  } else if (cat === 2) {
    const both = heroPairsBoard.length === 2 && !pocketPair;
    if (bCat >= 2 || (bCat === 1 && heroPairsBoard.length === 0 && !pocketPair)) { label = '兩對 (公牌)'; detail = '兩對大多來自公牌，價值有限'; pairType = 'board'; }
    else if (both) { label = '兩對'; detail = '兩張手牌都擊中'; }
    else if (pocketPair) { label = '兩對 (口袋+公對)'; detail = '口袋對 + 公牌對子'; }
    else { label = '兩對'; detail = '一張手牌擊中 + 公牌對子'; }
  } else if (cat === 3) {
    if (pocketPair && boardRanks.includes(hr[0])) { label = '暗三 (Set)'; detail = `口袋 ${RANK_NAMES[hr[0]]} 中三條，隱蔽性高`; }
    else if (heroPairsBoard.length) { label = '明三 (Trips)'; detail = '公對 + 手牌中三條，注意踢腳'; }
    else { label = '三條 (公牌)'; detail = '三條在公牌上'; }
  } else if (cat === 0) {
    const over = hr.filter((r) => r > topB).length;
    label = over === 2 ? '兩張高張' : hr[0] === 12 ? 'A 高' : '高牌';
    detail = over === 2 ? '兩張手牌都大於公牌' : `${RANK_NAMES[hr[0]]} 高`;
  } else {
    detail = describeWithBoard(score);
  }

  // ---- strength vs random combos
  const hsInfo = handStrength(hero, board);

  // ---- draws
  const draws = { flush: null, straight: null, backdoorFlush: false, backdoorStraight: false, overcards: 0 };
  if (n < 5) {
    const hs = [0, 0, 0, 0], bs = [0, 0, 0, 0];
    for (const c of hero) hs[suitOf(c)]++;
    for (const c of board) bs[suitOf(c)]++;
    for (let s = 0; s < 4; s++) {
      if (hs[s] && hs[s] + bs[s] === 4 && cat < 5) {
        // nut flush draw? hero holds highest rank of suit not on board
        let top = -1;
        for (let r = 12; r >= 0; r--) { const cc = r * 4 + s; if (!board.includes(cc)) { top = r; break; } }
        const heroTop = Math.max(...hero.filter((c) => suitOf(c) === s).map(rankOf));
        draws.flush = heroTop === top ? 'nut' : heroTop >= top - 2 ? 'high' : 'low';
        draws.flushSuit = s;
      }
      if (n === 3 && hs[s] && hs[s] + bs[s] === 3) draws.backdoorFlush = true;
    }
    const rmask = rankMaskOf(all), bmask = rankMaskOf(board);
    if (cat < 4) {
      const comp = COMPLETERS[rmask];
      let heroComp = 0;
      for (let x = 0; x < 13; x++) {
        if (!(comp & (1 << x))) continue;
        const heroHi = STRAIGHT_HI[rmask | (1 << x)];
        const boardHi = STRAIGHT_HI[bmask | (1 << x)];
        if (heroHi > boardHi) heroComp |= 1 << x;
      }
      const k = POPCNT[heroComp];
      if (k >= 2) draws.straight = 'oesd';
      else if (k === 1) draws.straight = 'gutshot';
      draws.straightRanks = heroComp;
      if (n === 3 && k === 0) {
        // backdoor: two more ranks needed
        outer: for (let x = 0; x < 13; x++) for (let y = x + 1; y < 13; y++) {
          const m = rmask | (1 << x) | (1 << y);
          if (STRAIGHT_HI[m] >= 0 && STRAIGHT_HI[m] > STRAIGHT_HI[bmask | (1 << x) | (1 << y)]) { draws.backdoorStraight = true; break outer; }
        }
      }
    }
    if (cat === 0) draws.overcards = hr.filter((r) => r > topB).length;
  }

  // ---- outs (cards improving hero to a clearly better category, not shared with the board)
  const outs = [];
  if (n < 5) {
    const used = new Set(all);
    for (let c = 0; c < 52; c++) {
      if (used.has(c)) continue;
      const ns = evaluate([...all, c]);
      const nc = ns >> 20;
      const bc = boardOnlyCategory([...board, c]);
      if (nc <= cat || nc <= bc) {
        continue;
      }
      // pair improvements count only for no-pair hands (overcards) — "weak outs"
      let type = CAT_NAMES[nc];
      let strength = 'strong';
      if (nc === 1) strength = 'weak';
      if (nc === 2 && cat === 1 && !pocketPair && pairType !== 'top' && pairType !== 'overpair') strength = 'medium';
      // dirty: completes a board flush/straight that hero doesn't own
      let dirty = false;
      if (nc < 5) {
        const nb = [...board, c];
        const sc = [0, 0, 0, 0]; for (const x of nb) sc[suitOf(x)]++;
        if (Math.max(...sc) >= 3 && n === 4) dirty = true;
      }
      if (nc === 4 && boardOnlyCategory([...board, c]) >= 1) dirty = true;
      outs.push({ card: c, type, strength, dirty });
    }
  }
  const unseen = 52 - 2 - n;
  const strongOuts = outs.filter((o) => o.strength !== 'weak');
  const cleanOuts = strongOuts.filter((o) => !o.dirty).length + strongOuts.filter((o) => o.dirty).length * 0.5;
  const outsN = strongOuts.length;
  const pNext = outsN / unseen;
  const pRiver = n === 3 ? 1 - ((unseen - outsN) * (unseen - outsN - 1)) / (unseen * (unseen - 1)) : pNext;

  const drawLabels = [];
  if (draws.flush) drawLabels.push(draws.flush === 'nut' ? '堅果同花聽牌' : '同花聽牌');
  if (draws.straight === 'oesd') drawLabels.push('兩頭順聽牌');
  if (draws.straight === 'gutshot') drawLabels.push('卡順聽牌');
  if (draws.backdoorFlush && !draws.flush) drawLabels.push('後門同花');
  if (draws.backdoorStraight && !draws.straight) drawLabels.push('後門順子');
  if (draws.overcards === 2) drawLabels.push('兩張高張');

  return {
    ...res, score, cat, label, detail, pairType, kicker, pocketPair,
    hs: hsInfo ? hsInfo.hs : null, beatenBy: hsInfo ? hsInfo.beatenBy : 0, texture: tex,
    draws, drawLabels, outs, outsCount: outsN, cleanOuts, pNext, pRiver, unseen,
  };
}

function describeWithBoard(score) {
  const cat = score >> 20;
  const r0 = (score >> 16) & 15;
  switch (cat) {
    case 4: return `順子到 ${RANK_NAMES[r0]}`;
    case 5: return `同花 ${RANK_NAMES[r0]} 高`;
    case 6: return `葫蘆 ${RANK_NAMES[r0]} 帶 ${RANK_NAMES[(score >> 12) & 15]}`;
    case 7: return `四條 ${RANK_NAMES[r0]}`;
    case 8: return '同花順';
    default: return '';
  }
}

// ---------- Per-combo strengths for opponent range modelling ----------
const DRAW_EQ = {
  flop: { fd: 0.35, oesd: 0.315, gut: 0.165, combo: 0.54, fdGut: 0.45, over: 0.12 },
  turn: { fd: 0.196, oesd: 0.174, gut: 0.087, combo: 0.33, fdGut: 0.27, over: 0.06 },
};

/**
 * For every live combo: made-hand score, hand-strength percentile, draw equity estimate,
 * a blended strength `s` (0..1) and a coarse bucket for range composition.
 * Buckets: 0 nuts/monster, 1 strong, 2 medium, 3 draw, 4 weak/air
 */
export function comboStrengths(board, dead = []) {
  const n = board.length;
  const deadMask = new Uint8Array(52);
  for (const c of board) deadMask[c] = 1;
  for (const c of dead) deadMask[c] = 1;
  const bm = masksOf(board);
  const score = new Int32Array(NUM_COMBOS).fill(-1);
  const hs = new Float32Array(NUM_COMBOS);
  const draw = new Float32Array(NUM_COMBOS);
  const s = new Float32Array(NUM_COMBOS);
  const bucket = new Uint8Array(NUM_COMBOS).fill(255);
  const live = [];
  for (let k = 0; k < NUM_COMBOS; k++) {
    const a = COMBO_A[k], b = COMBO_B[k];
    if (deadMask[a] || deadMask[b]) continue;
    score[k] = evalWith(bm, a, b);
    live.push(k);
  }
  // percentile of made hand
  const sorted = live.slice().sort((x, y) => score[x] - score[y]);
  const L = sorted.length;
  let i = 0;
  while (i < L) {
    let j = i;
    while (j + 1 < L && score[sorted[j + 1]] === score[sorted[i]]) j++;
    const pct = (i + (j - i) / 2) / Math.max(1, L - 1);
    for (let t = i; t <= j; t++) hs[sorted[t]] = pct;
    i = j + 1;
  }
  const street = n === 3 ? 'flop' : n === 4 ? 'turn' : 'river';
  const bs = [0, 0, 0, 0];
  for (const c of board) bs[suitOf(c)]++;
  const bmask = rankMaskOf(board);
  const topB = n ? Math.max(...board.map(rankOf)) : -1;
  const boardInfo = boardSummary(board);
  for (const k of live) {
    const a = COMBO_A[k], b = COMBO_B[k];
    const cat = score[k] >> 20;
    let d = 0;
    if (street !== 'river') {
      const E = DRAW_EQ[street];
      let fd = false, sd = 0;
      if (cat < 5) {
        const sa = suitOf(a), sb = suitOf(b);
        if (sa === sb) { if (bs[sa] + 2 === 4) fd = true; }
        else { if (bs[sa] + 1 === 4 || bs[sb] + 1 === 4) fd = true; }
      }
      if (cat < 4) {
        const rm = bmask | bitOf(rankOf(a)) | bitOf(rankOf(b));
        const comp = COMPLETERS[rm];
        let hc = 0;
        for (let x = 0; x < 13; x++) if ((comp >> x) & 1) { if (STRAIGHT_HI[rm | (1 << x)] > STRAIGHT_HI[bmask | (1 << x)]) hc++; }
        sd = hc;
      }
      if (fd && sd >= 2) d = E.combo;
      else if (fd && sd === 1) d = E.fdGut;
      else if (fd) d = E.fd;
      else if (sd >= 2) d = E.oesd;
      else if (sd === 1) d = E.gut;
      if (cat === 0 && rankOf(a) > topB && rankOf(b) > topB) d = Math.max(d, E.over);
    }
    draw[k] = d;
    const h = hs[k];
    s[k] = Math.min(1, h + (1 - h) * d * 0.9);
    let bk = madeBucket(a, b, score[k], boardInfo);
    if (bk >= 3 && d >= 0.16) bk = 3;
    else if (bk === 2 && d >= 0.3) bk = 1; // medium made hand + strong draw plays like a strong hand
    bucket[k] = bk;
  }
  return { score, hs, draw, s, bucket, live };
}

/** Coarse made-hand class: 0 monster, 1 strong, 2 medium, 4 weak/air (3 reserved for draws). */
function madeBucket(a, b, score, B) {
  const cat = score >> 20;
  const ra = rankOf(a), rb = rankOf(b);
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (cat >= 4) return 0;
  if (cat === 3) {
    const t = (score >> 16) & 15;
    if (ra === rb && ra === t) return 0; // set
    if (ra === t || rb === t) return (ra === t ? rb : ra) >= 9 ? 0 : 1; // trips, kicker J+
    return 4; // trips on the board
  }
  if (cat === 2) {
    if (B.pairs >= 2) return (ra === rb && ra > B.second) || hi > B.top ? 2 : 4; // two pair on board
    if (ra === rb) return ra > B.pairedRank && ra > B.top ? 1 : 2; // pocket pair + board pair
    const hitA = B.ranks.includes(ra), hitB = B.ranks.includes(rb);
    if (hitA && hitB) return 0; // both hole cards pair
    return (hitA ? ra : rb) === B.top ? 1 : 2; // one pair + board pair
  }
  if (cat === 1) {
    if (ra === rb) {
      if (ra > B.top) return 1; // overpair
      if (ra > B.second) return 2;
      return 4;
    }
    const pr = B.ranks.includes(ra) ? ra : B.ranks.includes(rb) ? rb : -1;
    if (pr < 0) return 4; // board pair only
    const kick = pr === ra ? rb : ra;
    if (pr === B.top) return kick >= 10 || kick === 12 ? 1 : 2;
    if (pr === B.second) return 2;
    return 4;
  }
  return 4;
}

function boardSummary(board) {
  const ranks = board.map(rankOf);
  const uniq = [...new Set(ranks)].sort((x, y) => y - x);
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const pairedRanks = Object.keys(counts).filter((r) => counts[r] >= 2).map(Number);
  return {
    ranks, top: uniq[0] ?? -1, second: uniq[1] ?? -1,
    pairs: pairedRanks.length, pairedRank: pairedRanks.length ? Math.max(...pairedRanks) : -1,
  };
}

export const BUCKET_NAMES = ['怪物牌', '強牌', '中等牌', '聽牌', '弱牌/空氣'];

/** Range composition (by weight) over buckets. */
export function rangeComposition(cw, strengths) {
  const out = [0, 0, 0, 0, 0];
  let tot = 0;
  for (const k of strengths.live) {
    const w = cw[k];
    if (w <= 0) continue;
    out[strengths.bucket[k]] += w;
    tot += w;
  }
  return tot > 0 ? out.map((x) => x / tot) : out;
}

export function outsSummary(outs) {
  const groups = {};
  for (const o of outs) {
    if (o.strength === 'weak') continue;
    (groups[o.type] ||= []).push(o.card);
  }
  return Object.entries(groups).map(([type, cards]) => ({ type, count: cards.length, cards: cards.map(cardPretty) }));
}
