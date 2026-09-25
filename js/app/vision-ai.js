// "AI 精準辨識": read the whole table from a photo with Claude vision.
// Backend 1: inside a claude.ai Artifact -> the `sample` capability (viewer's own Claude account).
// Backend 2: standalone PWA -> the official Anthropic SDK with the user's own API key.
import { state } from './state.js';
import { parseCard } from '../core/cards.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';

const PROMPT = `You are reading a photo of a Texas Hold'em table taken from the player's own seat (first-person view), or a screenshot of an online poker client.
Identify:
1. "hero": the player's own two hole cards (usually nearest the camera / bottom of the picture, often held or lying in front of the player; in a screenshot, the cards shown face-up at the hero seat).
2. "board": the community cards in the middle of the table, left to right (0, 3, 4 or 5 cards).
3. "pot": the total pot if a number is visible (chip counts or on-screen text), else null.
4. "toCall": the amount the hero must call if visible, else null.
5. "players": how many players are still in the hand if you can tell, else null.
Card notation: rank (2-9, T, J, Q, K, A) + suit (c, d, h, s), e.g. "As", "Td", "7h". Only report cards you can actually see. If a card is unclear, leave it out and say so in "notes". Never invent cards; a deck has no duplicates.
Reply with only JSON, exactly this shape:
{"hero":["As","Kd"],"board":["Qh","7c","2d"],"pot":null,"toCall":null,"players":null,"confidence":"high","notes":"一句繁體中文說明"}
"confidence" is "high", "medium" or "low".`;

const SCHEMA = {
  type: 'object',
  properties: {
    hero: { type: 'array', items: { type: 'string' } },
    board: { type: 'array', items: { type: 'string' } },
    pot: { type: ['number', 'null'] },
    toCall: { type: ['number', 'null'] },
    players: { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' },
  },
  required: ['hero', 'board', 'pot', 'toCall', 'players', 'confidence', 'notes'],
  additionalProperties: false,
};

let samplePromise = null;
function artifactSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      try {
        if (!window.claude || typeof window.claude.use !== 'function') return null;
        const s = await window.claude.use('sample');
        if (!s) return null;
        const lim = await s.limits().catch(() => null);
        return lim && lim.images ? s : null;
      } catch { return null; }
    })();
  }
  return samplePromise;
}

/** Which AI backend is usable right now: 'artifact' | 'apikey' | null */
export async function aiAvailable() {
  if (await artifactSample()) return 'artifact';
  if (state.settings.aiKey) return 'apikey';
  return null;
}

/** Downscale an image/canvas/video frame to a JPEG blob (long side <= maxSide). */
export async function toJpegBlob(source, maxSide = 1568, quality = 0.88) {
  const w0 = source.videoWidth || source.naturalWidth || source.width;
  const h0 = source.videoHeight || source.naturalHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function normalize(obj) {
  const cards = (arr) => (Array.isArray(arr) ? arr : []).map((x) => parseCard(String(x))).filter((c) => c >= 0);
  const hero = cards(obj.hero).slice(0, 2);
  const used = new Set(hero);
  const board = cards(obj.board).filter((c) => !used.has(c) && (used.add(c), true)).slice(0, 5);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  return {
    hero, board, pot: num(obj.pot), toCall: num(obj.toCall), players: num(obj.players),
    confidence: ['high', 'medium', 'low'].includes(obj.confidence) ? obj.confidence : 'medium',
    notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 300) : '',
  };
}

const ERR_ZH = {
  not_granted: '你沒有允許這個頁面使用 Claude。',
  sampling_disabled: '此帳號無法使用 Claude 辨識。',
  images_unavailable: '此檢視無法傳送圖片給 Claude。',
  image_rejected: '圖片格式或大小不支援，請換一張照片。',
  rate_limited: '使用太頻繁或已達用量上限，請稍後再試。',
  session_expired: '請重新登入 Claude。',
  refused: 'Claude 無法處理這張圖片，請換一張。',
  invalid_json: '辨識結果格式錯誤，請再試一次。',
  cancelled: '已取消。',
};

/**
 * Read a table photo. `image` is a Blob/File (JPEG/PNG/WebP) or a drawable element.
 * Resolves { hero:[ids], board:[ids], pot, toCall, players, confidence, notes, backend }.
 */
export async function readTable(image, { signal, quick = false } = {}) {
  const blob = image instanceof Blob ? image : await toJpegBlob(image);
  const sample = await artifactSample();
  if (sample) {
    try {
      const data = await sample.json(PROMPT, { images: [blob], modelTier: quick ? 'quick' : 'default', signal });
      return { ...normalize(data || {}), backend: 'artifact' };
    } catch (e) {
      throw new Error(ERR_ZH[e?.code] || e?.message || 'Claude 辨識失敗');
    }
  }
  const key = state.settings.aiKey;
  if (!key) throw new Error('尚未設定 AI 辨識：到「設定」輸入你的 Anthropic API 金鑰。');
  const { default: Anthropic } = await import(/* @vite-ignore */ SDK_URL);
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const data = await blobToBase64(blob);
  let response;
  try {
    response = await client.beta.messages.create({
      model: state.settings.aiModel || 'claude-opus-5',
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }, { signal });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('API 金鑰無效，請到設定檢查。');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('此金鑰沒有使用該模型的權限。');
    if (err instanceof Anthropic.RateLimitError) throw new Error('請求太頻繁或額度不足，請稍後再試。');
    if (err instanceof Anthropic.BadRequestError) throw new Error('請求被拒絕：' + (err.message || '格式錯誤'));
    if (err instanceof Anthropic.APIConnectionError) throw new Error('無法連線到 Claude，請檢查網路。');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude 服務錯誤 (${err.status})`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude 無法處理這張圖片，請換一張。');
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('沒有收到辨識結果，請再試一次。');
  let parsed;
  try { parsed = JSON.parse(textBlock.text); } catch { throw new Error('辨識結果格式錯誤，請再試一次。'); }
  return { ...normalize(parsed), backend: 'apikey', model: response.model };
}
