// Run AFTER the collector wallet is funded. Creates the three USDC ATAs the agent
// reads/writes (collector, treasury, fee/dev) — idempotent; payer = collector.
'use strict';
require('dotenv').config();
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const fs = require('fs');

const cfg = require('../config.json');
const conn = new Connection(process.env.RPC_URL || cfg.rpcUrl, 'confirmed');
const USDC = new PublicKey(cfg.addresses.usdcMint);
const load = (f) => Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(f, 'utf8'))));

(async () => {
  const collector = load(process.env.COLLECTOR_KEYFILE);
  const dev = load(process.env.DEV_KEYFILE);
  const treasury = load(process.env.TREASURY_KEYFILE);
  const bal = await conn.getBalance(collector.publicKey);
  console.log('collector', collector.publicKey.toBase58(), 'balance', bal / 1e9, 'SOL');
  if (bal < 0.02e9) { console.log('FUND FIRST: need >= 0.02 SOL on collector'); process.exit(1); }
  for (const [label, owner] of [['collector', collector.publicKey], ['treasury', treasury.publicKey], ['fee(dev)', dev.publicKey]]) {
    const acc = await getOrCreateAssociatedTokenAccount(conn, collector, USDC, owner);
    console.log('USDC ATA', label, acc.address.toBase58());
  }
  console.log('ATAs ready. Now: SINGLE_RUN=1 npm run single');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
