// Thin wrapper around supabase-js: RPC calls + realtime subscription to plays.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, PUBLISHABLE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    const e = new Error(error.message || 'rpc error');
    e.code = error.code === '28000' || /unauthorized/.test(error.message || '') ? 'unauthorized' : (error.code || 'rpc');
    throw e;
  }
  return data;
}

export const api = {
  getEvent: (slug) => rpc('get_event', { p_slug: slug }),
  draw: (slug, token, player) => rpc('draw', { p_slug: slug, p_token: token, p_player: player }),
  rotateToken: (slug, key) => rpc('rotate_token', { p_slug: slug, p_key: key }),
  kioskDraw: (slug, key) => rpc('kiosk_draw', { p_slug: slug, p_key: key }),
  adminGet: (slug, key) => rpc('admin_get', { p_slug: slug, p_key: key }),
  adminSave: (slug, key, p) => rpc('admin_save', { p_slug: slug, p_key: key, p }),
  adminReset: (slug, key) => rpc('admin_reset', { p_slug: slug, p_key: key }),
  adminClaim: (slug, key, play, claimed) => rpc('admin_claim', { p_slug: slug, p_key: key, p_play: play, p_claimed: claimed }),
  createEvent: (master, title) => rpc('create_event', { p_master: master, p_title: title }),
};

// Calls onPlay(row) for every new play of this event. Returns an unsubscribe function.
// onStatus(status) receives 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'.
export function subscribePlays(eventId, onPlay, onStatus) {
  const ch = sb.channel('plays-' + eventId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plays', filter: 'event_id=eq.' + eventId },
      (msg) => onPlay(msg.new))
    .subscribe((status) => onStatus && onStatus(status));
  return () => sb.removeChannel(ch);
}

export const params = new URLSearchParams(location.search);

// Absolute URL of a sibling page, keeping GitHub Pages sub-path (e.g. /lucky-grab/).
export function pageUrl(page, q) {
  const u = new URL(page, location.href);
  u.search = new URLSearchParams(q).toString();
  return u.toString();
}

// Same capsule-count rule the big screen uses: odds expressed as a bag of colored capsules.
export function oddsPool(ev) {
  const live = (ev.prizes || []).filter((p) => p.stock > 0)
    .map((p) => ({ p, w: ev.mode === 'stock' ? p.stock : Math.max(0, p.weight) }))
    .filter((x) => x.w > 0);
  if (live.length && ev.blank_enabled && ev.blank_weight > 0) {
    live.push({ p: { id: null, name: ev.blank_name, color: '#d7dae3', shape: 'sphere', blank: true }, w: ev.blank_weight });
  }
  return live;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// QR as inline SVG (needs qrcode-generator loaded as a classic script → window.qrcode).
export function qrSvg(text, fg = '#111', bg = '#fff') {
  const qr = globalThis.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), m = 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR 코드"><rect width="100%" height="100%" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

// Small WebAudio effects (needs a user gesture before the first sound).
let ac;
export function tone(f, d, type = 'triangle', v = 0.15, delay = 0) {
  try {
    ac = ac || new AudioContext();
    if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
  } catch (e) { /* audio unavailable */ }
}
export const sfx = {
  rattle() { for (let i = 0; i < 12; i++) tone(260 + Math.random() * 520, 0.05, 'square', 0.035, i * 0.08); },
  pop() { tone(180, 0.35, 'sine', 0.12); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.18, i * 0.12)); },
  lose() { [392, 330].forEach((f, i) => tone(f, 0.3, 'triangle', 0.14, i * 0.16)); },
};

// Confetti on a full-screen canvas.
export function confetti(canvas, col) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = Math.min(2, devicePixelRatio || 1), c = canvas.getContext('2d');
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = [col, '#ffd45a', '#ffffff', '#ff6b6b', '#5aa9ff'];
  const parts = [];
  for (let i = 0; i < 180; i++) parts.push({ x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 18 - 4, s: 5 + Math.random() * 7, c: cols[i % 5], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, l: 130 + Math.random() * 70 });
  (function loop() {
    c.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.l-- <= 0) { parts.splice(i, 1); continue; }
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.fillStyle = p.c; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore();
    }
    if (parts.length) requestAnimationFrame(loop); else c.clearRect(0, 0, innerWidth, innerHeight);
  })();
}
