// The flywheel's last leg: buy $ATLAS with treasury USDC on Jupiter, then burn it on-chain.
// Supply only goes down. Writes a signed receipt with both signatures.
'use strict';
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Connection, Keypair, PublicKey, VersionedTransaction, Transaction } = require('@solana/web3.js');
const { createBurnCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const { writeReceipt } = require('../src/reporters/receipt');
const { makeTwitterClient, postToX, replyToX } = require('../src/reporters/x');
const cfg = require('../config.json');
const SITE = (process.env.SITE_URL || 'https://atlastreasuryos.xyz').replace(/\/+$/, '');

const USDC = cfg.addresses.usdcMint;
const ATLAS = cfg.addresses.atlasMint;
const BUY_USDC = +(process.env.BUY_USDC || 0.30);   // how much USDC to spend
const load = (f) => Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(f, 'utf8'))));

(async () => {
  const conn = new Connection(process.env.RPC_URL || cfg.rpcUrl, 'confirmed');
  const treasury = load(process.env.TREASURY_KEYFILE);
  const usdcAta = new PublicKey(cfg.addresses.treasuryUsdcAta);
  // $ATLAS is a Token-2022 mint — the ATA lives under the 2022 program
  const atlasAta = getAssociatedTokenAddressSync(new PublicKey(ATLAS), treasury.publicKey, false, TOKEN_2022_PROGRAM_ID);

  const liquid = +(await conn.getTokenAccountBalance(usdcAta)).value.uiAmount;

  // idempotent: if a previous run already bought, skip straight to the burn
  let buySig = process.env.BUY_SIG || null, spend = 0;
  let held = 0;
  try { held = +(await conn.getTokenAccountBalance(atlasAta)).value.uiAmount; } catch (e) {}
  if (held <= 0) {
    spend = Math.min(BUY_USDC, Math.max(0, liquid - 0.05));
    if (spend < 0.05) throw new Error('not enough liquid USDC to buy back (have ' + liquid + ')');
    console.log(`liquid ${liquid} USDC → buying $ATLAS with ${spend}`);
    const base = (cfg.jupiter?.base || 'https://lite-api.jup.ag').replace(/\/+$/, '');
    const amt = Math.floor(spend * 1e6);
    const q = await axios.get(`${base}/swap/v1/quote?inputMint=${USDC}&outputMint=${ATLAS}&amount=${amt}&slippageBps=300&restrictIntermediateTokens=true&maxAccounts=48`, { timeout: 15000 });
    const s = await axios.post(`${base}/swap/v1/swap`,
      { quoteResponse: q.data, userPublicKey: treasury.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true },
      { timeout: 20000 });
    const buyTx = VersionedTransaction.deserialize(Buffer.from(s.data.swapTransaction, 'base64'));
    buyTx.sign([treasury]);
    buySig = await conn.sendTransaction(buyTx, { skipPreflight: false });
    await conn.confirmTransaction(buySig, 'confirmed');
    console.log('buyback sig:', buySig);
    await new Promise((r) => setTimeout(r, 2500));
  } else console.log(`treasury already holds ${held} ATLAS (prior buy) — burning it`);

  // 2) burn every $ATLAS the treasury now holds
  const bal = await conn.getTokenAccountBalance(atlasAta);
  const rawAmt = BigInt(bal.value.amount);
  if (rawAmt <= 0n) throw new Error('no ATLAS to burn?');
  const burnIx = createBurnCheckedInstruction(atlasAta, new PublicKey(ATLAS), treasury.publicKey, rawAmt, bal.value.decimals, [], TOKEN_2022_PROGRAM_ID);
  const burnTx = new Transaction().add(burnIx);
  burnTx.feePayer = treasury.publicKey;
  burnTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  burnTx.sign(treasury);
  const burnSig = await conn.sendRawTransaction(burnTx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(burnSig, 'confirmed');
  const burned = +bal.value.uiAmount;
  console.log(`BURNED ${burned} $ATLAS — sig:`, burnSig);

  const liquidAfter = +(await conn.getTokenAccountBalance(usdcAta)).value.uiAmount;
  const receipt = {
    ts: new Date().toISOString(),
    action: 'buyback_burn',
    inputs: { liquidUsdcBefore: liquid },
    decision: { spendUsdc: spend || 0.3 },
    outputs: { atlasBought: burned, atlasBurned: burned, liquidUsdcAfter: liquidAfter },
    tx: { buySig, burnSig },
    summary: `flywheel: bought ${burned.toLocaleString()} atlas with ${spend} usdc on jupiter and burned all of it. supply only goes down.`,
  };
  const fp = writeReceipt(receipt);
  console.log(JSON.stringify(receipt, null, 2));
  console.log('receipt:', fp);

  // ---- push to the live dashboard so the BURNED counter updates ----
  try { await axios.post(SITE + '/webhook', receipt, { timeout: 8000 }); console.log('dashboard updated:', SITE); }
  catch (e) { console.log('webhook post failed (continuing):', e.message); }

  // ---- figure out cumulative totals for the tweet (source of truth = the live site) ----
  let total = burned, burnNo = 1;
  try {
    const st = (await axios.get(SITE + '/api/state', { timeout: 8000 })).data;
    if (st && st.burned) total = st.burned;
    const rcs = (await axios.get(SITE + '/api/receipts?n=200', { timeout: 8000 })).data.receipts || [];
    burnNo = rcs.filter((r) => r.action === 'buyback_burn').length || 1;
  } catch (e) {}

  // ---- auto-post the burn to X (main tweet + threaded reply with the on-chain proof) ----
  const x = makeTwitterClient();
  if (!x) {
    console.log('X credentials not set — skipping tweet. Set X_APP_KEY / X_APP_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET to enable auto-posting.');
  } else {
    const main = `🔥 burn #${burnNo}\n\n`
      + `the treasury just bought ${Math.round(burned).toLocaleString()} $ATLAS on jupiter and burned it.\n\n`
      + `${Math.round(total).toLocaleString()} $ATLAS gone forever.\n\n`
      + `watch the counter, live from the chain:\natlastreasuryos.xyz`;
    const proof = (buySig ? `buy: https://solscan.io/tx/${buySig}\n` : '')
      + `burn: https://solscan.io/tx/${burnSig}\n\nverified on-chain. supply only goes down.`;
    try {
      const id = await postToX(x, main);
      console.log('tweeted:', id);
      if (id) { const rid = await replyToX(x, proof, id); console.log('reply:', rid); }
    } catch (e) { console.log('tweet failed (continuing):', e.data ? JSON.stringify(e.data) : e.message); }
  }
})().catch((e) => { console.error('ERR', e.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
