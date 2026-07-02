const OpenAI = require('openai');

async function proposeSweepPct({ cfg, personality, state }) {
  if (!cfg?.llm?.enabled) return null;
  if (cfg.llm.mode !== 'rules_proposer') return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const openai = new OpenAI({ apiKey });
  const model = cfg.llm.model || 'gpt-4o-mini';

  const prompt = {
    task: "propose sweepPct. output json only.",
    bounds: { minPct: cfg.policy.minPct, maxPct: cfg.policy.maxPct, spikePct: cfg.policy.spikePct },
    state
  };

  const res = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 120,
    messages: [
      { role: 'system', content: personality || 'return json only.' },
      { role: 'user', content: JSON.stringify(prompt) }
    ],
    response_format: { type: "json_object" }
  });

  try {
    const obj = JSON.parse(res.choices?.[0]?.message?.content || '{}');
    const sweepPct = Number(obj.sweepPct);
    if (!Number.isFinite(sweepPct)) return null;
    return sweepPct;
  } catch {
    return null;
  }
}

module.exports = { proposeSweepPct };
