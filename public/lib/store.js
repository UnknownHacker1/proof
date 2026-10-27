// Trials live in this browser only (localStorage). The server keeps nothing.

const KEY = 'proof.v1';
const DAY = 86400e3;
let memory = null;

function blank() {
  return { subjectId: uid(), trials: [], activeId: null };
}

export function uid() {
  const a = new Uint8Array(9);
  (globalThis.crypto || { getRandomValues: (x) => x.map(() => Math.random() * 256) }).getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function load() {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? JSON.parse(raw) : blank();
  } catch {
    memory = blank();
  }
  if (!memory.subjectId) memory.subjectId = uid();
  return memory;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* private mode or full storage: keep working in memory */
  }
}

export function update(fn) {
  const s = load();
  fn(s);
  save();
  return s;
}

export function activeTrial() {
  const s = load();
  return s.trials.find((t) => t.id === s.activeId) || null;
}

export function getTrial(id) {
  return load().trials.find((t) => t.id === id) || null;
}

export function trialDay(trial, now = Date.now()) {
  return Math.max(0, Math.floor((now - Date.parse(trial.startedAt)) / DAY) + (trial.dayOffset || 0));
}

export function lastCheckinDay(trial) {
  return trial.checkins.length ? Math.max(...trial.checkins.map((c) => c.day)) : 0;
}

export function nextCheckinDay(trial) {
  return lastCheckinDay(trial) + trial.cadenceDays;
}

export function unitsUsed(trial) {
  return [...trial.calibration, ...trial.checkins].reduce((a, s) => a + (s.units || 0), 0);
}

export function dateForDay(trial, day) {
  return new Date(Date.parse(trial.startedAt) + (day - (trial.dayOffset || 0)) * DAY);
}
