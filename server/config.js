import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { unitsForSkinAnalysis, toDstAction } from './youcam-client.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tiny .env reader so the project has zero runtime dependencies.
export function loadDotEnv(path = join(ROOT, '.env')) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const DEFAULT_CONCERNS = ['acne', 'redness', 'pore', 'texture', 'wrinkle', 'moisture', 'oiliness', 'radiance', 'age_spot', 'dark_circle_v2'];

export function readConfig(env = process.env) {
  const apiKey = (env.YOUCAM_API_KEY || '').trim();
  const forceMock = env.PROOF_MODE === 'mock';
  const quality = env.YOUCAM_QUALITY === 'hd' ? 'hd' : 'sd';
  const concerns = (env.YOUCAM_CONCERNS ? env.YOUCAM_CONCERNS.split(',') : DEFAULT_CONCERNS).map((s) => s.trim()).filter(Boolean);
  const mode = apiKey && !forceMock ? 'live' : 'mock';
  const cfg = {
    mode,
    apiKey,
    host: env.YOUCAM_API_HOST || 'https://yce-api-01.makeupar.com',
    quality,
    concerns,
    dstActions: concerns.map((c) => toDstAction(c, quality)),
    unitsPerScan: unitsForSkinAnalysis(concerns.length, quality),
    deleteAfter: env.YOUCAM_DELETE_AFTER !== '0',
    dailyUnitBudget: Number(env.DAILY_UNIT_BUDGET || 350),
    perIpDailyScans: Number(env.PER_IP_DAILY_SCANS || 15),
    // Optional: a public deploy stays in sample mode unless a trial carries this code.
    liveAccessCode: (env.LIVE_ACCESS_CODE || '').trim(),
    receiptSecret: env.RECEIPT_SECRET || randomBytes(32).toString('hex'),
    receiptSecretIsEphemeral: !env.RECEIPT_SECRET,
    port: Number(env.PORT || 3000),
    mockLatencyMs: Number(env.MOCK_LATENCY_MS ?? 450),
    // Local noise study: SCAN_LOG=1 logs live scan scores (no photos) to noise-study/live-scans.jsonl.
    scanLog: !env.SCAN_LOG || env.SCAN_LOG === '0' ? '' : env.SCAN_LOG === '1' ? join(ROOT, 'noise-study', 'live-scans.jsonl') : env.SCAN_LOG,
  };
  return cfg;
}
