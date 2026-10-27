// Hand-drawn SVG charts. Colors come from CSS classes so light/dark themes apply.

import { label } from './concerns.js';
import { tone } from './copy.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r1 = (x) => Math.round(x * 10) / 10;

// The forest plot: one row per concern, effect and 90% interval against a shaded band of
// changes too small to matter. Same picture a clinical trial paper uses.
export function forestPlot(rows, { mcid = 5, width = 640, truth = null, compact = false } = {}) {
  const rowH = compact ? 30 : 38;
  const labelW = width < 480 ? 104 : 150;
  const valueW = width < 480 ? 0 : 92;
  const top = 26;
  const plotW = width - labelW - valueW - 12;
  const height = top + rows.length * rowH + 30;
  let lim = 12;
  for (const r of rows) if (r.ci) lim = Math.max(lim, Math.abs(r.ci[0]) + 1, Math.abs(r.ci[1]) + 1);
  if (truth) for (const r of rows) lim = Math.max(lim, Math.abs(truth[r.concern] ?? 0) + 2);
  lim = Math.ceil(lim / 5) * 5;
  const x = (v) => labelW + ((v + lim) / (2 * lim)) * plotW;
  const parts = [];
  parts.push(`<rect class="fp-band" x="${x(-mcid)}" y="${top - 8}" width="${x(mcid) - x(-mcid)}" height="${rows.length * rowH + 8}" rx="6"/>`);
  for (let v = -lim; v <= lim; v += 5) {
    parts.push(`<line class="fp-grid${v === 0 ? ' fp-zero' : ''}" x1="${x(v)}" x2="${x(v)}" y1="${top - 8}" y2="${top + rows.length * rowH}"/>`);
    parts.push(`<text class="fp-tick" x="${x(v)}" y="${height - 10}" text-anchor="middle">${v > 0 ? '+' + v : v === 0 ? '0' : '−' + -v}</text>`);
  }
  parts.push(`<text class="fp-axis" x="${x(-lim)}" y="14">worse</text><text class="fp-axis" x="${x(lim)}" y="14" text-anchor="end">better</text>`);
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2;
    const t = r.fit ? tone(r.verdict) : 'none';
    parts.push(`<g class="fp-row fp-${t}">`);
    parts.push(`<text class="fp-label${r.target ? ' fp-target' : ''}" x="0" y="${cy + 5}">${esc(label(r.concern))}</text>`);
    if (r.target) parts.push(`<circle class="fp-claim" cx="${labelW - 12}" cy="${cy}" r="3.5"><title>The product claims this</title></circle>`);
    if (r.fit) {
      const [lo, hi] = r.ci;
      parts.push(`<line class="fp-ci" x1="${x(Math.max(-lim, lo))}" x2="${x(Math.min(lim, hi))}" y1="${cy}" y2="${cy}"/>`);
      parts.push(`<line class="fp-cap" x1="${x(lo)}" x2="${x(lo)}" y1="${cy - 6}" y2="${cy + 6}"/><line class="fp-cap" x1="${x(hi)}" x2="${x(hi)}" y1="${cy - 6}" y2="${cy + 6}"/>`);
      parts.push(`<circle class="fp-dot" cx="${x(r.delta)}" cy="${cy}" r="${r.target ? 7 : 5.5}"><title>${esc(label(r.concern))}: ${r1(r.delta)} points (90% range ${r1(lo)} to ${r1(hi)})</title></circle>`);
      if (valueW) parts.push(`<text class="fp-value" x="${width}" y="${cy + 5}" text-anchor="end">${r.delta >= 0 ? '+' : '−'}${Math.abs(r1(r.delta)).toFixed(1)}</text>`);
    } else {
      parts.push(`<text class="fp-pending" x="${x(0)}" y="${cy + 5}" text-anchor="middle">waiting for check-ins</text>`);
    }
    if (truth && Number.isFinite(truth[r.concern])) {
      const tx = x(truth[r.concern]);
      parts.push(`<path class="fp-truth" d="M${tx} ${cy - 9} l6 9 l-6 9 l-6 -9 z"><title>Planted true effect: ${truth[r.concern]}</title></path>`);
    }
    parts.push('</g>');
  });
  return `<svg class="forest" viewBox="0 0 ${width} ${height}" role="img" aria-label="Change per concern with 90 percent ranges" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`;
}

// One concern over time: each check-in, the fitted trend, and the day-0 baseline with its
// measurement noise as a band.
export function seriesChart(row, { width = 560, height = 200, horizon = 28 } = {}) {
  if (!row.fit) return '';
  const pts = row.fit.points;
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const days = Math.max(horizon, ...pts.map((p) => p.day));
  const base = row.baseline;
  const sig = row.noise.sigma;
  const ys = pts.map((p) => p.score).concat([base - 2 * sig, base + 2 * sig, row.fit.intercept + row.fit.slope * days]);
  let y0 = Math.floor(Math.min(...ys) - 2);
  let y1 = Math.ceil(Math.max(...ys) + 2);
  if (y1 - y0 < 12) {
    const m = (y0 + y1) / 2;
    y0 = Math.floor(m - 6);
    y1 = Math.ceil(m + 6);
  }
  const X = (d) => pad.l + (d / days) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const parts = [];
  parts.push(`<rect class="sc-band" x="${X(0)}" y="${Y(base + sig)}" width="${X(days) - X(0)}" height="${Y(base - sig) - Y(base + sig)}"/>`);
  parts.push(`<line class="sc-base" x1="${X(0)}" x2="${X(days)}" y1="${Y(base)}" y2="${Y(base)}"/>`);
  for (let d = 0; d <= days; d += 7) parts.push(`<text class="sc-tick" x="${X(d)}" y="${height - 8}" text-anchor="middle">${d === 0 ? 'day 0' : d}</text>`);
  const step = (y1 - y0) > 24 ? 10 : 5;
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) parts.push(`<text class="sc-tick" x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`);
  const last = Math.max(...pts.map((p) => p.day));
  parts.push(`<line class="sc-fit sc-${tone(row.verdict)}" x1="${X(0)}" x2="${X(last)}" y1="${Y(row.fit.intercept)}" y2="${Y(row.fit.intercept + row.fit.slope * last)}"/>`);
  for (const p of pts) {
    const faint = p.weight < 0.75;
    parts.push(`<circle class="sc-pt${faint ? ' sc-faint' : ''}" cx="${X(p.day)}" cy="${Y(p.score)}" r="${p.reps > 1 ? 5.5 : 4}"><title>Day ${p.day}: ${r1(p.score)}${p.reps > 1 ? ` (average of ${p.reps} calibration photos)` : ''}${faint ? ', counted less' : ''}</title></circle>`);
  }
  if (row.provenDay) parts.push(`<line class="sc-proven" x1="${X(row.provenDay)}" x2="${X(row.provenDay)}" y1="${pad.t}" y2="${height - pad.b}"/><text class="sc-note" x="${X(row.provenDay) + 4}" y="${pad.t + 10}">proven</text>`);
  return `<svg class="series" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label(row.concern))} score by day">${parts.join('')}</svg>`;
}

// Calibration result: per concern, how far a single photo wobbles.
export function noiseBars(items, { width = 560 } = {}) {
  const rowH = 30;
  const labelW = width < 480 ? 104 : 150;
  const maxV = Math.max(6, ...items.map((i) => i.mdc));
  const X = (v) => labelW + (v / maxV) * (width - labelW - 48);
  const parts = items.map((it, i) => {
    const y = i * rowH + 18;
    return `<text class="nb-label" x="0" y="${y + 4}">${esc(label(it.concern))}</text>
      <rect class="nb-mdc" x="${labelW}" y="${y - 7}" width="${X(it.mdc) - labelW}" height="14" rx="7"/>
      <rect class="nb-sigma" x="${labelW}" y="${y - 7}" width="${Math.max(4, X(it.sigma) - labelW)}" height="14" rx="7"/>
      <text class="nb-value" x="${width}" y="${y + 4}" text-anchor="end">±${it.sigma.toFixed(1)}</text>`;
  });
  return `<svg class="noisebars" viewBox="0 0 ${width} ${items.length * rowH + 8}" role="img" aria-label="Measurement noise per concern">${parts.join('')}</svg>`;
}
