const { tick } = require('./engine');
const cfg = require('../config.json');

async function main() {
  if (process.env.SINGLE_RUN) {
    await tick({ cfg, personalityPath: null, runtime: { lastCollectorSOL: 0 } });
    console.log('done: tick executed');
    return;
  }

  const runtime = { lastCollectorSOL: 0 };

  while (true) {
    await tick({ cfg, personalityPath: null, runtime });
    const intervalMs = (cfg.launch.intervalMin || 1) * 60 * 1000;
    console.log(`next sweep in ~${intervalMs / 60000} min`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

module.exports = { main };
