// One real yield cycle: deploy the treasury's USDC reserve into Jupiter Lend (jlUSDC),
// clamped by cfg.lend.maxDeployPct so a liquid buffer always remains. Writes a signed receipt.
'use strict';
require('dotenv').config();
const fs = require('fs');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const lend = require('../src/lend');
const { writeReceipt } = require('../src/reporters/receipt');
const cfg = require('../config.json');

const load = (f) => Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(f, 'utf8'))));

(async () => {
  const conn = new Connection(process.env.RPC_URL || cfg.rpcUrl, 'confirmed');
  const treasury = load(process.env.TREASURY_KEYFILE);
  const collector = load(process.env.COLLECTOR_KEYFILE);
  const USDC = cfg.addresses.usdcMint;
  const ATA = new PublicKey(cfg.addresses.treasuryUsdcAta);

  // treasury needs a little SOL for tx fees — top up from collector if short
  const feeBal = await conn.getBalance(treasury.publicKey);
  if (feeBal < 0.004e9) {
    const t = new Transaction().add(SystemProgram.transfer({
      fromPubkey: collector.publicKey, toPubkey: treasury.publicKey, lamports: 0.006e9,
    }));
    const sig = await sendAndConfirmTransaction(conn, t, [collector]);
    console.log('fee top-up collector→treasury 0.006 SOL:', sig);
  }

  const reserveUi = +(await conn.getTokenAccountBalance(ATA)).value.uiAmount;
  const maxDeployPct = cfg.lend?.maxDeployPct ?? 0.9;
  const deployUi = Math.floor(reserveUi * maxDeployPct * 1e6) / 1e6;
  const bufferUi = +(reserveUi - deployUi).toFixed(6);
  if (deployUi <= 0) throw new Error('nothing to deploy');

  const vault = await lend.getVault({ cfg, assetMint: USDC });
  console.log(`reserve ${reserveUi} USDC → deploy ${deployUi} (${maxDeployPct * 100}% cap) → ${vault.symbol} @ ${(vault.totalRateBps / 100).toFixed(2)}% APR`);

  const depositSig = await lend.depositWithRetry({
    connection: conn, cfg, ownerKp: treasury, assetMint: USDC, amountUi: deployUi, decimals: 6,
  });

  await new Promise((r) => setTimeout(r, 2500));
  const positions = await lend.getPositions({ cfg, user: treasury.publicKey.toBase58() });
  const pos = positions.find((p) => p.token?.assetAddress === USDC || p.assetAddress === USDC) || positions[0] || null;

  const receipt = {
    ts: new Date().toISOString(),
    action: 'yield_deploy',
    venue: 'jupiter-lend',
    inputs: { treasuryUsdc: reserveUi },
    decision: { maxDeployPct, deployUi, bufferUi },
    outputs: {
      vault: vault.address, vaultSymbol: vault.symbol,
      aprBps: vault.totalRateBps, aprPct: +(vault.totalRateBps / 100).toFixed(2),
      position: pos ? { shares: pos.shares ?? pos.balance ?? null, underlying: pos.underlyingAssets ?? pos.underlyingBalance ?? null } : null,
    },
    tx: { depositSig },
    summary: `yield: deployed ${deployUi} usdc (${maxDeployPct * 100}% of reserve, buffer ${bufferUi}) into ${vault.symbol} at ${(vault.totalRateBps / 100).toFixed(2)}% apr. every future harvest is a receipt.`,
  };
  const fp = writeReceipt(receipt);
  console.log(JSON.stringify(receipt, null, 2));
  console.log('receipt:', fp);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
