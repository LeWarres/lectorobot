const TURN_SOUNDS = [
  { dur: 0.30, f: [1700, 3600], q: 0.9, peak: 0.55, crackle: 70, thump: 0.25 },                // hoja fina y rápida
  { dur: 0.50, f: [800, 2100], q: 0.7, peak: 0.6, crackle: 45, thump: 0.6 },                   // hoja gruesa, lenta
  { dur: 0.36, f: [2300, 5000], q: 1.1, peak: 0.5, crackle: 240, thump: 0.15 },                // papel crujiente
  { dur: 0.42, f: [1200, 2500], q: 0.5, peak: 0.45, crackle: 18, thump: 0 },                   // roce suave
  { dur: 0.50, f: [1400, 3100], q: 0.8, peak: 0.6, crackle: 110, thump: 0.4, twoStep: true },  // se despega y cae
  { dur: 0.26, f: [2800, 5800], q: 1.4, peak: 0.4, crackle: 160, thump: 0.12, snap: true },    // satinado, con chasquido
]
function synthTurn(p, sr, rnd = Math.random) {
  const n = Math.round(sr * (p.dur + 0.1))
  const out = new Float32Array(n)
  // Filtro paso banda (biquad RBJ, ganancia 1 en el centro).
  const band = () => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, a1 = 0, a2 = 0
    return {
      set(f, q) { const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al; b0 = al / a0; a1 = -2 * Math.cos(w) / a0; a2 = (1 - al) / a0 },
      run(x) { const y = b0 * (x - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y },
    }
  }
  const air = band(), fiber = band(), body = band()
  fiber.set(4200, 0.8)
  body.set(170, 0.9)
  const a = Math.log(0.5) / Math.log(p.peak) // sin(π·x^a) tiene su máximo en x = peak
  const swell = x => x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x ** a) ** 2
  const env = x => p.twoStep ? Math.max(0.75 * swell(Math.min(1, x / 0.38)), swell((x - 0.25) / 0.75)) : swell(x)
  let flutter = 0, grain = 0, grainK = 1, snapAt = p.snap ? Math.round(sr * p.dur * 0.12) : -1
  const thumpAt = Math.round(sr * p.dur * 0.86), thumpK = Math.exp(-1 / (0.035 * sr))
  let thump = 0
  for (let i = 0; i < n; i++) {
    const x = i / (sr * p.dur), e = env(x), w = rnd() * 2 - 1
    if (i % 32 === 0) air.set(p.f[0] + (p.f[1] - p.f[0]) * e, p.q)
    flutter += (w - flutter) * 0.004 // temblor lento del volumen
    let s = air.run(w) * e * (1 + 1.8 * flutter)
    // Chasquidos: más frecuentes cuanto más rápido se mueve la hoja.
    if (rnd() < (p.crackle * (0.15 + e)) / sr) { grain = Math.max(grain, (0.3 + 0.7 * rnd()) * (0.3 + e)); grainK = Math.exp(-1 / ((0.0006 + 0.0025 * rnd()) * sr)) }
    if (i === snapAt) { grain = 1.6; grainK = Math.exp(-1 / (0.004 * sr)) }
    grain *= grainK
    s += fiber.run(w) * grain * 1.4
    if (i === thumpAt) thump = p.thump
    thump *= thumpK
    s += body.run(w) * thump * 3
    out[i] = s
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  const fade = Math.round(sr * 0.01)
  for (let i = 0; i < n; i++) out[i] = (out[i] / (peak || 1)) * Math.min(1, (n - i) / fade)
  return out
}
const SOUND_LEVELS = { off: ['Sin sonido', 0], low: ['Sonido bajo', 0.15], mid: ['Sonido medio', 0.3], high: ['Sonido alto', 0.55] }
const sfx = { ctx: null, last: -1 }
// El contexto de audio solo arranca dentro de un gesto del usuario (iOS): se prepara al tocar el lector.
function sfxUnlock() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    sfx.ctx ??= new AC()
    if (sfx.ctx.state !== 'running') sfx.ctx.resume().catch(() => {})
    return sfx.ctx
  } catch { return null }
}
// pan: de -1 (izquierda) a 1 (derecha), el lado por el que se mueve la hoja.
function turnSound(level, pan = 0) {
  const vol = SOUND_LEVELS[level]?.[1]
  if (!vol || document.hidden) return
  const ctx = sfxUnlock()
  if (!ctx) return
  try {
    let i
    do i = Math.floor(Math.random() * TURN_SOUNDS.length); while (i === sfx.last)
    sfx.last = i
    const p = TURN_SOUNDS[i], k = 0.88 + Math.random() * 0.24
    const data = synthTurn({ ...p, dur: p.dur * (0.88 + Math.random() * 0.24), f: p.f.map(f => f * k) }, ctx.sampleRate)
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate)
    buf.getChannelData(0).set(data)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.value = vol * (0.85 + Math.random() * 0.3)
    src.connect(gain)
    if (pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner()
      sp.pan.value = pan
      gain.connect(sp).connect(ctx.destination)
    } else gain.connect(ctx.destination)
    src.start()
  } catch {}
}

window.turnSound = turnSound
