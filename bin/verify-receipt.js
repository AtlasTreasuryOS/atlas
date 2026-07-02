require('dotenv').config();
const fs = require('fs');
const { Connection } = require('@solana/web3.js');

async function main() {
  const fp = process.argv[2];
  if (!fp) throw new Error('usage: verify-receipt <receipt.json>');
  const receipt = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const sigs = Object.values(receipt.tx || {}).filter(Boolean);
  const conn = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

  const out = {};
  for (const sig of sigs) {
    const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    out[sig] = !!tx;
  }
  console.log(JSON.stringify({ receipt: fp, ok: Object.values(out).every(Boolean), tx: out }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
