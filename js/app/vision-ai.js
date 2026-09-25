// "AI 精準辨識": read the whole table from one photo/screenshot with Claude vision.
// Returns cards plus pot / amount to call / players / hero position when visible (in BB).
import { state } from './state.js';
import { parseCard } from '../core/cards.js';
import {
  artifactSample, aiBackend, apiClient, apiErrorZh, blobToBase64, modelParams, toJpegBlob, SAMPLE_ERR_ZH,
} from './claude-client.js';

export { toJpegBlob };

const PROMPT = `You are reading a photo of a Texas Hold'em table taken from the player's own seat (first-person view), or a screenshot of an online poker client.
Report only what you can actually see:
1. "hero": the player's own two hole cards (nearest the camera / bottom of the picture; in a screenshot, the face-up cards at the hero seat).
2. "board": community cards left to right (0, 3, 4 or 5).
3. "bigBlind": the big blind size if shown (table title like "$1/$2", blinds posted, or a BB display), else null.
4. "pot": the total pot now, including bets already made on this street, else null.
5. "toCall": the amount the hero must add to call (0 if nobody bet), else null.
6. "players": how many players are still in the hand (including the hero), else null.
7. "heroPosition": the hero's position if it can be derived (dealer button, seat labels): one of UTG, UTG1, UTG2, LJ, HJ, CO, BTN, SB, BB, else null.
8. "unit": "bb" if amounts are shown in big blinds, "chips" otherwise.
Card notation: rank (2-9, T, J, Q, K, A) + suit (c, d, h, s), e.g. "As", "Td", "7h". If a card is unclear, leave it out and say so in "notes". Never invent cards; a deck has no duplicates.
Reply with only JSON, exactly this shape:
{"hero":["As","Kd"],"board":["Qh","7c","2d"],"bigBlind":2,"pot":24,"toCall":8,"players":3,"heroPosition":null,"unit":"chips","confidence":"high","notes":"一句繁體中文說明"}
"confidence" is "high", "medium" or "low".`;

const POS = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const SCHEMA = {
  type: 'object',
  properties: {
    hero: { type: 'array', items: { type: 'string' } },
    board: { type: 'array', items: { type: 'string' } },
    bigBlind: { type: ['number', 'null'] },
    pot: { type: ['number', 'null'] },
    toCall: { type: ['number', 'null'] },
    players: { type: ['integer', 'null'] },
    heroPosition: { type: ['string', 'null'] },
    unit: { type: 'string', enum: ['bb', 'chips'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' },
  },
  required: ['hero', 'board', 'bigBlind', 'pot', 'toCall', 'players', 'heroPosition', 'unit', 'confidence', 'notes'],
  additionalProperties: false,
};

function normalize(obj) {
  const cards = (arr) => (Array.isArray(arr) ? arr : []).map((x) => parseCard(String(x))).filter((c) => c >= 0);
  const hero = cards(obj.hero).slice(0, 2);
  const seen = new Set(hero);
  const board = [];
  for (const c of cards(obj.board)) if (!seen.has(c) && board.length < 5) { seen.add(c); board.push(c); }
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);
  // convert chip amounts to big blinds
  let per = 1;
  if (obj.unit !== 'bb') per = num(obj.bigBlind) || (state.settings.bbValue > 0 ? state.settings.bbValue : 1);
  const bb = (v) => (num(v) == null ? null : Math.round((v / per) * 10) / 10);
  return {
    hero, board,
    pot: bb(obj.pot), toCall: bb(obj.toCall),
    players: Number.isInteger(obj.players) && obj.players >= 2 && obj.players <= 10 ? obj.players : null,
    heroPosition: POS.includes(obj.heroPosition) ? obj.heroPosition : null,
    converted: per !== 1,
    confidence: ['high', 'medium', 'low'].includes(obj.confidence) ? obj.confidence : 'medium',
    notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 300) : '',
  };
}

/** Which AI backend is usable right now: 'artifact' | 'apikey' | null */
export async function aiAvailable() {
  const b = await aiBackend();
  if (b !== 'artifact') return b;
  const a = await artifactSample();
  return a && a.images ? 'artifact' : (state.settings.aiKey ? 'apikey' : null);
}

/** Read a table photo. `image` is a Blob/File or a drawable element. */
export async function readTable(image, { signal, quick = false } = {}) {
  const blob = image instanceof Blob ? image : await toJpegBlob(image, 1568, 0.88);
  const art = await artifactSample();
  if (art && art.images) {
    try {
      const data = await art.sample.json(PROMPT, { images: [blob], modelTier: quick ? 'quick' : 'default', signal });
      return { ...normalize(data || {}), backend: 'artifact' };
    } catch (e) {
      throw new Error(SAMPLE_ERR_ZH[e?.code] || e?.message || 'Claude 辨識失敗');
    }
  }
  if (!state.settings.aiKey) throw new Error('尚未設定 AI 辨識：到「設定」輸入你的 Anthropic API 金鑰。');
  const { Anthropic, client } = await apiClient();
  const model = state.settings.aiModel || 'claude-opus-5';
  const data = await blobToBase64(blob);
  let response;
  try {
    const p = modelParams(model);
    response = await client.beta.messages.create({
      model,
      max_tokens: 2048,
      ...p,
      output_config: { ...(p.output_config || {}), format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }, { signal });
  } catch (err) {
    throw new Error(apiErrorZh(err, Anthropic));
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude 無法處理這張圖片，請換一張。');
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('沒有收到辨識結果，請再試一次。');
  let parsed;
  try { parsed = JSON.parse(textBlock.text); } catch { throw new Error('辨識結果格式錯誤，請再試一次。'); }
  return { ...normalize(parsed), backend: 'apikey', model: response.model };
}
