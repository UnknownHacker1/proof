import { createServer } from 'node:http';
import { loadDotEnv, readConfig } from './config.js';
import { createApp } from './app.js';

loadDotEnv();
const cfg = readConfig();
const server = createServer(createApp(cfg));

server.listen(cfg.port, () => {
  const where = `http://localhost:${cfg.port}`;
  if (cfg.mode === 'live') {
    console.log(`Proof running at ${where} in LIVE mode: real YouCam Skin AI, ${cfg.quality.toUpperCase()}, ${cfg.concerns.length} concerns, ${cfg.unitsPerScan} units per scan.`);
    console.log(`Daily unit ceiling ${cfg.dailyUnitBudget}, ${cfg.perIpDailyScans} scans per visitor.`);
  } else {
    console.log(`Proof running at ${where} in MOCK mode: simulated YouCam API, no units used.`);
    console.log('Set YOUCAM_API_KEY in .env to go live.');
  }
  if (cfg.receiptSecretIsEphemeral) console.log('RECEIPT_SECRET not set: scan receipts will not verify after a restart.');
});
