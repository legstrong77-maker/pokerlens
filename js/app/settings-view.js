// Settings: defaults, display, card recognition (on-device model + Claude AI), install help, about.
import { state, emit, SETTINGS_DEFAULT, newHand } from './state.js';
import { esc, haptic, toast, ICON, store } from './ui.js';
import { VILLAIN_TYPES, POS_SHORT } from '../core/charts.js';
import { MODELS } from './detector.js';
import { aiAvailable } from './vision-ai.js';

let root = null, onApply = null;
export function mountSettings(el, apply) {
  root = el; onApply = apply;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  render();
}

const AI_MODELS = [
  ['claude-opus-5', 'Claude Opus 5（預設，最準）'],
  ['claude-sonnet-5', 'Claude Sonnet 5（較快、較省）'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5（最快、最省）'],
];

function sw(id, on, label, desc) {
  return `<div class="list-item"><div class="grow"><div class="t">${label}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>
    <label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="${label}"><i></i></label></div>`;
}

async function render() {
  if (!root) return;
  const s = state.settings;
  const inArtifact = !!(window.claude && typeof window.claude.use === 'function');
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><span>設定</span><span class="en">SETTINGS</span></div>
    <div class="list">
      <button class="list-item" data-x="setup" style="text-align:left"><div class="grow"><div class="t">牌局預設</div>
        <div class="d">${s.tableSize} 人桌 · ${s.stack} BB · 開池 ${s.openSize} BB · 你在 ${esc(POS_SHORT[state.hand.heroPos])} · 對手 ${esc((VILLAIN_TYPES[s.villainType] || VILLAIN_TYPES.unknown).short)}</div></div>${ICON.chevron}</button>
      ${sw('set-4c', s.fourColor, '四色牌', '♦ 藍、♣ 綠，一眼分清花色')}
      ${sw('set-hap', s.haptics, '觸覺回饋', '點擊時輕微震動（iOS 18 以上）')}
      <div class="list-item"><div class="grow"><div class="t">每 BB 金額</div><div class="d">填入後建議尺寸會同時顯示金額（0 = 只顯示 BB）</div></div>
        <input class="kbd-input" id="set-bbv" type="number" inputmode="decimal" min="0" step="any" style="width:90px;min-height:38px" value="${s.bbValue || 0}" aria-label="每 BB 金額"></div>
    </div>

    <div class="section-title"><span>牌面辨識</span><span class="en">VISION</span></div>
    <div class="list">
      <div class="list-item" style="display:block"><div class="t">裝置端模型（離線、即時）</div>
        <div class="d" style="margin-bottom:8px">在手機上直接辨識，不上傳照片</div>
        <div class="seg">${[['fast', '快速'], ['accurate', '高精度'], ['off', '關閉']].map(([k, l]) => `<button class="${(s.detectModel || 'fast') === k ? 'on' : ''}" data-dm="${k}">${l}</button>`).join('')}</div>
        <div class="d" style="margin-top:8px">${esc((MODELS[s.detectModel || 'fast'] || { desc: '只使用 AI 或手動選牌' }).desc)}</div></div>
      ${sw('set-gpu', !!s.gpu, 'GPU 加速（實驗）', '使用 WebGPU 加速即時辨識；首次需下載約 27 MB')}
      <div class="list-item" style="display:block"><div class="t">✦ AI 精準辨識（Claude）</div>
        <div class="d" id="ai-status" style="margin:4px 0 10px">${inArtifact ? '在 Claude 內開啟：使用你的 Claude 帳號，不需金鑰。' : '讀取整張照片（含底池與下注），適合線上牌局截圖或難辨識的牌。'}</div>
        ${inArtifact ? '' : `
        <input class="kbd-input" id="set-key" type="password" autocomplete="off" placeholder="Anthropic API 金鑰（sk-ant-…）" value="${esc(s.aiKey || '')}" aria-label="Anthropic API 金鑰">
        <select class="kbd-input" id="set-model" style="margin-top:8px" aria-label="AI 模型">${AI_MODELS.map(([v, l]) => `<option value="${v}" ${s.aiModel === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="d" style="margin-top:8px">金鑰只存在這支手機的瀏覽器中，並直接傳給 Anthropic。每次辨識約數美分以下。</div>`}
      </div>
    </div>

    <div class="section-title"><span>安裝到主畫面</span><span class="en">IPHONE</span></div>
    <div class="panel" style="margin-top:0">
      ${standalone ? '<div class="t">✓ 已從主畫面開啟，可全螢幕使用。</div>' : `<ol class="reasons" style="padding-left:0">
        <li>用 Safari 開啟本頁網址</li><li>點下方「分享」按鈕 <span class="mono">⬆︎</span></li><li>選「加入主畫面」→ 新增</li></ol>
        <p class="hint" style="margin:8px 0 0">安裝後像 App 一樣全螢幕開啟、可離線使用、相機權限會被記住。</p>`}
    </div>

    <div class="section-title"><span>關於</span><span class="en">ABOUT</span></div>
    <div class="panel" style="margin-top:0">
      <p style="margin:0 0 8px;font-weight:700">PokerLens 牌眼 · v1.0</p>
      <p class="disclaimer" style="margin:0">勝率由內建 7 張牌評估器計算（翻牌後單挑為精確列舉，其他為蒙地卡羅）。策略引擎結合翻前範圍表、Nash 推擠/棄牌、對手範圍的貝氏收斂，以及各行動 EV 比較。建議僅供學習與參考，不保證獲利。</p>
      <p class="disclaimer" style="margin:8px 0 0">公平競技：多數娛樂場與線上平台禁止在牌局進行中使用即時輔助工具（RTA）。請用於練習、復盤，或經所有玩家同意的私人牌局。</p>
      <p class="disclaimer" style="margin:8px 0 0">裝置端辨識模型為開源 YOLO 權重（Ultralytics，AGPL-3.0）。</p>
    </div>
    <button class="btn block" style="margin-top:14px" data-x="reset">${ICON.trash}重設所有設定與紀錄</button>
    <div style="height:20px"></div>`;
  const st = root.querySelector('#ai-status');
  if (!inArtifact && st) aiAvailable().then((b) => { if (b) st.textContent = '✓ 已啟用：掃描畫面會出現「AI 精準辨識」。'; });
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !root.contains(b)) return;
  haptic();
  const s = state.settings;
  if (b.dataset.x === 'setup') { import('./setup.js').then((m) => m.openSetup(() => { onApply && onApply(); render(); })); return; }
  if (b.dataset.dm) { s.detectModel = b.dataset.dm; emit('settings'); render(); toast(`辨識模型：${{ fast: '快速', accurate: '高精度', off: '關閉' }[b.dataset.dm]}`); return; }
  if (b.dataset.x === 'reset') {
    const confirmRow = root.querySelector('[data-x="reset"]');
    if (!confirmRow.dataset.armed) { confirmRow.dataset.armed = '1'; confirmRow.textContent = '再按一次確認重設'; setTimeout(() => { if (confirmRow.isConnected) { delete confirmRow.dataset.armed; render(); } }, 3000); return; }
    Object.assign(state.settings, SETTINGS_DEFAULT, { seenIntro: true });
    state.history = [];
    state.hand = newHand(state.settings);
    emit('reset');
    onApply && onApply();
    render();
    toast('已重設');
  }
}
function onChange(e) {
  const t = e.target, s = state.settings;
  if (t.id === 'set-4c') s.fourColor = t.checked;
  else if (t.id === 'set-hap') s.haptics = t.checked;
  else if (t.id === 'set-gpu') s.gpu = t.checked;
  else if (t.id === 'set-bbv') s.bbValue = Math.max(0, parseFloat(t.value) || 0);
  else if (t.id === 'set-key') { s.aiKey = t.value.trim(); toast(s.aiKey ? 'AI 金鑰已儲存在本機' : '已移除 AI 金鑰'); }
  else if (t.id === 'set-model') s.aiModel = t.value;
  else return;
  emit('settings');
  onApply && onApply();
  if (t.id === 'set-key') render();
}
