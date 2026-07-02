const fs = require('fs');
const OpenAI = require('openai');

async function llmSummarize({ cfg, personalityPath, fallback, summaryInput }) {
  if (!cfg?.llm?.enabled) return fallback;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const personality = personalityPath && fs.existsSync(personalityPath)
    ? fs.readFileSync(personalityPath, 'utf8').trim()
    : 'lowercase. concise.';

  const openai = new OpenAI({ apiKey });
  const model = cfg.llm.model || 'gpt-4o-mini';

  try {
    const res = await openai.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 140,
      messages: [
        { role: 'system', content: personality },
        { role: 'user', content: summaryInput }
      ],
    });
    const out = (res.choices?.[0]?.message?.content || '').trim().toLowerCase();
    return out || fallback;
  } catch {
    return fallback;
  }
}

module.exports = { llmSummarize };
