const axios = require('axios');

async function getSolUsdPrice(cfg) {
  const fixed = cfg?.price?.solUsd;
  if (Number.isFinite(fixed) && fixed > 0) return fixed;

  try {
    const { data } = await axios.get('https://price.jup.ag/v6/price?ids=SOL', { timeout: 8000 });
    const p = data?.data?.SOL?.price;
    if (Number.isFinite(p) && p > 0) return Number(p);
  } catch (_) {}
  return null;
}

module.exports = { getSolUsdPrice };
