// The shareable verdict card, drawn on a canvas (1080x1350, the 4:5 social format).

import { label } from './concerns.js';
import { tone, verdictText, trialHeadline } from './copy.js';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function drawVerdictCard(canvas, trial, report, { verified = null, code = null } = {}) {
  await document.fonts?.ready;
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Card colors are fixed (light) so the image looks the same wherever it is shared.
  const C = { paper: '#EEF1EE', ink: '#1D2A5B', soft: '#5A6488', band: '#DAD6F3', good: '#0E7A6B', bad: '#B4235A', flat: '#7E8593', wait: '#A86F12', rule: '#C9D0D4' };
  const serif = cssVar('--font-display', 'Georgia') ;
  const sans = cssVar('--font-ui', 'system-ui');
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  const M = 84;
  ctx.fillStyle = C.ink;
  ctx.font = `400 46px ${serif}`;
  ctx.fillText('Proof', M, M + 30);
  ctx.font = `500 26px ${sans}`;
  ctx.fillStyle = C.soft;
  ctx.textAlign = 'right';
  ctx.fillText(report.complete ? `${report.day}-day result` : `Trend at day ${report.day}`, W - M, M + 28);
  ctx.textAlign = 'left';

  ctx.font = `500 30px ${sans}`;
  ctx.fillStyle = C.soft;
  ctx.fillText(trial.product, M, 220);
  const head = trialHeadline(report);
  ctx.fillStyle = C.ink;
  ctx.font = `400 92px ${serif}`;
  const hl = wrap(ctx, head.headline, W - 2 * M);
  hl.forEach((l, i) => ctx.fillText(l, M, 320 + i * 100));
  let y = 320 + hl.length * 100 - 30;
  ctx.font = `400 30px ${sans}`;
  ctx.fillStyle = C.soft;
  for (const l of wrap(ctx, head.sub, W - 2 * M)) {
    y += 42;
    ctx.fillText(l, M, y);
  }

  // Mini forest plot: claimed concerns first, then up to three others with a verdict.
  const plotTop = Math.max(y + 90, 560);
  // Everything from the plot down to the caption has to clear the footer rule at H - 190.
  const room = H - 200 - 30 - plotTop - 96;
  const maxRows = Math.max(3, Math.min(6, Math.floor(room / 76)));
  const rows = [...report.targets, ...report.others.filter((r) => r.fit && r.verdict !== 'too-early')].filter((r) => r.fit).slice(0, maxRows);
  const rowH = Math.min(110, Math.floor(room / Math.max(1, rows.length)));
  const labelW = 340;
  const px0 = M + labelW;
  const px1 = W - M;
  let lim = 15;
  for (const r of rows) lim = Math.max(lim, Math.ceil((Math.max(Math.abs(r.ci[0]), Math.abs(r.ci[1])) + 1) / 5) * 5);
  const X = (v) => px0 + ((v + lim) / (2 * lim)) * (px1 - px0);
  ctx.fillStyle = C.band;
  ctx.beginPath();
  ctx.roundRect(X(-report.mcid), plotTop - 20, X(report.mcid) - X(-report.mcid), rows.length * rowH + 10, 12);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(0), plotTop - 20);
  ctx.lineTo(X(0), plotTop - 10 + rows.length * rowH);
  ctx.stroke();
  rows.forEach((r, i) => {
    const cy = plotTop + i * rowH + rowH / 2 - 14;
    const col = report.complete ? C[tone(r.verdict)] || C.flat : C.wait;
    ctx.fillStyle = C.ink;
    ctx.font = `${r.target ? 600 : 400} 38px ${sans}`;
    ctx.fillText(label(r.concern), M, cy + 2);
    ctx.font = `500 26px ${sans}`;
    ctx.fillStyle = col;
    const vt = verdictText(r, { complete: report.complete, mcid: report.mcid }).headline;
    ctx.fillText(vt.length > 20 ? vt.replace(' since you started', '') : vt, M, cy + 36);
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(Math.max(-lim, r.ci[0])), cy);
    ctx.lineTo(X(Math.min(lim, r.ci[1])), cy);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(X(r.delta), cy, 14, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.font = `400 28px ${sans}`;
  ctx.fillStyle = C.soft;
  const axisY = plotTop + rows.length * rowH + 26;
  ctx.fillText('worse', px0, axisY);
  ctx.textAlign = 'right';
  ctx.fillText('better', px1, axisY);
  ctx.textAlign = 'left';
  ctx.font = `400 26px ${sans}`;
  wrap(ctx, `Change in score since day 0, with its range. Shaded: under ±${report.mcid} points.`, W - 2 * M).forEach((l, i) => ctx.fillText(l, M, axisY + 50 + i * 34));

  // Footer
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, H - 200);
  ctx.lineTo(W - M, H - 200);
  ctx.stroke();
  const photos = trial.calibration.length + trial.checkins.length;
  const live = trial.mode === 'live' && !trial.demo;
  ctx.font = `600 30px ${sans}`;
  ctx.fillStyle = live ? C.ink : C.wait;
  ctx.fillText(
    trial.demo ? `Synthetic demo: ${photos} simulated scans` : live ? `${photos} photos measured with YouCam Skin AI` : `Sample mode: ${photos} simulated scans, not YouCam`,
    M,
    H - 136,
  );
  ctx.fillStyle = C.soft;
  ctx.font = `400 27px ${sans}`;
  ctx.fillStyle = C.soft;
  const proofLine = trial.demo
    ? 'Generated with known true effects to test Proof'
    : !live
      ? 'Scores came from a simulated API, not a real face'
      : verified != null
      ? `${verified} of ${photos} scans carry a valid server signature${code ? `, code ${code}` : ''}`
      : 'Ranges corrected for testing several concerns at once';
  ctx.fillText(proofLine, M, H - 92);
  ctx.fillText('Shows change since day 0, not its cause. Not medical advice.', M, H - 52);
  return canvas;
}
