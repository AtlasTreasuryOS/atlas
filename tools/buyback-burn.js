// The flywheel's last leg: buy $ATLAS with treasury USDC on Jupiter, then burn it on-chain.
// Supply only goes down. Writes a signed receipt with both signatures.
'use strict';
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Connection, Keypair, PublicKey, VersionedTransaction, Transaction } = require('@solana/web3.js');
const { createBurnCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const { writeReceipt } = require('../src/reporters/receipt');
const cfg = require('../config.json');

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
})().catch((e) => { console.error('ERR', e.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
