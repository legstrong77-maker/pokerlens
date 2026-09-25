// Card encoding: id = rank * 4 + suit
//   rank 0..12 => 2,3,4,5,6,7,8,9,T,J,Q,K,A
//   suit 0..3  => c (♣), d (♦), h (♥), s (♠)

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const SUIT_NAMES = ['梅花', '方塊', '紅心', '黑桃'];
export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const makeCard = (rank, suit) => rank * 4 + suit;

const SUIT_ALIASES = {
  c: 0, '♣': 0, '♧': 0,
  d: 1, '♦': 1, '♢': 1,
  h: 2, '♥': 2, '♡': 2,
  s: 3, '♠': 3, '♤': 3,
};

/** Parse "As", "10h", "Td", "a♠", "Q♥" -> card id, or -1 when invalid. */
export function parseCard(str) {
  if (typeof str !== 'string') return -1;
  let t = str.trim();
  if (t.length < 2) return -1;
  const suitCh = t.slice(-1);
  let rankStr = t.slice(0, -1).toUpperCase();
  const suit = SUIT_ALIASES[suitCh.toLowerCase()] ?? SUIT_ALIASES[suitCh];
  if (suit === undefined) return -1;
  if (rankStr === '10' || rankStr === '1') rankStr = 'T';
  const rank = RANK_CHARS.indexOf(rankStr);
  if (rank < 0 || rankStr.length !== 1) return -1;
  return makeCard(rank, suit);
}

export function parseCards(str) {
  if (!str) return [];
  const out = [];
  const re = /(10|[2-9TJQKAtjqka])\s*([cdhsCDHS♣♦♥♠♧♢♡♤])/g;
  let m;
  while ((m = re.exec(str))) {
    const c = parseCard(m[1] + m[2].toLowerCase());
    if (c >= 0) out.push(c);
  }
  return out;
}

export const cardToString = (c) => RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
export const cardsToString = (cs) => cs.map(cardToString).join(' ');
export const cardPretty = (c) => RANK_LABELS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)];

// ---------- Combos (two-card hands) ----------
// 1326 combos, index for (a < b).
export const NUM_COMBOS = 1326;
export const COMBO_A = new Uint8Array(NUM_COMBOS);
export const COMBO_B = new Uint8Array(NUM_COMBOS);
export const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);
{
  let k = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      COMBO_A[k] = a;
      COMBO_B[k] = b;
      COMBO_INDEX[a * 52 + b] = k;
      COMBO_INDEX[b * 52 + a] = k;
      k++;
    }
  }
}
export const comboIndex = (a, b) => COMBO_INDEX[a * 52 + b];

// ---------- 169 hand classes ----------
// Grid index = row * 13 + col, rows/cols ordered A,K,Q,...,2 (index 0 = A).
// row == col: pair; row < col: suited (upper-right); row > col: offsuit (lower-left).
export const NUM_CLASSES = 169;
export const gridRank = (i) => 12 - i; // grid index -> rank

export function classOfCards(a, b) {
  const ra = rankOf(a), rb = rankOf(b);
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  const i = 12 - hi, j = 12 - lo;
  if (hi === lo) return i * 13 + i;
  if (suitOf(a) === suitOf(b)) return i * 13 + j; // suited: row < col
  return j * 13 + i; // offsuit: row > col
}

export function className(cls) {
  const row = Math.floor(cls / 13), col = cls % 13;
  const r1 = RANK_CHARS[12 - Math.min(row, col)];
  const r2 = RANK_CHARS[12 - Math.max(row, col)];
  if (row === col) return r1 + r2;
  return r1 + r2 + (row < col ? 's' : 'o');
}

export function classType(cls) {
  const row = Math.floor(cls / 13), col = cls % 13;
  if (row === col) return 'pair';
  return row < col ? 'suited' : 'offsuit';
}

export const CLASS_COMBO_COUNT = new Uint8Array(NUM_CLASSES);
export const COMBO_CLASS = new Uint8Array(NUM_COMBOS);
export const CLASS_COMBOS = Array.from({ length: NUM_CLASSES }, () => []);
for (let k = 0; k < NUM_COMBOS; k++) {
  const cls = classOfCards(COMBO_A[k], COMBO_B[k]);
  COMBO_CLASS[k] = cls;
  CLASS_COMBOS[cls].push(k);
  CLASS_COMBO_COUNT[cls]++;
}

export function classFromName(name) {
  if (!name) return -1;
  const n = name.trim().toUpperCase().replace('10', 'T');
  const r1 = RANK_CHARS.indexOf(n[0]);
  const r2 = RANK_CHARS.indexOf(n[1]);
  if (r1 < 0 || r2 < 0) return -1;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const i = 12 - hi, j = 12 - lo;
  if (hi === lo) return i * 13 + i;
  const t = n[2];
  if (t === 'S') return i * 13 + j;
  if (t === 'O') return j * 13 + i;
  return -1;
}

// ---------- Fast PRNG (xorshift128+ style, 32-bit) ----------
export function makeRng(seed = (Math.random() * 0xffffffff) >>> 0) {
  let x = seed >>> 0 || 0x9e3779b9;
  let y = 0x243f6a88, z = 0xb7e15162, w = 0xdeadbeef ^ x;
  const next = () => {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  };
  for (let i = 0; i < 8; i++) next();
  return {
    next,
    float: () => next() / 4294967296,
    int: (n) => (next() % n),
  };
}

export function isRed(c) {
  const s = suitOf(c);
  return s === 1 || s === 2;
}
