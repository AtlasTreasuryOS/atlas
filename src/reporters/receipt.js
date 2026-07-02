const fs = require('fs');
const path = require('path');

function writeReceipt(receipt, dir = path.join(process.cwd(), 'receipts')) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const name = `receipt-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, JSON.stringify(receipt, null, 2));
  return fp;
}

module.exports = { writeReceipt };
