// Shared Claude access for the page: artifact `sample` capability (viewer's Claude account)
// or the official Anthropic SDK with the user's own API key (standalone PWA).
import { state } from './state.js';

export const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';

// $ per 1M tokens (input, output) for the cost readout
export const PRICES = {
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
};

let sdkPromise = null;
export function loadSdk() {
  if (!sdkPromise) sdkPromise = import(/* @vite-ignore */ SDK_URL).then((m) => m.default);
  return sdkPromise;
}

export async function apiClient() {
  const Anthropic = await loadSdk();
  return { Anthropic, client: new Anthropic({ apiKey: state.settings.aiKey, dangerouslyAllowBrowser: true }) };
}

/** Model-specific request params: effort only where supported; server-side fallbacks on Opus 5. */
export function modelParams(model, effort = 'low') {
  const p = {};
  if (model === 'claude-opus-5') {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  if (model === 'claude-opus-5' || model === 'claude-sonnet-5') p.output_config = { effort };
  return p;
}

let samplePromise = null;
/** Resolves { sample, images, tools } inside a claude.ai Artifact viewer, else null. */
export function artifactSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      try {
        if (!window.claude || typeof window.claude.use !== 'function') return null;
        const sample = await window.claude.use('sample');
        if (!sample) return null;
        const lim = await sample.limits().catch(() => null);
        return { sample, images: !!lim?.images, tools: !!lim?.tools };
      } catch { return null; }
    })();
  }
  return samplePromise;
}

/** 'artifact' | 'apikey' | null */
export async function aiBackend() {
  if (await artifactSample()) return 'artifact';
  if (state.settings.aiKey) return 'apikey';
  return null;
}

export const SAMPLE_ERR_ZH = {
  not_granted: '你沒有允許這個頁面使用 Claude。',
  sampling_disabled: '此帳號無法使用 Claude。',
  images_unavailable: '此檢視無法傳送圖片給 Claude。',
  tools_unavailable: '此檢視無法讓 Claude 呼叫計算工具。',
  image_rejected: '圖片格式或大小不支援，請換一張。',
  rate_limited: '使用太頻繁或已達用量上限，請稍後再試。',
  session_expired: '請重新登入 Claude。',
  refused: 'Claude 無法處理這個請求。',
  invalid_json: '結果格式錯誤，請再試一次。',
  cancelled: '已取消。',
  empty_completion: 'Claude 沒有回覆內容，請再試一次。',
  prompt_too_large: '內容太長。',
};

/** Map SDK errors to short Traditional Chinese messages (most specific first). */
export function apiErrorZh(err, Anthropic) {
  if (!Anthropic) return err?.message || String(err);
  if (err instanceof Anthropic.AuthenticationError) return 'API 金鑰無效，請到設定檢查。';
  if (err instanceof Anthropic.PermissionDeniedError) return '此金鑰沒有使用該模型的權限。';
  if (err instanceof Anthropic.RateLimitError) return '請求太頻繁或額度不足，請稍後再試。';
  if (err instanceof Anthropic.BadRequestError) return '請求被拒絕：' + (err.message || '格式錯誤');
  if (err instanceof Anthropic.APIConnectionError) return '無法連線到 Claude，請檢查網路。';
  if (err instanceof Anthropic.APIUserAbortError) return '已取消。';
  if (err instanceof Anthropic.APIError) return `Claude 服務錯誤 (${err.status})`;
  return err?.message || String(err);
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Downscale an image/canvas/video frame to a JPEG blob (long side <= maxSide). */
export async function toJpegBlob(source, maxSide = 1280, quality = 0.85) {
  const w0 = source.videoWidth || source.naturalWidth || source.width;
  const h0 = source.videoHeight || source.naturalHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
}

/**
 * Streaming manual tool loop (Anthropic SDK). `client` is injectable for tests.
 * tools: [{ def: Anthropic.Tool, validate(input) -> string|null (error), run(input) -> object }]
 * Returns { text, calls:[{name,input,result}], usage:{input,output}, stopReason }.
 */
export async function runToolLoop({ client, Anthropic, model, system, messages, tools, onText, onStatus, signal, maxRounds = 4 }) {
  const toolDefs = tools.map((t) => ({ ...t.def, eager_input_streaming: true }));
  const byName = new Map(tools.map((t) => [t.def.name, t]));
  const calls = [];
  const usage = { input: 0, output: 0 };
  let text = '';
  let jsonRetries = 0;
  for (let round = 0; round < maxRounds; round++) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 16000,
      system,
      tools: toolDefs,
      messages,
      ...modelParams(model),
    }, { signal });
    let roundText = '';
    stream.on('text', (delta) => { roundText += delta; onText && onText(text + roundText, delta); });
    let message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if ((Anthropic && err instanceof Anthropic.APIError) || jsonRetries++ >= 2) throw err;
      onStatus && onStatus('工具參數解析失敗，重試中…');
      round--;
      continue;
    }
    usage.input += message.usage?.input_tokens || 0;
    usage.output += message.usage?.output_tokens || 0;
    text += roundText;
    if (message.stop_reason === 'refusal') return { text, calls, usage, stopReason: 'refusal' };
    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    // a tool input cut off at max_tokens can still parse: never run it
    if (message.stop_reason === 'max_tokens' && toolUses.length) throw new Error('回覆被截斷，請再試一次');
    if (message.stop_reason !== 'tool_use' || !toolUses.length) return { text, calls, usage, stopReason: message.stop_reason };
    messages.push({ role: 'assistant', content: message.content });
    const results = [];
    for (const tu of toolUses) {
      const t = byName.get(tu.name);
      const err = !t ? `unknown tool ${tu.name}` : t.validate(tu.input);
      if (err) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_INPUT: err }) });
        continue;
      }
      onStatus && onStatus(tu.name === 'analyze_spot' ? '計算勝率與 EV…' : '計算中…');
      try {
        const out = await t.run(tu.input);
        calls.push({ name: tu.name, input: tu.input, result: out });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: String(e?.message || e) });
      }
    }
    messages.push({ role: 'user', content: results });
    if (text && !text.endsWith('\n')) text += '\n';
  }
  return { text, calls, usage, stopReason: 'max_rounds' };
}

export function costUSD(model, usage) {
  const [pi, po] = PRICES[model] || PRICES['claude-opus-5'];
  return (usage.input * pi + usage.output * po) / 1e6;
}
