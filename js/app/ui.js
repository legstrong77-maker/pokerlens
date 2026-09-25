// Shared UI helpers: icons, card markup, sheets, toast, haptics, formatting.
import { rankOf, suitOf, RANK_LABELS, SUIT_SYMBOLS } from '../core/cards.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SUIT_CLASS = ['suit-c', 'suit-d', 'suit-h', 'suit-s'];
export const suitClass = (c) => SUIT_CLASS[suitOf(c)];

export function cardHTML(c, extra = '') {
  if (c == null || c < 0) return '';
  const r = RANK_LABELS[rankOf(c)], s = SUIT_SYMBOLS[suitOf(c)];
  return `<div class="pcard ${suitClass(c)} ${extra}" aria-label="${r}${s}"><span class="r">${r}</span><span class="s">${s}</span><span class="pip">${s}</span></div>`;
}
export function miniCardHTML(c, attrs = '') {
  if (c == null || c < 0) return `<span class="mini-slot" ${attrs}>+</span>`;
  const r = RANK_LABELS[rankOf(c)], s = SUIT_SYMBOLS[suitOf(c)];
  return `<span class="mini-card ${suitClass(c)}" ${attrs}>${r}<span class="s">${s}</span></span>`;
}
export function cardText(c) {
  if (c == null || c < 0) return '?';
  return RANK_LABELS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)];
}

export function fmtBB(x, withUnit = true) {
  if (x == null || !isFinite(x)) return '—';
  const a = Math.abs(x);
  let s = a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(2);
  s = s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return withUnit ? `${s} BB` : s;
}
export const pct = (x, d = 1) => (x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);

// ---------- Icons (inline SVG, stroke-based) ----------
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  table: I('<ellipse cx="12" cy="12" rx="9.5" ry="6.5"/><rect x="8.2" y="9.2" width="3.2" height="4.6" rx=".7"/><rect x="12.6" y="9.2" width="3.2" height="4.6" rx=".7"/>'),
  grid: I('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  camera: I('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.6"/>'),
  tools: I('<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  reset: I('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/>'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  photo: I('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8.5"/>'),
  video: I('<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3z"/>'),
  spark: I('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  chevron: I('<path d="M9 6l6 6-6 6"/>'),
  swap: I('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  flash: I('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'),
  history: I('<path d="M12 7v5l3 2"/><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/>'),
  trash: I('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  minus: I('<path d="M5 12h14"/>'),
  edit: I('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>'),
  download: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
};

// ---------- Toast ----------
let toastTimer = 0;
export function toast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Haptics (iOS 18+ switch trick, Android vibrate) ----------
let hapticLabel = null;
export let hapticsEnabled = true;
export function setHaptics(on) { hapticsEnabled = on; }
export function haptic() {
  if (!hapticsEnabled) return;
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
      hapticLabel.setAttribute('aria-hidden', 'true');
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
      hapticLabel.appendChild(inp);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch { /* ignore */ }
}

// ---------- Bottom sheets ----------
let sheetStack = [];
export function openSheet(html, { onMount, onClose, id = 'sheet' } = {}) {
  closeSheet(true);
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.id = id;
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bd, sh);
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
  const entry = { bd, sh, onClose };
  sheetStack.push(entry);
  bd.addEventListener('click', () => closeSheet());
  // swipe down to close
  let y0 = null, dy = 0;
  sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) sh.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (y0 == null) return;
    sh.style.transform = '';
    if (dy > 90) closeSheet();
    y0 = null;
  });
  onMount && onMount(sh);
  return sh;
}
export function closeSheet(immediate = false) {
  const e = sheetStack.pop();
  if (!e) return;
  const { bd, sh, onClose } = e;
  if (immediate) { bd.remove(); sh.remove(); }
  else {
    bd.classList.remove('show'); sh.classList.remove('show');
    setTimeout(() => { bd.remove(); sh.remove(); }, 320);
  }
  onClose && onClose();
}
export const sheetOpen = () => sheetStack.length > 0;

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Storage (guarded) ----------
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } },
};

/** Map an engine action key to display classes / English signage word. */
export const ACTION_EN = { fold: 'FOLD', check: 'CHECK', call: 'CALL', bet: 'BET', raise: 'RAISE', allin: 'ALL-IN' };
export const ACTION_ZH = { fold: '棄牌', check: '過牌', call: '跟注', bet: '下注', raise: '加注', allin: '全下' };
