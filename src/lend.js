// Jupiter Lend (Earn) integration — the treasury's USDC reserve earns real lending yield.
// Same lite-api family + sign-and-send pattern as jupiter.js (swaps). No extra SDK.
const axios = require('axios');
const { VersionedTransaction } = require('@solana/web3.js');
const { withRetry } = require('./executor');

function base(cfg) { return (cfg?.jupiter?.base || 'https://lite-api.jup.ag').replace(/\/+$/, ''); }
function headers(cfg) { const h = { 'Content-Type': 'application/json' }; const k = (cfg?.jupiter?.apiKey || '').trim(); if (k) h['x-api-key'] = k; return h; }

// vault metadata + live rates (rates are bps APR: supplyRate + rewardsRate = totalRate)
async function getVault({ cfg, assetMint }) {
  const r = await axios.get(`${base(cfg)}/lend/v1/earn/tokens`, { timeout: 10000, headers: headers(cfg) });
  const v = (r.data || []).find((t) => t.assetAddress === assetMint);
  if (!v) throw new Error('jupiter lend: no vault for asset ' + assetMint);
  return { address: v.address, symbol: v.symbol, supplyRateBps: +v.supplyRate, rewardsRateBps: +v.rewardsRate, totalRateBps: +v.totalRate };
}

async function depositOnce({ connection, cfg, ownerKp, assetMint, amountUi, decimals }) {
  const amount = Math.floor(amountUi * 10 ** decimals).toString();
  const r = await axios.post(`${base(cfg)}/lend/v1/earn/deposit`,
    { asset: assetMint, amount, signer: ownerKp.publicKey.toBase58() },
    { timeout: 20000, headers: headers(cfg) });
  if (!r?.data?.transaction) throw new Error('jupiter lend: missing transaction');
  const tx = VersionedTransaction.deserialize(Buffer.from(r.data.transaction, 'base64'));
  tx.sign([ownerKp]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function withdrawOnce({ connection, cfg, ownerKp, assetMint, amountUi, decimals }) {
  const amount = Math.floor(amountUi * 10 ** decimals).toString();
  const r = await axios.post(`${base(cfg)}/lend/v1/earn/withdraw`,
    { asset: assetMint, amount, signer: ownerKp.publicKey.toBase58() },
    { timeout: 20000, headers: headers(cfg) });
  if (!r?.data?.transaction) throw new Error('jupiter lend: missing transaction');
  const tx = VersionedTransaction.deserialize(Buffer.from(r.data.transaction, 'base64'));
  tx.sign([ownerKp]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function getPositions({ cfg, user }) {
  const r = await axios.get(`${base(cfg)}/lend/v1/earn/positions?users=${user}`, { timeout: 10000, headers: headers(cfg) });
  return r.data || [];
}

async function depositWithRetry(args) {
  const cfg = args.cfg;
  return withRetry(() => depositOnce(args), { retries: cfg?.retries?.jupiter ?? 3, backoffMs: cfg?.retries?.backoffMs ?? 4000, label: 'jupiter lend deposit' });
}

module.exports = { getVault, depositWithRetry, withdrawOnce, getPositions };
