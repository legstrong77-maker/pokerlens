// AI 即時分析師: Claude reads the table (photo + app state), calls the local poker engine as
// tools for exact numbers, and streams back a recommendation with reasons (zh-TW).
import { state } from './state.js';
import { engine } from './engine-client.js';
import { parseCard } from '../core/cards.js';
import { positionsFor } from '../core/charts.js';
import {
  artifactSample, aiBackend, apiClient, apiErrorZh, blobToBase64, runToolLoop, costUSD, SAMPLE_ERR_ZH,
} from './claude-client.js';

const POS = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const SYSTEM = `You are 牌眼分析師, a professional No-Limit Texas Hold'em coach giving the player live advice during a hand.

Each request contains:
- APP STATE: what the app already knows (hero position, table size, stacks in big blinds, cards detected by the on-device model, the betting actions the player recorded, pot and amount to call).
- ENGINE RESULT: the app's poker engine run on that state (equity vs the modelled opponent range, pot odds, EV of every action, recommended action).
- Sometimes a photo from the player's seat (first-person) or a screenshot of an online client.

How to work:
1. Check the photo against APP STATE. Recorded actions and detected cards are usually right; use the photo to fill gaps (board cards, pot, bet sizes, stacks, dealer button, how many players are still in). Never invent cards you cannot see. If something important is missing, make a reasonable assumption and say so.
2. If the photo shows the situation differs from APP STATE (other board cards, a different bet or pot), call analyze_spot with the corrected situation and use its numbers. Otherwise rely on ENGINE RESULT. Use hand_equity to test a specific opponent range when it helps. Quote numbers only from ENGINE RESULT or tool results.
3. You may disagree with the engine when the photo or action history shows something it could not model (sizing tells, a very tight or loose player, multiway dynamics). Say why.

Reply in Traditional Chinese (Taiwan poker terms), readable at a glance, in exactly this format:
建議：<動作與尺寸，例如「加注到 12 BB」或「棄牌」>
勝率：<xx%>｜需要：<yy%，沒有面對下注就寫「—」>
理由：
• <手牌強度與牌面>
• <對手範圍：位置與下注動作透露了什麼>
• <數學：勝率對比底池賠率、棄牌率或 EV>
• <為什麼選這個尺寸或打法>
下一步：<下一條街或被加注時怎麼做，一句話>
Keep each bullet under about 40 Chinese characters. No preamble, no markdown headings.`;

// ---------------------------------------------------------------- tools
const ANALYZE_DEF = {
  name: 'analyze_spot',
  description: "Run the PokerLens engine on a Hold'em decision. Returns the recommended action and size, mixed frequencies, hero equity vs the modelled opponent range, pot odds, EV in big blinds for every candidate action, hand reading (made hand, draws, outs) and the opponent range composition. Pass only the fields you want to change; everything else comes from APP STATE.",
  input_schema: {
    type: 'object',
    properties: {
      hero_cards: { type: 'array', items: { type: 'string' }, description: 'Hero hole cards, e.g. ["As","Kd"]' },
      board: { type: 'array', items: { type: 'string' }, description: '0, 3, 4 or 5 community cards, e.g. ["Qh","7c","2d"]' },
      hero_position: { type: 'string', enum: POS },
      players_at_table: { type: 'integer', description: 'Seats dealt in at the start of the hand (2-9)' },
      effective_stack_bb: { type: 'number' },
      pot_bb: { type: 'number', description: 'Pot before the bet hero is facing, in big blinds (postflop)' },
      to_call_bb: { type: 'number', description: 'Amount hero must add to call; 0 when checked to hero' },
      opponents_in_hand: { type: 'integer' },
      main_opponent_position: { type: 'string', enum: POS },
      hero_was_preflop_raiser: { type: 'boolean' },
      pot_type: { type: 'string', enum: ['srp', '3bet', '4bet', 'limped'] },
      preflop_situation: { type: 'string', enum: ['unopened', 'limped', 'vsOpen', 'vs3bet', 'vs4bet'] },
      preflop_raiser_position: { type: 'string', enum: POS },
      preflop_raise_to_bb: { type: 'number' },
      opponent_type: { type: 'string', enum: ['unknown', 'nit', 'tag', 'lag', 'station', 'maniac'] },
    },
  },
};
const EQUITY_DEF = {
  name: 'hand_equity',
  description: 'Equity (win + half ties) of the hero hand vs one or more opponents, each given as exact cards or a range string like "QQ+, AK, AQs". Exact enumeration heads-up after the flop, Monte Carlo otherwise.',
  input_schema: {
    type: 'object',
    properties: {
      hero_cards: { type: 'array', items: { type: 'string' } },
      board: { type: 'array', items: { type: 'string' } },
      opponents: {
        type: 'array',
        items: { type: 'object', properties: { cards: { type: 'array', items: { type: 'string' } }, range: { type: 'string' } } },
      },
    },
    required: ['opponents'],
  },
};

const isCardArr = (a, allowed) => Array.isArray(a) && a.every((x) => typeof x === 'string' && parseCard(x) >= 0) && (!allowed || allowed.includes(a.length));
function validateAnalyze(i) {
  if (!i || typeof i !== 'object') return 'input must be an object';
  if (i.hero_cards != null && !isCardArr(i.hero_cards, [2])) return 'hero_cards must be 2 cards like "As"';
  if (i.board != null && !isCardArr(i.board, [0, 3, 4, 5])) return 'board must have 0, 3, 4 or 5 cards';
  for (const k of ['hero_position', 'main_opponent_position', 'preflop_raiser_position']) if (i[k] != null && !POS.includes(i[k])) return `${k} invalid`;
  for (const k of ['effective_stack_bb', 'pot_bb', 'to_call_bb', 'preflop_raise_to_bb']) if (i[k] != null && !(typeof i[k] === 'number' && i[k] >= 0)) return `${k} must be a number >= 0`;
  for (const k of ['players_at_table', 'opponents_in_hand']) if (i[k] != null && !Number.isInteger(i[k])) return `${k} must be an integer`;
  return null;
}
function validateEquity(i) {
  if (!i || !Array.isArray(i.opponents) || !i.opponents.length) return 'opponents required';
  if (i.hero_cards != null && !isCardArr(i.hero_cards, [2])) return 'hero_cards must be 2 cards';
  if (i.board != null && !isCardArr(i.board, [0, 3, 4, 5])) return 'board must have 0, 3, 4 or 5 cards';
  for (const o of i.opponents) {
    if (o.cards != null && !isCardArr(o.cards, [2])) return 'opponent cards must be 2 cards';
    if (o.range != null && typeof o.range !== 'string') return 'range must be text';
  }
  return null;
}

/** Merge a tool input into the current engine spot. */
export function spotFromInput(input, base) {
  const sp = JSON.parse(JSON.stringify(base || {}));
  sp.hero = input.hero_cards ? input.hero_cards.map(parseCard) : sp.hero || [];
  sp.board = input.board ? input.board.map(parseCard) : sp.board || [];
  if (input.hero_position) sp.heroPos = input.hero_position;
  if (input.players_at_table) sp.tableSize = Math.max(2, Math.min(9, input.players_at_table));
  if (!positionsFor(sp.tableSize || 6).includes(sp.heroPos)) sp.heroPos = positionsFor(sp.tableSize || 6).includes('BTN') ? 'BTN' : 'BB';
  if (input.effective_stack_bb) sp.stack = input.effective_stack_bb;
  if (input.opponent_type) sp.villainType = input.opponent_type;
  if (!sp.board.length) {
    const pre = { ...(sp.preflop || { scenario: 'unopened' }) };
    if (input.preflop_situation) pre.scenario = input.preflop_situation;
    if (input.preflop_raiser_position) pre.openerPos = input.preflop_raiser_position;
    if (input.preflop_raise_to_bb) pre.openSize = input.preflop_raise_to_bb;
    sp.preflop = pre; delete sp.postflop;
  } else {
    const P = { villains: 1, potType: 'srp', heroAggressor: true, villainPos: 'BB', heroIP: true, facing: 'none', bet: 0, heroBet: 0, history: [], ...(sp.postflop || {}) };
    if (!sp.postflop) P.pot = 6;
    if (input.pot_bb != null) P.pot = Math.max(0.5, input.pot_bb);
    if (input.to_call_bb != null) { P.facing = input.to_call_bb > 0 ? 'bet' : 'none'; P.bet = input.to_call_bb; P.heroBet = 0; P.callersInFront = 0; }
    if (input.opponents_in_hand) P.villains = Math.max(1, input.opponents_in_hand);
    if (input.main_opponent_position) P.villainPos = input.main_opponent_position;
    if (input.hero_was_preflop_raiser != null) P.heroAggressor = input.hero_was_preflop_raiser;
    if (input.pot_type) P.potType = input.pot_type;
    if (input.effective_stack_bb) P.effStack = input.effective_stack_bb;
    P.villainChecked = P.heroIP && P.facing === 'none';
    sp.postflop = P; delete sp.preflop;
  }
  return sp;
}

const round = (x, d = 1) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
/** Small JSON summary of an engine result for Claude. */
export function compactResult(r) {
  if (!r) return null;
  return {
    recommendation: r.action.label, action: r.action.key, confidence: r.confidence,
    mix: (r.mix || []).map((m) => `${m.label} ${Math.round(m.freq * 100)}%`),
    equity_pct: round(r.equity?.value * 100), equity_vs_random_pct: round(r.equity?.vsRandom * 100),
    pot_odds_required_pct: r.potOdds ? round(r.potOdds.required * 100) : null,
    pot_bb: round(r.pot), to_call_bb: r.potOdds ? round(r.potOdds.toCall) : 0, spr: round(r.spr),
    ev_bb: (r.allActions || []).map((a) => ({ action: a.label, ev: round(a.ev, 2), opponent_folds_pct: a.fold != null ? Math.round(a.fold * 100) : undefined })),
    hand: r.hand ? { made: r.hand.label, detail: r.hand.detail, draws: r.hand.drawLabels, outs: r.hand.outsCount, beats_pct_of_random: round((r.hand.hs ?? 0) * 100) } : { class: r.handName },
    opponent_range: r.villain ? { how_built: r.villain.desc, composition_pct: r.villain.composition ? Object.fromEntries(['monster', 'strong', 'medium', 'draw', 'weak'].map((k, i) => [k, Math.round(r.villain.composition[i] * 100)])) : undefined } : null,
    engine_reasons: r.reasons,
  };
}

function makeTools(baseSpot, onToolSpot) {
  return [
    {
      def: ANALYZE_DEF, validate: validateAnalyze,
      async run(input) {
        const sp = spotFromInput(input, baseSpot);
        if (sp.hero?.length !== 2) throw new Error('hero_cards unknown: pass hero_cards');
        const r = await engine('analyze', sp);
        onToolSpot && onToolSpot(sp, r, input);
        return compactResult(r);
      },
    },
    {
      def: EQUITY_DEF, validate: validateEquity,
      async run(input) {
        const hero = (input.hero_cards || []).map(parseCard);
        const heroCards = hero.length === 2 ? hero : baseSpot?.hero;
        if (!heroCards || heroCards.length !== 2) throw new Error('hero_cards unknown');
        const board = input.board ? input.board.map(parseCard) : baseSpot?.board || [];
        const players = [{ cards: heroCards }, ...input.opponents.map((o) => (o.cards ? { cards: o.cards.map(parseCard) } : { range: o.range || null }))];
        const res = await engine('equity', { players, board });
        return { hero_equity_pct: round(res[0]?.equity * 100), win_pct: round(res[0]?.win * 100), tie_pct: round(res[0]?.tie * 100), exact: !!res[0]?.exact };
      },
    },
  ];
}

/** The request text: app state + engine result + task. */
export function buildPrompt(appState, engineResult, question) {
  return `【APP STATE】\n${JSON.stringify(appState, null, 1)}\n\n【ENGINE RESULT】\n${engineResult ? JSON.stringify(engineResult, null, 1) : '（尚無：牌還不完整）'}\n\n【TASK】\n${question || '依格式給我現在這個決策的建議與理由。'}`;
}

/**
 * Run one analyst turn.
 * opts: { image: Blob|null, appState, engineResult, baseSpot, question, history:[{role,content}], onText, onStatus, onToolSpot, signal }
 * Resolves { text, calls, usage, cost, backend, model } — `history` gets the new turns appended.
 */
export async function askAnalyst(opts) {
  const backend = await aiBackend();
  if (!backend) throw new Error('尚未設定 AI：在 Claude 中開啟本頁，或到「設定」輸入 Anthropic API 金鑰。');
  const tools = makeTools(opts.baseSpot, opts.onToolSpot);
  const promptText = buildPrompt(opts.appState, opts.engineResult, opts.question);
  const history = opts.history || [];
  if (backend === 'artifact') {
    const art = await artifactSample();
    const calls = [];
    const turns = [{ role: 'user', content: SYSTEM }, ...history.map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: promptText }];
    const options = { onText: ({ text }) => opts.onText && opts.onText(text), signal: opts.signal, modelTier: 'default' };
    if (opts.image && art.images) options.images = [opts.image];
    if (art.tools) {
      options.tools = tools.map((t) => ({
        name: t.def.name, description: t.def.description, inputSchema: t.def.input_schema,
        async execute(input) {
          const err = t.validate(input);
          if (err) throw new Error(err);
          opts.onStatus && opts.onStatus('計算勝率與 EV…');
          const out = await t.run(input);
          calls.push({ name: t.def.name, input, result: out });
          return out;
        },
      }));
    } else options.cache = false;
    try {
      const { text } = await art.sample(turns, options);
      history.push({ role: 'user', text: promptText }, { role: 'assistant', text });
      return { text, calls, usage: null, cost: null, backend, model: 'Claude' };
    } catch (e) {
      throw new Error(SAMPLE_ERR_ZH[e?.code] || e?.message || 'Claude 分析失敗');
    }
  }
  // own API key
  const { Anthropic, client } = await apiClient();
  const model = state.settings.aiModel || 'claude-opus-5';
  const messages = [];
  for (const h of history) messages.push({ role: h.role, content: h.text });
  const content = [];
  if (opts.image) content.push({ type: 'image', source: { type: 'base64', media_type: opts.image.type || 'image/jpeg', data: await blobToBase64(opts.image) } });
  content.push({ type: 'text', text: promptText });
  messages.push({ role: 'user', content });
  try {
    const res = await runToolLoop({
      client, Anthropic, model, messages, tools,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      onText: (full) => opts.onText && opts.onText(full), onStatus: opts.onStatus, signal: opts.signal,
    });
    if (res.stopReason === 'refusal') throw new Error('Claude 無法處理這個請求。');
    history.push({ role: 'user', text: promptText }, { role: 'assistant', text: res.text });
    return { ...res, cost: costUSD(model, res.usage), backend, model };
  } catch (err) {
    throw new Error(apiErrorZh(err, Anthropic));
  }
}

export { aiBackend };
