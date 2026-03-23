// ── Market Bell Utilities ──────────────────────────────────────────────────
// Shared between App.jsx (global trigger) and MarketTab.jsx (clock display)
// No React — pure functions only so Vite Fast Refresh stays happy.

export function getET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

export function getNYSEStatus() {
  const et = getET();
  const d  = et.getDay();
  if (d === 0 || d === 6) return "closed";
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins < 4 * 60)           return "closed";
  if (mins < 9 * 60 + 30)      return "pre";
  if (mins < 16 * 60)          return "open";
  if (mins < 20 * 60)          return "after";
  return "closed";
}

// Plays resonant bell tones — count=3 for open, count=4 for close (NYSE tradition)
export function playMarketBell(volume = 0.6, count = 3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const bellTone = (freq, startAt) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      g.gain.setValueAtTime(0, ctx.currentTime + startAt);
      g.gain.linearRampToValueAtTime(volume, ctx.currentTime + startAt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + 2.5);
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = "sine";
      o2.frequency.setValueAtTime(freq * 2, ctx.currentTime + startAt);
      g2.gain.setValueAtTime(0, ctx.currentTime + startAt);
      g2.gain.linearRampToValueAtTime(volume * 0.2, ctx.currentTime + startAt + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + 1.5);
      o.connect(g); g.connect(ctx.destination);
      o2.connect(g2); g2.connect(ctx.destination);
      o.start(ctx.currentTime + startAt);
      o.stop(ctx.currentTime + startAt + 2.5);
      o2.start(ctx.currentTime + startAt);
      o2.stop(ctx.currentTime + startAt + 1.5);
    };
    for (let i = 0; i < count; i++) bellTone(880, i * 0.75);
    setTimeout(() => { try { ctx.close(); } catch(e) {} }, count * 750 + 2800);
  } catch (e) {}
}
