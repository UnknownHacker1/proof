// Guards the hackathon's 1,000 free units on a public demo: a daily unit ceiling for the
// whole server and a daily scan cap per visitor IP. In-memory on purpose (free hosts restart;
// a restart resetting the counter is acceptable for a demo).

export function createBudget({ dailyUnits, perIpScans, now = () => Date.now() }) {
  let day = '';
  let used = 0;
  const perIp = new Map();
  const roll = () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      used = 0;
      perIp.clear();
    }
  };
  return {
    check(ip, cost) {
      roll();
      if (used + cost > dailyUnits) return { ok: false, reason: 'daily_budget', message: 'The live demo has used its YouCam units for today.' };
      if ((perIp.get(ip) || 0) >= perIpScans) return { ok: false, reason: 'ip_limit', message: `Live scans are capped at ${perIpScans} per visitor per day.` };
      return { ok: true };
    },
    charge(ip, cost) {
      roll();
      used += cost;
      perIp.set(ip, (perIp.get(ip) || 0) + 1);
    },
    status() {
      roll();
      return { day, usedUnits: used, dailyUnits, remainingUnits: Math.max(0, dailyUnits - used) };
    },
  };
}
