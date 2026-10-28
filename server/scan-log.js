// Local-only scan log for measuring YouCam's noise from real calibration photos.
//
// Off by default. With SCAN_LOG=1 (golive.ps1 sets it) the server appends one line per live
// scan to noise-study/live-scans.jsonl: time, trial day, browser subject id and the scores.
// No photos, no keys. noise-study/ is gitignored. `npm run noise:from-scans` then pools the
// day-0 calibration sessions into per-concern noise priors, so the noise study needs no extra
// photos or units beyond the calibrations the user does anyway.

import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createScanLog(path) {
  if (!path) return null;
  return {
    path,
    append(entry) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify(entry) + '\n');
      } catch (err) {
        console.warn('scan log write failed:', err.message); // never fail a paid scan over the log
      }
    },
    // First live reply, kept so its shape can be checked against the docs.
    saveRaw(output) {
      const p = join(dirname(path), 'raw-output.json');
      try {
        if (existsSync(p)) return;
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(p, JSON.stringify(output, null, 1));
      } catch (err) {
        console.warn('raw output write failed:', err.message);
      }
    },
  };
}

export function readScanLog(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.scores && typeof e.at === 'string');
}

// Day-0 scans of one subject, each within `gapMs` of the previous one, form a calibration
// session. Calibration photos are taken a minute or two apart, so skin cannot change inside a
// session: the spread within a session is pure measurement noise.
export function calibrationSessions(entries, { gapMs = 30 * 60e3 } = {}) {
  const day0 = entries.filter((e) => (e.day ?? 0) === 0).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sessions = [];
  const last = new Map();
  for (const e of day0) {
    const subj = String(e.subject || 'anon');
    const cur = last.get(subj);
    if (cur && Date.parse(e.at) - Date.parse(cur.at[cur.at.length - 1]) <= gapMs) {
      cur.scans.push(e);
      cur.at.push(e.at);
    } else {
      const s = { subject: subj, scans: [e], at: [e.at] };
      sessions.push(s);
      last.set(subj, s);
    }
  }
  return sessions.map((s) => ({ subject: s.subject, start: s.at[0], scans: s.scans }));
}

// Pooled within-session SD per concern: sqrt( sum of squared deviations from each session's
// own mean / sum of (n_i - 1) ). Sessions with a single photo add nothing.
export function pooledNoise(sessions, concerns, field = 'scores') {
  return concerns.map((c) => {
    let ss = 0;
    let df = 0;
    let photos = 0;
    let used = 0;
    let sum = 0;
    for (const s of sessions) {
      const v = s.scans.map((e) => e[field]?.[c]).filter(Number.isFinite);
      if (v.length < 2) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      ss += v.reduce((a, b) => a + (b - m) ** 2, 0);
      df += v.length - 1;
      photos += v.length;
      sum += v.reduce((a, b) => a + b, 0);
      used++;
    }
    return { concern: c, sessions: used, photos, df, mean: photos ? sum / photos : NaN, sd: df ? Math.sqrt(ss / df) : NaN };
  });
}
