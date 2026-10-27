// Signed scan receipts. Every score the server gets back from YouCam is signed with a server
// secret before it reaches the browser. A finished trial can then be checked: were these the
// numbers YouCam actually returned, or were they edited in localStorage? This is what lets a
// brand or retailer trust a "verified result" card for a refund or a review.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export function canonical(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (obj && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  if (typeof obj === 'number') return JSON.stringify(Math.round(obj * 1e4) / 1e4);
  return JSON.stringify(obj);
}

export function signReceipt(payload, secret) {
  const sig = createHmac('sha256', secret).update(canonical(payload)).digest('hex');
  return { payload, sig };
}

export function verifyReceipt(receipt, secret) {
  if (!receipt?.payload || typeof receipt.sig !== 'string') return false;
  const expected = createHmac('sha256', secret).update(canonical(receipt.payload)).digest();
  const given = Buffer.from(receipt.sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Short code printed on the verdict card: identifies the exact set of receipts.
export function trialCode(receipts) {
  const h = createHash('sha256');
  for (const r of receipts) h.update(String(r?.sig || ''));
  return h.digest('hex').slice(0, 10).toUpperCase();
}
