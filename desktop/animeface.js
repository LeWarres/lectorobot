// Detector de rostros de anime, en un Worker para no trabar el estante.
// Evalúa en JavaScript la cascada LBP «lbpcascade_animeface» de nagadomi: https://github.com/nagadomi/lbpcascade_animeface
// La cascada (animeface-cascade.json) es MIT, (C) 2011 nagadomi@nurs.or.jp; el aviso completo va en el propio archivo.
const integral = (gray, w, h) => {
  const I = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row
    }
  }
  return I
}
function equalize(gray) {
  const hist = new Int32Array(256), n = gray.length
  for (let i = 0; i < n; i++) hist[gray[i]]++
  let i = 0
  while (i < 255 && !hist[i]) i++
  const out = new Uint8Array(n), first = hist[i]
  if (first === n) return out.fill(i)
  const scale = 255 / (n - first), lut = new Uint8Array(256)
  let sum = 0
  for (i++; i < 256; i++) { sum += hist[i]; lut[i] = Math.max(0, Math.min(255, Math.round(sum * scale))) }
  for (let k = 0; k < n; k++) out[k] = lut[gray[k]]
  return out
}
function shrink(gray, w, h, W, H) { // promedio por área, como INTER_LINEAR al reducir poco
  const out = new Uint8Array(W * H), fx = w / W, fy = h / H
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) * fy - 0.5, y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1), ty = sy - Math.floor(sy)
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) * fx - 0.5, x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1), tx = sx - Math.floor(sx)
      const a = gray[y0 * w + x0] * (1 - tx) + gray[y0 * w + x1] * tx, b = gray[y1 * w + x0] * (1 - tx) + gray[y1 * w + x1] * tx
      out[y * W + x] = a * (1 - ty) + b * ty + 0.5
    }
  }
  return out
}
function scan(cascade, gray, W, H, step, emit) {
  const I = integral(gray, W, H), S = W + 1, { stages, features, w: cw, h: ch } = cascade
  for (let wy = 0; wy + ch <= H; wy += step) {
    for (let wx = 0; wx + cw <= W; wx += step) {
      let pass = true
      for (let s = 0; s < stages.length && pass; s++) {
        const [limit, weak] = stages[s]
        let sum = 0
        for (let q = 0; q < weak.length; q++) {
          const [f, subset, leaf] = weak[q], r = features[f], fx = wx + r[0], fy = wy + r[1], bw = r[2], bh = r[3]
          const a = fy * S + fx, y1 = a + bh * S, y2 = a + 2 * bh * S, y3 = a + 3 * bh * S
          const p0 = I[a], p1 = I[a + bw], p2 = I[a + 2 * bw], p3 = I[a + 3 * bw]
          const p4 = I[y1], p5 = I[y1 + bw], p6 = I[y1 + 2 * bw], p7 = I[y1 + 3 * bw]
          const p8 = I[y2], p9 = I[y2 + bw], p10 = I[y2 + 2 * bw], p11 = I[y2 + 3 * bw]
          const p12 = I[y3], p13 = I[y3 + bw], p14 = I[y3 + 2 * bw], p15 = I[y3 + 3 * bw]
          const c = p10 - p9 - p6 + p5
          const code = ((p5 - p4 - p1 + p0 >= c) << 7) | ((p6 - p5 - p2 + p1 >= c) << 6) | ((p7 - p6 - p3 + p2 >= c) << 5) | ((p11 - p10 - p7 + p6 >= c) << 4) | ((p15 - p14 - p11 + p10 >= c) << 3) | ((p14 - p13 - p10 + p9 >= c) << 2) | ((p13 - p12 - p9 + p8 >= c) << 1) | (p9 - p8 - p5 + p4 >= c)
          sum += leaf[subset[code >> 5] & (1 << (code & 31)) ? 0 : 1]
        }
        if (sum < limit) pass = false
      }
      if (pass) emit(wx, wy)
    }
  }
}
// Agrupa ventanas parecidas, como groupRectangles de OpenCV.
function group(rects, minNeighbors, eps = 0.2) {
  const parent = rects.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const close = (a, b) => { const d = eps * 0.5 * (Math.min(a.w, b.w) + Math.min(a.h, b.h)); return Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d && Math.abs(a.x + a.w - b.x - b.w) <= d && Math.abs(a.y + a.h - b.y - b.h) <= d }
  for (let i = 0; i < rects.length; i++) for (let j = 0; j < i; j++) if (close(rects[i], rects[j])) parent[find(i)] = find(j)
  const by = new Map()
  rects.forEach((r, i) => { const k = find(i); const g = by.get(k) || { x: 0, y: 0, w: 0, h: 0, n: 0 }; g.x += r.x; g.y += r.y; g.w += r.w; g.h += r.h; g.n++; by.set(k, g) })
  const out = [...by.values()].filter(g => g.n > minNeighbors).map(g => ({ x: Math.round(g.x / g.n), y: Math.round(g.y / g.n), w: Math.round(g.w / g.n), h: Math.round(g.h / g.n), n: g.n }))
  // Quita los que quedan dentro de otro mayor con más apoyos.
  return out.filter(a => !out.some(b => b !== a && b.n >= a.n && a.x >= b.x - b.w * 0.2 && a.y >= b.y - b.h * 0.2 && a.x + a.w <= b.x + b.w * 1.2 && a.y + a.h <= b.y + b.h * 1.2 && b.w > a.w))
}
/** data: RGBA. Devuelve los rostros en píxeles de la imagen, con `n` = ventanas que los apoyan (más es más fiable). */
function detectFaces(cascade, data, w, h, { scale = 1.1, minNeighbors = 5, minSize = 24 } = {}) {
  const raw = new Uint8Array(w * h)
  for (let i = 0; i < raw.length; i++) raw[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114 + 0.5
  const gray = equalize(raw), rects = []
  for (let f = 1; ; f *= scale) {
    const size = Math.round(cascade.w * f)
    const W = Math.round(w / f), H = Math.round(h / f)
    if (W < cascade.w || H < cascade.h) break
    if (size < minSize) continue
    scan(cascade, f === 1 ? gray : shrink(gray, w, h, W, H), W, H, f > 2 ? 1 : 2, (x, y) => rects.push({ x: Math.round(x * f), y: Math.round(y * f), w: size, h: size }))
  }
  return group(rects, minNeighbors)
}

let cascade = null
self.onmessage = async ({ data: { id, pixels, w, h } }) => {
  try {
    cascade ||= await fetch(`/animeface-cascade.json${self.location.search}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
    self.postMessage({ id, faces: detectFaces(cascade, new Uint8ClampedArray(pixels), w, h, { minNeighbors: 3 }) })
  } catch (e) { self.postMessage({ id, faces: null }) }
}
