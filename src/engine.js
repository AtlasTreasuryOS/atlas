const path = require('path');
const axios = require('axios');

const { loadKeypair } = require('./keys');
const sol = require('./solana');
const { swapSolToUsdcWithRetry } = require('./jupiter');
const policy = require('./policy');
const { proposeSweepPct } = require('./llm/proposer');
const { llmSummarize } = require('./reporters/llm');
const { writeReceipt } = require('./reporters/receipt');
const { consoleReporter } = require('./reporters/console');

function nowIso() {
  return new Date().toISOString();
}

async function postSite(cfg, payload) {
  const url = (cfg?.reporting?.siteWebhook || '').trim();
  if (!url) return;
  try {
    await axios.post(url, payload, { timeout: 8000 });
  } catch (_) {}
}

async function tick({ cfg, personalityPath, runtime }) {
  const connection = sol.makeConnection(process.env.RPC_URL || cfg.rpcUrl);

  const DEV_KP = loadKeypair(process.env.DEV_KEYFILE);
  const COLLECTOR_KP = loadKeypair(process.env.COLLECTOR_KEYFILE);
  const TREASURY_KP = loadKeypair(process.env.TREASURY_KEYFILE);

  const a = cfg.addresses;

  const DEV = new sol.PublicKey(a.dev);
  const COLLECTOR = new sol.PublicKey(a.collector);

  const USDC_MINT = new sol.PublicKey(a.usdcMint);
  const ATLAS_MINT = new sol.PublicKey(a.atlasMint);
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  const COLLECTOR_USDC_ATA = new sol.PublicKey(a.collectorUsdcAta);
  const TREASURY_USDC_ATA = new sol.PublicKey(a.treasuryUsdcAta);
  const TREASURY_ATLAS_ATA = new sol.PublicKey(a.treasuryAtlasAta);

  const devSOL = await sol.getSolBalance(connection, DEV);
  const collSOL = await sol.getSolBalance(connection, COLLECTOR);
  const treasUSDC = (await sol.getTokenBalance(connection, TREASURY_USDC_ATA)).ui;
  const atlasSupply = (await sol.getTokenSupply(connection, ATLAS_MINT)).ui;

  const deltaCollectorSOL =
    runtime.lastCollectorSOL > 0 ? collSOL - runtime.lastCollectorSOL : 0;
  runtime.lastCollectorSOL = collSOL;

  let pct = policy.chooseSweepPct({ deltaCollectorSOL, cfg });

  const proposed = await proposeSweepPct({
    cfg,
    personality: null,
    state: { devSOL, collSOL, treasUSDC, atlasSupply, deltaCollectorSOL }
  });

  if (Number.isFinite(proposed)) {
    pct = policy.clamp(proposed, cfg.policy.minPct, cfg.policy.maxPct);
  }

  const sweepSOL = policy.computeSweepSOL({ collectorSOL: collSOL, pct, cfg });

  if (sweepSOL < cfg.limits.minSolChunk) {
    const receipt = {
      ts: nowIso(),
      action: 'noop',
      reason: 'below_min_sweep',
      inputs: { devSOL, collSOL, treasUSDC, atlasSupply },
      decision: { pct, sweepSOL, proposedPct: proposed ?? null },
      summary: 'noop: below min sweep'
    };

    const fp = writeReceipt(receipt);
    consoleReporter(receipt);
    await postSite(cfg, receipt);
    return { receipt, receiptPath: fp };
  }

  const swapSig = await swapSolToUsdcWithRetry({
    connection,
    cfg,
    collectorKp: COLLECTOR_KP,
    solMint: SOL_MINT,
    usdcMint: USDC_MINT.toBase58(),
    amountSOL: sweepSOL,
    slippageBps: cfg.limits.slippageBps
  });

  await new Promise(r => setTimeout(r, 2500));

  const collectorUsdc =
    (await sol.getTokenBalance(connection, COLLECTOR_USDC_ATA)).ui;

  const feeBps = cfg.protocolFee?.enabled ? cfg.protocolFee.bps : 0;
  const donationBps = cfg.donation?.enabled ? cfg.donation.bps : 0;

  const feeAmount = collectorUsdc * (feeBps / 10000);
  const donationAmount = collectorUsdc * (donationBps / 10000);
  const toTreasury = collectorUsdc - feeAmount - donationAmount;

  const transfers = [];

  if (feeAmount > 0 && cfg.protocolFee.recipientUsdcAta) {
    transfers.push({
      sourceAta: COLLECTOR_USDC_ATA,
      destAta: new sol.PublicKey(cfg.protocolFee.recipientUsdcAta),
      amountUi: feeAmount
    });
  }

  if (toTreasury > 0) {
    transfers.push({
      sourceAta: COLLECTOR_USDC_ATA,
      destAta: TREASURY_USDC_ATA,
      amountUi: toTreasury
    });
  }

  let sendSig = null;
  if (transfers.length) {
    sendSig = await sol.transferCheckedMany(connection, {
      ownerKp: COLLECTOR_KP,
      mint: USDC_MINT,
      decimals: 6,
      transfers
    });
  }

  let pegSig = null;
  let pegAction = 'none';

  const reserveNow =
    (await sol.getTokenBalance(connection, TREASURY_USDC_ATA)).ui;
  const supplyNow =
    (await sol.getTokenSupply(connection, ATLAS_MINT)).ui;

  const drift = +(reserveNow - supplyNow).toFixed(6);

  if (Math.abs(drift) >= cfg.mintBurn.minDrift && supplyNow > 0) {
    if (drift > 0) {
      pegSig = await sol.mintToChecked(connection, {
        authorityKp: TREASURY_KP,
        mint: ATLAS_MINT,
        destAta: TREASURY_ATLAS_ATA,
        amountUi: drift,
        decimals: cfg.mintBurn.decimals
      });
      pegAction = 'mint';
    } else {
      pegSig = await sol.burnChecked(connection, {
        authorityKp: TREASURY_KP,
        mint: ATLAS_MINT,
        sourceAta: TREASURY_ATLAS_ATA,
        amountUi: Math.abs(drift),
        decimals: cfg.mintBurn.decimals
      });
      pegAction = 'burn';
    }
  }

  const summaryInput =
    `sweep ${(pct * 100).toFixed(2)}% (${sweepSOL.toFixed(4)} SOL)` +
    ` → ${collectorUsdc.toFixed(6)} USDC → treasury ${toTreasury.toFixed(6)}`;

  const summary = await llmSummarize({
    cfg,
    personalityPath,
    fallback: summaryInput,
    summaryInput
  });

  const receipt = {
    ts: nowIso(),
    action: 'sweep',
    inputs: { devSOL, collSOL, treasUSDC, atlasSupply },
    decision: { pct, sweepSOL, proposedPct: proposed ?? null },
    outputs: {
      collectorUsdc,
      feeAmount,
      donationAmount,
      toTreasury,
      reserveNow,
      supplyNow,
      pegAction
    },
    tx: { swapSig, sendSig, pegSig },
    summary
  };

  const fp = writeReceipt(receipt);
  consoleReporter(receipt);
  await postSite(cfg, receipt);

  return { receipt, receiptPath: fp };
}

module.exports = { tick };
