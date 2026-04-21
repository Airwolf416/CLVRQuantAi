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

// ── Shared AudioContext (must be created/resumed inside a user gesture) ──────
let _sharedCtx = null;

/**
 * Call this inside a user gesture (button tap, toggle, etc.) to pre-create
 * and unlock the shared AudioContext so the bell can fire from timer callbacks.
 * On iOS Safari, simply creating/resuming the context isn't enough — we must
 * also play a silent buffer in the same gesture for the context to stay
 * "running" once we're outside the gesture (e.g., from a setInterval timer).
 */
export function unlockAudio() {
  try {
    if (!_sharedCtx) {
      _sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_sharedCtx.state === "suspended") {
      _sharedCtx.resume().catch(() => {});
    }
    // iOS unlock dance: play 1 sample of silence so the context is fully primed.
    const buf = _sharedCtx.createBuffer(1, 1, 22050);
    const src = _sharedCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_sharedCtx.destination);
    if (typeof src.start === "function") src.start(0); else src.noteOn(0);
  } catch (e) {}
}

/**
 * Unlock the browser's speechSynthesis engine. Must be called inside a user
 * gesture; otherwise iOS Safari and some Chrome versions silently refuse to
 * speak any utterance triggered later from a timer or remote event.
 */
export function unlockSpeech() {
  try {
    const ss = window.speechSynthesis;
    if (!ss) return;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.rate = 1;
    ss.speak(u);
  } catch (e) {}
}

/**
 * Plays resonant bell tones — count=3 for open, count=4 for close (NYSE tradition).
 * Uses the shared AudioContext so it works even from timer callbacks on iOS/Android.
 */
export function playMarketBell(volume = 0.6, count = 3) {
  try {
    // Try to use shared context first, fall back to a new one
    const ctx = _sharedCtx && _sharedCtx.state !== "closed"
      ? _sharedCtx
      : new (window.AudioContext || window.webkitAudioContext)();

    // If still suspended, resume it then schedule playback after a tick
    if (ctx.state === "suspended") {
      ctx.resume().then(() => _playBellTones(ctx, volume, count)).catch(() => {});
      return;
    }
    _playBellTones(ctx, volume, count);
  } catch (e) {}
}

function _playBellTones(ctx, volume, count) {
  try {
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
      g2.gain.linearRampToValueAtTime(volume * 0.25, ctx.currentTime + startAt + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + 1.8);

      // 3rd harmonic for extra richness
      const o3 = ctx.createOscillator();
      const g3 = ctx.createGain();
      o3.type = "sine";
      o3.frequency.setValueAtTime(freq * 3, ctx.currentTime + startAt);
      g3.gain.setValueAtTime(0, ctx.currentTime + startAt);
      g3.gain.linearRampToValueAtTime(volume * 0.08, ctx.currentTime + startAt + 0.01);
      g3.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + 1.0);

      o.connect(g);   g.connect(ctx.destination);
      o2.connect(g2); g2.connect(ctx.destination);
      o3.connect(g3); g3.connect(ctx.destination);

      o.start(ctx.currentTime + startAt);  o.stop(ctx.currentTime + startAt + 2.5);
      o2.start(ctx.currentTime + startAt); o2.stop(ctx.currentTime + startAt + 1.8);
      o3.start(ctx.currentTime + startAt); o3.stop(ctx.currentTime + startAt + 1.0);
    };
    for (let i = 0; i < count; i++) bellTone(880, i * 0.72);
  } catch (e) {}
}
