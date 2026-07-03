// One-time: generate dev/collector/treasury keypairs to Desktop/atlas-keys (never committed),
// and print the pubkeys + deterministic ATAs needed by config.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');

const OUT = 'C:/Users/efrai/OneDrive/Desktop/atlas-keys';
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const ATLAS = new PublicKey('5juLvibGs9qpEsb9E8EYdDTRWyptY1dKZa7odgbUpump');

fs.mkdirSync(OUT, { recursive: true });
const kps = {};
for (const name of ['dev', 'collector', 'treasury']) {
  const file = path.join(OUT, name + '.json');
  if (fs.existsSync(file)) {
    kps[name] = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(file, 'utf8'))));
    console.log(name + ': EXISTS (reusing)');
  } else {
    kps[name] = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(kps[name].secretKey)));
    console.log(name + ': generated -> ' + file);
  }
}

const out = {
  dev: kps.dev.publicKey.toBase58(),
  collector: kps.collector.publicKey.toBase58(),
  treasury: kps.treasury.publicKey.toBase58(),
  collectorUsdcAta: getAssociatedTokenAddressSync(USDC, kps.collector.publicKey).toBase58(),
  treasuryUsdcAta: getAssociatedTokenAddressSync(USDC, kps.treasury.publicKey).toBase58(),
  feeUsdcAta_devOwned: getAssociatedTokenAddressSync(USDC, kps.dev.publicKey).toBase58(),
  treasuryAtlasAta: getAssociatedTokenAddressSync(ATLAS, kps.treasury.publicKey).toBase58(),
};
console.log(JSON.stringify(out, null, 2));
