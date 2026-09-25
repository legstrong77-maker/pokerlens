// Scripted mock of the Anthropic streaming client: verifies the analyst tool loop end to end.
import { runToolLoop } from '../app/js/app/claude-client.js';
import { spotFromInput, compactResult, buildPrompt } from '../app/js/app/ai-analyst.js';
import { analyze } from '../app/js/core/strategy.js';
import { parseCards } from '../app/js/core/cards.js';

let bad = 0;
const ok = (title, cond, extra = '') => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${title}${extra ? ' — ' + extra : ''}`); };

function fakeClient(script) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const step = script.shift();
          const handlers = {};
          return {
            on(evt, cb) { handlers[evt] = cb; return this; },
            async finalMessage() {
              for (const d of step.deltas || []) handlers.text && handlers.text(d);
              return { content: step.content, stop_reason: step.stop, usage: { input_tokens: 1000, output_tokens: 200 } };
            },
          };
        },
      },
    },
  };
}

const baseSpot = {
  hero: parseCards('Ah 5h'), board: parseCards('Kh 9h 4c'), tableSize: 6, heroPos: 'BB', stack: 100, villainType: 'unknown',
  postflop: { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BTN', potType: 'srp', heroAggressor: false, heroIP: false, facing: 'bet', bet: 3.6, heroBet: 0, history: [] },
};
const tools = [{
  def: { name: 'analyze_spot', description: 'x', input_schema: { type: 'object', properties: {} } },
  validate: (i) => (i.board && ![0, 3, 4, 5].includes(i.board.length) ? 'board must have 0, 3, 4 or 5 cards' : null),
  run: async (i) => compactResult(analyze(spotFromInput(i, baseSpot))),
}];

// 1) tool call -> engine -> final answer
{
  const client = fakeClient([
    { deltas: ['先用引擎算一下。'], content: [{ type: 'text', text: '先用引擎算一下。' }, { type: 'tool_use', id: 't1', name: 'analyze_spot', input: { pot_bb: 20, to_call_bb: 10 } }], stop: 'tool_use' },
    { deltas: ['建議：跟注 10 BB\n', '理由：…'], content: [{ type: 'text', text: '建議：跟注 10 BB\n理由：…' }], stop: 'end_turn' },
  ]);
  const messages = [{ role: 'user', content: 'hi' }];
  let streamed = '';
  const res = await runToolLoop({ client, model: 'claude-opus-5', system: 's', messages, tools, onText: (t) => { streamed = t; } });
  ok('final text includes both rounds', res.text.includes('先用引擎算一下') && res.text.includes('建議：跟注'), JSON.stringify(res.text));
  ok('streamed text reached the UI', streamed.includes('建議：跟注'));
  ok('tool executed with engine result', res.calls.length === 1 && res.calls[0].result && typeof res.calls[0].result.equity_pct === 'number', `equity ${res.calls[0]?.result?.equity_pct}%, rec ${res.calls[0]?.result?.recommendation}`);
  ok('tool used corrected pot/bet', res.calls[0].result.pot_bb === 30 && res.calls[0].result.to_call_bb === 10, `pot ${res.calls[0].result.pot_bb}`);
  ok('conversation appended assistant + tool_result', messages.length === 3 && messages[2].content[0].type === 'tool_result' && messages[2].content[0].tool_use_id === 't1');
  ok('opus-5 request carries fallbacks + effort', client.requests[0].fallbacks === 'default' && client.requests[0].output_config?.effort === 'low' && client.requests[0].tools[0].eager_input_streaming === true);
  ok('usage summed over rounds', res.usage.input === 2000 && res.usage.output === 400);
}
// 2) invalid tool input -> is_error result, loop continues
{
  const client = fakeClient([
    { content: [{ type: 'tool_use', id: 't2', name: 'analyze_spot', input: { board: ['Kh', '9h'] } }], stop: 'tool_use' },
    { deltas: ['建議：棄牌'], content: [{ type: 'text', text: '建議：棄牌' }], stop: 'end_turn' },
  ]);
  const messages = [{ role: 'user', content: 'hi' }];
  const res = await runToolLoop({ client, model: 'claude-sonnet-5', system: 's', messages, tools });
  ok('invalid input returned as is_error', messages[2].content[0].is_error === true && /INVALID_INPUT/.test(messages[2].content[0].content));
  ok('no tool run on invalid input', res.calls.length === 0);
  ok('sonnet request has effort but no fallbacks', client.requests[0].fallbacks === undefined && client.requests[0].output_config?.effort === 'low');
}
// 3) tool call truncated at max_tokens -> never executed
{
  const client = fakeClient([{ content: [{ type: 'tool_use', id: 't3', name: 'analyze_spot', input: { pot_bb: 2 } }], stop: 'max_tokens' }]);
  let threw = false;
  try { await runToolLoop({ client, model: 'claude-haiku-4-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools }); } catch { threw = true; }
  ok('truncated tool call throws instead of running', threw);
  ok('haiku request has no effort / fallbacks', client.requests[0].output_config === undefined && client.requests[0].fallbacks === undefined);
}
// 4) spot mapping + prompt
{
  const sp = spotFromInput({ board: ['Qs', 'Jd', '2c', '7h'], pot_bb: 18, to_call_bb: 0, main_opponent_position: 'CO' }, baseSpot);
  ok('spotFromInput maps turn spot', sp.board.length === 4 && sp.postflop.pot === 18 && sp.postflop.facing === 'none' && sp.postflop.villainPos === 'CO');
  const pre = spotFromInput({ board: [], preflop_situation: 'vsOpen', preflop_raiser_position: 'CO', preflop_raise_to_bb: 3 }, baseSpot);
  ok('spotFromInput maps preflop spot', pre.preflop.scenario === 'vsOpen' && pre.preflop.openerPos === 'CO' && !pre.postflop);
  const prompt = buildPrompt({ hero_cards: ['Ah', '5h'] }, { recommendation: '跟注' }, null);
  ok('prompt has state, engine result and task', prompt.includes('APP STATE') && prompt.includes('ENGINE RESULT') && prompt.includes('TASK'));
}
console.log(bad ? `FAILED (${bad})` : 'ai loop OK');
if (bad) process.exit(1);
