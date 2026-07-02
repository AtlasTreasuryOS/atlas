#!/usr/bin/env node
require('dotenv').config();
require('../src/index.js').main().catch((e) => {
  console.error('FATAL:', e?.stack || e);
  process.exit(1);
});
