// Modo libro 3D: un solo canvas WebGL2 con la mesa, el libro y una cámara de verdad. Hojas y cantos salen de la misma
// función de altura, así que no pueden separarse. El lector solo le dice qué páginas se ven.
// Unidades: la página mide 1 de alto. x cruza el libro (la costura en 0), y va hacia arriba de la pantalla, z sale de la mesa.

export const BOOK = { THICK: 0.075, BOARD: 0.008, OVER: 0.004, CROWN: 0.05, FALL: 0.02, DIP: 0.06, SPINE: 0.03 }
const dipAt = t => Math.exp(-t / BOOK.DIP)
// Lo que se levanta la hoja sobre un bloque plano. t: 0 en la costura, 1 en el borde exterior. open: 0 cerrado, 1 abierto.
export const arch = (t, open = 1) => open * (BOOK.CROWN * (1 - dipAt(t)) - BOOK.FALL * t * t)
// Altura de la hoja a profundidad v (0: la de arriba; 1: la de abajo). La curva se atenúa hasta la mitad en la última.
// k: 1 con el bloque entero; 0 sin hojas (la mitad sobre la que aún no ha aterrizado la cubierta).
export function sheetZ(t, v = 0, open = 1, k = 1) {
  return BOOK.BOARD + k * (BOOK.THICK * (1 - v) * (1 - 0.45 * dipAt(t) * open) + arch(t, open) * (1 - v / 2))
}
export const surface = (t, open = 1, k = 1) => sheetZ(t, 0, open, k)
const LID_Z = BOOK.BOARD * 2 + BOOK.THICK // la cara de arriba de la cubierta con el libro cerrado
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
// La mitad sobre la que aterriza la cubierta: hasta que está casi abajo no hay nada, solo la mesa. Después la cubierta ya la tapa.
export const landWidth = a => (a < 0.97 ? 0 : Math.max(0, -Math.cos(a * Math.PI)))
// Una hoja a media vuelta sobre la costura. a: 0 tumbada en su lado, 1 tumbada en el otro. rigid: la cubierta, que no se dobla.
// Parte de la hoja en reposo y vuelve a ella: al empezar y al acabar coincide con la superficie del libro, sin saltos.
export function sheetCurve(a, side, W, rigid = false, cols = 30, ext = 0) {
  const L = rigid ? 0 : 0.38, pts = []
  const hinge = rigid ? LID_Z + (surface(0) - LID_Z) * a : surface(0) + 0.0015
  const rest = t => (rigid ? LID_Z + (surface(t) - LID_Z) * a : surface(t) + 0.0015)
  let x = 0, z = 0, prev = 0
  for (let c = 0; c <= cols; c++) {
    const t = (c / cols) ** 2, phi = Math.PI * (rigid ? a : smooth(0, 1, a * (1 + L) - L * t))
    x += Math.cos(phi) * (t - prev) * (W + ext)
    z += Math.sin(phi) * (t - prev) * (W + ext)
    prev = t
    pts.push({ t, phi, x: side * x, z: hinge + z + (rest(t) - hinge) * Math.cos(phi) ** 2 })
  }
  pts.forEach((p, c) => {
    const q = pts[Math.min(cols, c + 1)], o = pts[Math.max(0, c - 1)], tx = q.x - o.x, tz = q.z - o.z, l = Math.hypot(tx, tz) || 1
    p.nx = (side * -tz) / l
    p.nz = (side * tx) / l
  })
  return pts
}
// Matriz de color de un filtro CSS (filas: r, g, b, desplazamiento), para aplicarlo a las páginas y no a la mesa.
export function filterMatrix(css) {
  let M = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
  const then = N => { M = N.map(r => [0, 1, 2, 3].map(c => r[0] * M[0][c] + r[1] * M[1][c] + r[2] * M[2][c] + (c === 3 ? r[3] : 0))) }
  for (const [, name, val] of String(css || '').matchAll(/([a-z-]+)\(([-\d.]+)(?:deg|%)?\)/g)) {
    const v = Number(val), i = 1 - v
    if (name === 'brightness') then([[v, 0, 0, 0], [0, v, 0, 0], [0, 0, v, 0]])
    else if (name === 'contrast') { const o = (1 - v) / 2; then([[v, 0, 0, o], [0, v, 0, o], [0, 0, v, o]]) }
    else if (name === 'invert') { const k = 1 - 2 * v; then([[k, 0, 0, v], [0, k, 0, v], [0, 0, k, v]]) }
    else if (name === 'grayscale') then([[0.2126 + 0.7874 * i, 0.7152 - 0.7152 * i, 0.0722 - 0.0722 * i, 0], [0.2126 - 0.2126 * i, 0.7152 + 0.2848 * i, 0.0722 - 0.0722 * i, 0], [0.2126 - 0.2126 * i, 0.7152 - 0.7152 * i, 0.0722 + 0.9278 * i, 0]])
    else if (name === 'sepia') then([[0.393 + 0.607 * i, 0.769 - 0.769 * i, 0.189 - 0.189 * i, 0], [0.349 - 0.349 * i, 0.686 + 0.314 * i, 0.168 - 0.168 * i, 0], [0.272 - 0.272 * i, 0.534 - 0.534 * i, 0.131 + 0.869 * i, 0]])
    else if (name === 'saturate') then([[0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0], [0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0], [0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v, 0]])
    else if (name === 'hue-rotate') {
      const c = Math.cos((v * Math.PI) / 180), n = Math.sin((v * Math.PI) / 180)
      then([[0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0], [0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283, 0], [0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072, 0]])
    }
  }
  return M
}

const norm = v => { const l = Math.hypot(...v) || 1; return v.map(n => n / l) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
// Perspectiva cerrada e inclinación mayor que medio campo de visión: así la cámara queda al sur del libro y se ve el canto de abajo.
export const FOV = (14 * Math.PI) / 180, TILT = (14 * Math.PI) / 180, NEAR = 0.5, FAR = 40

// Matriz de la cámara, por columnas. tilt: inclinación hacia el sur, para ver el libro con algo de ángulo.
export function cameraMatrix(target, dist, aspect, tilt = TILT, yaw = 0) {
  const eye = [target[0] + dist * Math.sin(yaw) * Math.cos(tilt), target[1] - dist * Math.sin(tilt), target[2] + dist * Math.cos(yaw) * Math.cos(tilt)]
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]), s = norm(cross(f, [0, 1, 0])), u = cross(s, f)
  const k = 1 / Math.tan(FOV / 2), A = (FAR + NEAR) / (NEAR - FAR), B = (2 * FAR * NEAR) / (NEAR - FAR)
  const row = (v, o) => [v[0], v[1], v[2], o]
  const V0 = row(s, -dot(s, eye)), V1 = row(u, -dot(u, eye)), V2 = row(f.map(n => -n), dot(f, eye))
  const m = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    m[c * 4] = (k / aspect) * V0[c]
    m[c * 4 + 1] = k * V1[c]
    m[c * 4 + 2] = A * V2[c] + (c === 3 ? B : 0)
    m[c * 4 + 3] = -V2[c]
  }
  return m
}
export function project(m, p) {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w]
}
// Distancia y objetivo para que los puntos llenen la pantalla, centrados y dejando margen (en fracción de la pantalla).
export function fitCamera(points, aspect, marginX, marginY) {
  const target = [0, 0, 0]
  const n = points.length
  for (let k = 0; k < 2; k++) target[k] = points.reduce((a, p) => a + p[k], 0) / n
  const limX = 1 - 2 * marginX, limY = 1 - 2 * marginY
  let lo = 0.5, hi = 30
  const extent = d => {
    for (let pass = 0; pass < 5; pass++) { // recentrar: con perspectiva e inclinación el centro se desplaza
      const m = cameraMatrix(target, d, aspect), q = points.map(p => project(m, p))
      const xs = q.map(a => a[0]), ys = q.map(a => a[1])
      const midX = (Math.max(...xs) + Math.min(...xs)) / 2, midY = (Math.max(...ys) + Math.min(...ys)) / 2
      const half = d * Math.tan(FOV / 2)
      target[0] += midX * half * aspect
      target[1] += midY * half
    }
    const m = cameraMatrix(target, d, aspect), q = points.map(p => project(m, p))
    const xs = q.map(a => a[0]), ys = q.map(a => a[1])
    return Math.max((Math.max(...xs) - Math.min(...xs)) / 2 / limX, (Math.max(...ys) - Math.min(...ys)) / 2 / limY)
  }
  for (let i = 0; i < 26; i++) {
    const d = (lo + hi) / 2
    if (extent(d) > 1) lo = d; else hi = d
  }
  extent(hi)
  return { target, dist: hi }
}

// Colores de la portada para la contraportada y sus botones.
const luma = c => { const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const contrast = (a, b) => { const x = luma(a), y = luma(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
export const inkOn = c => (contrast(c, [1, 1, 1]) >= contrast(c, [0.07, 0.06, 0.05]) ? [1, 1, 1] : [0.07, 0.06, 0.05])
const mixColor = (a, b, t) => a.map((n, k) => n + (b[k] - n) * t)
export const css = c => `rgb(${c.map(n => Math.round(n * 255)).join(' ')})`
// Color dominante y color de acento: el acento es el que más destaca sobre el dominante, sin ser una mota de la imagen.
export function coverPalette(data) {
  const boxes = new Map()
  for (let p = 0; p < data.length; p += 4) {
    const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4)
    const b = boxes.get(key) || { n: 0, c: [0, 0, 0] }
    b.n++
    for (let k = 0; k < 3; k++) b.c[k] += data[p + k] / 255
    boxes.set(key, b)
  }
  const list = [...boxes.values()].map(b => ({ n: b.n, c: b.c.map(v => v / b.n) })).sort((a, b) => b.n - a.n)
  const base = list[0]?.c || [0.2, 0.14, 0.1]
  let accent = null, best = 0
  for (const b of list) {
    const sat = Math.max(...b.c) - Math.min(...b.c), score = Math.sqrt(b.n) * Math.hypot(b.c[0] - base[0], b.c[1] - base[1], b.c[2] - base[2]) * (0.35 + sat)
    if (score > best) { best = score; accent = b.c }
  }
  accent ||= base
  // Si apenas se distingue del dominante, se aclara o se oscurece hasta que se vea.
  const away = luma(base) > 0.3 ? [0, 0, 0] : [1, 1, 1]
  for (let i = 0; i < 10 && contrast(accent, base) < 2.4; i++) accent = mixColor(accent, away, 0.18)
  return { base, accent }
}

// Madera generada: se repite sin que se note el corte.
export function woodCanvas() {
  const S = 1024, PLANKS = 5, canvas = Object.assign(document.createElement('canvas'), { width: S, height: S }), g = canvas.getContext('2d')
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let p = 0; p < PLANKS; p++) {
    const x0 = (p * S) / PLANKS, w = S / PLANKS, light = 34 + rnd() * 7
    g.save()
    g.beginPath(); g.rect(x0, 0, w, S); g.clip()
    g.fillStyle = `hsl(${24 + rnd() * 5}, 46%, ${light}%)`
    g.fillRect(x0, 0, w, S)
    const phase = rnd() * 6, swing = 4 + rnd() * 10
    for (let i = 0; i < 170; i++) {
      const x = x0 + rnd() * w, dark = rnd() < 0.72
      g.strokeStyle = dark ? `rgba(40,20,8,${0.05 + rnd() * 0.16})` : `rgba(255,214,160,${0.02 + rnd() * 0.07})`
      g.lineWidth = 0.5 + rnd() * 2.4
      g.beginPath()
      for (let y = 0; y <= S; y += 32) {
        const turn = (y / S) * Math.PI * 2
        const dx = Math.sin(turn + phase) * swing + Math.sin(turn * 3 + x * 0.05) * 1.6
        if (y) g.lineTo(x + dx, y); else g.moveTo(x + dx, y)
      }
      g.stroke()
    }
    g.restore()
    g.fillStyle = 'rgba(20,9,3,.55)'
    g.fillRect(x0 - 1, 0, 2, S)
  }
  return canvas
}

const VS = `#version 300 es
uniform mat4 uM;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUV;
out vec3 vPos; out vec3 vNor; out vec2 vUV;
void main() { vPos = aPos; vNor = aNor; vUV = aUV; gl_Position = uM * vec4(aPos, 1.0); }`
const FS = `#version 300 es
precision highp float;
uniform int uKind;
uniform sampler2D uTex;
uniform vec3 uColor;
uniform vec4 uMap, uRect;
uniform float uSoft, uAlpha, uSeamAt, uHas, uFlip, uMirror;
uniform vec2 uCast;
uniform vec3 uTab;
uniform mat3 uFx;
uniform vec3 uFxO;
in vec3 vPos; in vec3 vNor; in vec2 vUV;
out vec4 color;
const vec3 L = normalize(vec3(-0.16, -0.26, 0.95));
// Luz: 1 con la hoja plana; se oscurece al inclinarse hacia la costura o en las caras laterales.
float light() { return clamp(mix(0.55, 1.0, max(dot(normalize(vNor) * uFlip, L), 0.0) / L.z), 0.0, 1.06); }
// La sombra de la hoja que gira: desde la costura hasta donde cae la proyección de su borde.
float castShade() {
  if (uCast.y <= 0.0 || abs(uCast.x) < 0.001) return 1.0;
  float r = vPos.x / uCast.x;
  if (r <= 0.0) return 1.0;
  // La hoja solo mide lo que mide el libro: su sombra no llega a la mesa de más arriba ni de más abajo.
  float inY = 1.0 - smoothstep(0.5, 0.56, abs(vPos.y));
  return 1.0 - uCast.y * inY * (1.0 - smoothstep(0.7, 1.15, r));
}
vec3 fx(vec3 c) { return clamp(uFx * c + uFxO, 0.0, 1.0); }
// Misma hendidura que el lector normal, para que la página se vea igual.
float gutter(float d) {
  if (d < 0.012) return mix(0.45, 0.62, d / 0.012);
  if (d < 0.03) return mix(0.62, 0.82, (d - 0.012) / 0.018);
  if (d < 0.06) return mix(0.82, 0.94, (d - 0.03) / 0.03);
  if (d < 0.1) return mix(0.94, 1.0, (d - 0.06) / 0.04);
  return 1.0;
}
void main() {
  if (uKind == 0) { // mesa: la luz cae sobre el libro y se apaga hacia fuera
    vec3 wood = uTab.z > 0.0 ? texture(uTex, vec2(0.5 + vPos.x * uTab.x, 0.5 - vPos.y * uTab.y), -0.4).rgb : texture(uTex, vUV, -0.4).rgb;
    float r = length((vPos.xy - uRect.xy) / uRect.zw);
    color = vec4(wood * mix(1.08, 0.62, smoothstep(0.5, 2.1, r)) * castShade(), 1.0);
  } else if (uKind == 1) { // sombra en la mesa: un rectángulo difuso
    vec2 a = smoothstep(uRect.xy - uSoft, uRect.xy + uSoft, vPos.xy) * (1.0 - smoothstep(uRect.zw - uSoft, uRect.zw + uSoft, vPos.xy));
    color = vec4(0.05, 0.02, 0.0, 1.0) * uAlpha * a.x * a.y;
  } else if (uKind == 2) { // tapa
    color = vec4(uColor * light() * castShade(), 1.0);
  } else if (uKind == 3) { // canto: cada línea es una hoja, y sigue la curva porque la malla la sigue
    float v = vUV.y * 15.0, w = fwidth(v);
    float line = 1.0 - smoothstep(0.0, max(w, 0.35), abs(fract(v) - 0.5) - 0.12);
    vec3 c = uColor * (1.0 - 0.17 * line) * mix(0.82, 1.0, smoothstep(0.0, 0.45, vUV.y));
    color = vec4(fx(c) * min(1.0, light() * 1.3) * castShade(), 1.0); // el papel de los cantos recibe luz rebotada de la mesa
  } else if (uKind == 4) { // página
    float ux = uMirror > 0.5 ? 1.0 - vUV.x : vUV.x;
    vec2 q = vec2(ux * uMap.x + uMap.y, vUV.y * uMap.z + uMap.w);
    vec3 c = uColor;
    if (uHas > 0.5 && q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) c = texture(uTex, q, -0.5).rgb;
    color = vec4(fx(c) * light() * gutter(uSeamAt < 0.5 ? ux : 1.0 - ux) * castShade(), 1.0);
  } else if (uKind == 5) { // portada, plana y sin hendidura
    color = vec4(fx(uHas > 0.5 ? texture(uTex, vUV, -0.5).rgb : uColor) * light() * castShade(), 1.0);
  } else { // lomo: el color del borde de la portada, de arriba abajo
    color = vec4(fx(uHas > 0.5 ? texture(uTex, vec2(uSeamAt, vUV.y)).rgb : uColor) * light() * castShade(), 1.0);
  }
}`

// Junta rejillas en una malla: pos(3) normal(3) uv(2).
export class Shape {
  constructor() { this.v = []; this.i = [] }
  grid(cols, rows, at) {
    const base = this.v.length / 8
    for (let c = 0; c <= cols; c++) for (let r = 0; r <= rows; r++) this.v.push(...at(c, r))
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const a = base + c * (rows + 1) + r, b = a + rows + 1
      this.i.push(a, a + 1, b, b, a + 1, b + 1)
    }
    return this
  }
  box(x0, x1, y0, y1, z0, z1) {
    const quad = (o, a, b, n) => this.grid(1, 1, (c, r) => [o[0] + a[0] * c + b[0] * r, o[1] + a[1] * c + b[1] * r, o[2] + a[2] * c + b[2] * r, ...n, c, r])
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0
    quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1])
    quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0])
    quad([x0, y1, z0], [dx, 0, 0], [0, 0, dz], [0, 1, 0])
    quad([x0, y0, z0], [0, dy, 0], [0, 0, dz], [-1, 0, 0])
    quad([x1, y0, z0], [0, dy, 0], [0, 0, dz], [1, 0, 0])
    return this
  }
}
const COLS = 30
const tAt = c => (c / COLS) ** 2 // más columnas junto a la costura, donde la curva es más cerrada
function slope(t, open, k) { const e = 0.002, a = Math.min(1, t + e), b = Math.max(0, t - e); return (surface(a, open, k) - surface(b, open, k)) / (a - b) }
// Una mitad del libro. side: -1 izquierda, 1 derecha. width: lo que ya se ha extendido, de 0 a 1.
function pageShape(side, W, open, k = 1, width = 1) {
  return new Shape().grid(COLS, 1, (c, r) => {
    const t = tAt(c), n = norm([(-side * slope(t, open, k)) / W, 0, 1])
    return [side * W * width * t, 0.5 - r, surface(t, open, k), ...n, side > 0 ? t : 1 - t, r]
  })
}
// Los cantos de esa mitad, extruidos desde la misma curva: abajo, arriba y por fuera.
function edgeShape(sh, side, W, open, k = 1, width = 1) {
  const RINGS = 5, v = r => (r >= RINGS ? 1 : r / RINGS)
  const z = (t, r) => (r > RINGS ? BOOK.BOARD : sheetZ(t, v(r), open, k))
  for (const [y, ny] of [[-0.5, -1], [0.5, 1]]) sh.grid(COLS, RINGS + 1, (c, r) => { const t = tAt(c); return [side * W * width * t, y, z(t, r), 0, ny, 0, t, v(r)] })
  sh.grid(1, RINGS + 1, (c, r) => [side * W * width, c - 0.5, z(1, r), side, 0, 0, c, v(r)])
  return sh
}
function spineShape(outward, top, size) {
  const STEPS = 10, mid = top / 2
  return new Shape().grid(STEPS, 1, (c, r) => {
    const a = (c / STEPS) * Math.PI, sx = Math.sin(a), cz = Math.cos(a)
    return [outward * size * sx, 0.5 + BOOK.OVER - r * (1 + 2 * BOOK.OVER), mid + mid * cz, outward * sx, 0, cz, c / STEPS, r]
  })
}
// La hoja que gira y, en la cubierta, su grosor por el borde de abajo y por fuera.
function sheetShape(pts, y0 = -0.5, y1 = 0.5) {
  const s = new Shape(), n = pts.length - 1
  s.grid(n, 1, (c, r) => { const p = pts[c]; return [p.x, y1 + (y0 - y1) * r, p.z, p.nx, 0, p.nz, p.u, r] })
  return s
}
function rimShape(pts, y0, y1, thick) {
  const s = new Shape(), n = pts.length - 1, e = pts[n]
  s.grid(n, 1, (c, r) => { const p = pts[c]; return [p.x - p.nx * thick * r, y0, p.z - p.nz * thick * r, 0, -1, 0, 0, 0] })
  s.grid(1, 1, (c, r) => [e.x - e.nx * thick * r, y0 + (y1 - y0) * c, e.z - e.nz * thick * r, e.nz * Math.sign(e.x || 1), 0, -e.nx * Math.sign(e.x || 1), 0, 0])
  return s
}

// El sensor: los ejes de la pantalla a partir de la orientación del dispositivo. La inclinación se desvanece con el tiempo.
// MAX_DEG: lo que hay que girar el dispositivo para llegar al tope. ORBIT_*: cuánto rodea entonces la cámara al libro, en grados.
export const MAX_DEG = 15
const FADE_S = 2.5, QUIET = 0.6, ORBIT_TILT = 7, ORBIT_YAW = 10, ORBIT_BACK = 0.06
export function createTilt(onChange) {
  const target = { x: 0, y: 0 }
  let listening = false, gotOrientation = false, lastT = 0, lastOri = null, lastFade = 0, askOnTouch = null
  const clamp = v => Math.max(-MAX_DEG, Math.min(MAX_DEG, v))
  function screenAngle() {
    let a = (((window.orientation ?? screen.orientation?.angle ?? 0) % 360) + 360) % 360
    const landscape = innerWidth > innerHeight
    if (landscape && a % 180 === 0) a = 90
    if (!landscape && a % 180) a = 0
    return (a * Math.PI) / 180
  }
  function add(dx, dy) {
    const a = screenAngle(), c = Math.cos(a), s = Math.sin(a)
    target.x = clamp(target.x + dx * c - dy * s)
    target.y = clamp(target.y + dx * s + dy * c)
    lastFade = lastFade || performance.now()
    onChange()
  }
  const stepOf = t => { const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000)); lastT = t; return dt }
  const quiet = v => (Math.abs(v) < QUIET ? 0 : v)
  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return
    gotOrientation = true
    const dt = stepOf(e.timeStamp)
    if (lastOri) {
      const dx = e.beta - lastOri.b, dy = e.gamma - lastOri.g
      const still = dt > 0 && Math.hypot(dx, dy) / dt < QUIET
      if (!still && Math.abs(dx) < 25 && Math.abs(dy) < 25) add(dx, dy)
    }
    lastOri = { b: e.beta, g: e.gamma }
  }
  function onMotion(e) {
    const r = e.rotationRate
    if (gotOrientation || r?.alpha == null || r?.beta == null) return
    const dt = stepOf(e.timeStamp)
    add(quiet(r.alpha) * dt, quiet(r.beta) * dt) // especificación: alpha es el eje x y beta el eje y
  }
  function listen(on) {
    if (on === listening) return
    listening = on
    const method = on ? 'addEventListener' : 'removeEventListener'
    window[method]('devicemotion', onMotion)
    window[method]('deviceorientation', onOrientation)
    target.x = target.y = 0
    lastT = performance.now()
    lastOri = null
    onChange()
  }
  const forget = () => { if (askOnTouch) document.removeEventListener('click', askOnTouch); askOnTouch = null }
  // iOS pide permiso desde un toque. Con el permiso ya dado se repite sin toque; si no, espera al siguiente. Sin permiso, el libro queda quieto.
  function permit() {
    if (!isSecureContext) return
    const M = window.DeviceMotionEvent, O = window.DeviceOrientationEvent
    const asked = M?.requestPermission ? M.requestPermission() : O?.requestPermission ? O.requestPermission() : null
    if (!asked) return listen(true)
    asked.then(answer => { forget(); if (answer === 'granted' && document.visibilityState === 'visible') listen(true) }, () => {
      if (askOnTouch) return
      askOnTouch = () => { forget(); permit() }
      document.addEventListener('click', askOnTouch)
    })
  }
  return {
    target,
    permit,
    listen,
    get listening() { return listening },
    // Con el dispositivo quieto pueden dejar de llegar lecturas: el regreso al centro va por tiempo.
    fade(now) {
      const dt = Math.min(0.1, Math.max(0, (now - lastFade) / 1000)), keep = Math.exp(-dt / FADE_S)
      lastFade = now
      for (const k of ['x', 'y']) target[k] = Math.abs(target[k] * keep) < 0.3 ? 0 : target[k] * keep
    },
    stop() { forget(); listen(false) },
  }
}

function enableBookPan(canvas, current, update) {
  let drag = null, suppressClick = false
  const cursor = () => { canvas.style.cursor = current().s > 1 ? (drag ? 'grabbing' : 'grab') : '' }
  canvas.addEventListener('pointerdown', event => {
    if (current().s <= 1 || event.button !== 0) return
    suppressClick = false
    const { x, y } = current()
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x, y, moved: false }
    canvas.setPointerCapture(event.pointerId)
    cursor()
    event.preventDefault()
  })
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
    if (Math.hypot(dx, dy) > 4) drag.moved = true
    if (drag.moved) update(drag.x + dx, drag.y + dy)
  })
  const end = event => {
    if (!drag || event.pointerId !== drag.id) return
    suppressClick = drag.moved
    drag = null
    cursor()
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false }
  }, true)
  return cursor
}

export function createBook3D(container, opts) {
  const { total, src, whenReady, spreadOf, isWide, still = false } = opts
  const canvas = document.createElement('canvas')
  canvas.className = 'b3dcanvas'
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, powerPreference: 'high-performance' })
  if (!gl) return null
  container.replaceChildren(canvas)
  let dead = false, raf = 0, u = {}, prog = null, wood = null, tableMesh = null, aniso = null, maxSize = 2400
  let tableTex = null, tableAspect = 1
  let backTex = null, backColors = null, backSent = '', backFrom = null, backNear = false, backTimer = 0
  let W = 0, coverColor = [0.2, 0.14, 0.1], view = null, statics = null, staticKey = '', dyn = null
  let anim = null, camNow = null, camMove = null, zoom = { s: 1, x: 0, y: 0 }, fxM = filterMatrix('')
  const textures = new Map(), loading = new Map(), queue = []
  const fitCache = new Map()
  let uploadTimer = 0, rect = { width: 1, height: 1 }
  const tiltNow = { x: 0, y: 0 }
  const tilt = createTilt(() => draw())

  function makeMesh(sh, usage = gl.STATIC_DRAW) {
    const vao = gl.createVertexArray(), vb = gl.createBuffer(), ib = gl.createBuffer()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sh.v), usage)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sh.i), usage)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24)
    gl.bindVertexArray(null)
    return { vao, vb, ib, n: sh.i.length }
  }
  const freeMesh = m => { if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib) } }
  const drawMesh = m => { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0) }
  // Mallas que cambian en cada fotograma de una animación: se reutilizan los mismos búferes.
  function dynMesh(name, sh) {
    const m = (dyn[name] ||= makeMesh(new Shape(), gl.DYNAMIC_DRAW))
    gl.bindVertexArray(m.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sh.v), gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sh.i), gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
    m.n = sh.i.length
    return m
  }

  function initGL() {
    const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s }
    prog = gl.createProgram()
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'shader')
    gl.useProgram(prog)
    u = {}
    for (const n of ['uM', 'uKind', 'uTex', 'uColor', 'uMap', 'uRect', 'uSoft', 'uAlpha', 'uSeamAt', 'uHas', 'uFlip', 'uMirror', 'uCast', 'uTab', 'uFx', 'uFxO']) u[n] = gl.getUniformLocation(prog, n)
    gl.uniform1i(u.uTex, 0)
    gl.uniform1f(u.uFlip, 1)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.clearColor(0.29, 0.18, 0.1, 1)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 2400) // más grande no se aprecia y agota la memoria en la tableta
    wood = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, wood)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, woodCanvas())
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    const TABLE = 14, TILE = 1.7
    tableMesh = makeMesh(new Shape().grid(1, 1, (c, r) => { const x = (c * 2 - 1) * TABLE, y = (r * 2 - 1) * TABLE; return [x, y, 0, 0, 0, 1, x / TILE, y / TILE] }))
    dyn = {}
    statics = null
    staticKey = ''
  }

  // ----- Texturas -----
  function makeTexture(source) {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
    return tex
  }
  // Fondo elegido por el usuario: una sola imagen fija sobre la mesa, que llena lo que se ve. Si asoma el borde, sigue en espejo, sin corte.
  function loadTable() {
    if (!opts.table) return
    const im = new Image()
    im.onload = () => {
      if (dead || gl.isContextLost() || !im.naturalWidth) return
      tableTex = makeTexture(im)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT)
      tableAspect = im.naturalWidth / im.naturalHeight
      draw()
    }
    im.src = opts.table
  }
  function tableScale() {
    let half = 1.5
    if (W > 0) {
      const ref = fitOf({ kind: 'open', focus: rect.height > rect.width ? 1 : 0 }) // la vista más abierta de esta pantalla
      const hy = ref.dist * 1.3 * Math.tan(FOV / 2) * 1.1 + Math.abs(ref.target[1]), hx = hy * (rect.width / rect.height) + Math.abs(ref.target[0])
      half = Math.max(hy, hx / tableAspect)
    }
    return 1 / (2 * half)
  }
  // La contraportada: los colores de la portada, en espejo y muy difuminados para que continúe por el lomo, con un marco de su color de acento.
  function buildBack(im) {
    try {
      const small = Object.assign(document.createElement('canvas'), { width: 48, height: 72 }), sg = small.getContext('2d', { willReadFrequently: true })
      sg.drawImage(im, 0, 0, 48, 72)
      const { base, accent } = coverPalette(sg.getImageData(0, 0, 48, 72).data)
      const H = 1152, w = Math.round(H * Math.min(0.85, Math.max(0.45, im.naturalWidth / im.naturalHeight)))
      const c = Object.assign(document.createElement('canvas'), { width: w, height: H }), g = c.getContext('2d', { willReadFrequently: true })
      g.fillStyle = css(base)
      g.fillRect(0, 0, w, H)
      const blur = Object.assign(document.createElement('canvas'), { width: 3, height: 4 }), bg = blur.getContext('2d')
      bg.translate(3, 0)
      bg.scale(-1, 1)
      bg.drawImage(small, 0, 0, 3, 4)
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.globalAlpha = 0.4
      g.drawImage(blur, 0, 0, w, H)
      g.globalAlpha = 1
      const shade = g.createRadialGradient(w / 2, H / 2, H * 0.2, w / 2, H / 2, H * 0.72)
      shade.addColorStop(0, 'rgba(0,0,0,0)')
      shade.addColorStop(1, 'rgba(0,0,0,.28)')
      g.fillStyle = shade
      g.fillRect(0, 0, w, H)
      const inset = w * 0.055
      g.strokeStyle = css(accent)
      g.lineWidth = w * 0.009
      g.strokeRect(inset, inset, w - 2 * inset, H - 2 * inset)
      g.lineWidth = w * 0.003
      g.strokeRect(inset * 1.35, inset * 1.35, w - 2.7 * inset, H - 2.7 * inset)
      const mid = g.getImageData(Math.round(w * 0.2), Math.round(H * 0.3), Math.round(w * 0.6), Math.round(H * 0.4)).data, surface = [0, 0, 0]
      for (let p = 0; p < mid.length; p += 4) for (let k = 0; k < 3; k++) surface[k] += mid[p + k]
      const area = mid.length / 4
      for (let k = 0; k < 3; k++) surface[k] /= area * 255
      if (backTex) gl.deleteTexture(backTex)
      backTex = makeTexture(c)
      backColors = { surface: css(surface), ink: css(inkOn(surface)), accent: css(accent), accentInk: css(inkOn(accent)), line: css(mixColor(surface, inkOn(surface), 0.45)) }
      backSent = ''
    } catch (err) { console.warn('Contraportada:', err) } // sin ella, la tapa queda del color del borde de la portada
  }
  // Se fabrica una vez y solo cerca del final: al abrir el capítulo no debe retrasar las primeras páginas.
  function ensureBack() {
    if (!backFrom || !backNear || dead || gl.isContextLost()) return
    const im = backFrom
    backFrom = null
    buildBack(im)
    realBack()
    draw()
  }
  // La contraportada original del tomo, si existe, sustituye a la fabricada; los colores de los botones no cambian.
  let backImage = null, backAsked = false
  function realBack() {
    if (backImage) return placeRealBack()
    if (!opts.back || backAsked) return
    backAsked = true
    const im = new Image()
    im.onload = () => {
      if (dead || !im.naturalWidth) return
      backImage = im
      placeRealBack()
      draw()
    }
    im.src = opts.back
  }
  function placeRealBack() {
    if (dead || gl.isContextLost() || !backColors) return
    let source = backImage
    const big = Math.max(source.naturalWidth, source.naturalHeight)
    if (big > maxSize) {
      const k = maxSize / big, c = Object.assign(document.createElement('canvas'), { width: Math.round(source.naturalWidth * k), height: Math.round(source.naturalHeight * k) })
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height)
      source = c
    }
    if (backTex) gl.deleteTexture(backTex)
    backTex = makeTexture(source)
  }
  function upload(i, im) {
    let source = im, w = im.naturalWidth, h = im.naturalHeight
    if (!w || !h) return
    if (Math.max(w, h) > maxSize) { // reducir aquí: pasarla entera podría fallar
      const k = maxSize / Math.max(w, h), c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) }), g = c.getContext('2d')
      g.imageSmoothingQuality = 'high'
      g.drawImage(im, 0, 0, c.width, c.height)
      source = c
    }
    if (i === 0) { coverColor = sampleCover(im); backFrom = im; ensureBack() }
    const tex = makeTexture(source)
    const had = textures.get(i)
    if (had) gl.deleteTexture(had.tex)
    textures.set(i, { tex, w, h })
    // La forma del libro la da la primera página que no sea ancha.
    if (!W && w < h) { W = Math.min(0.85, Math.max(0.45, w / h)); staticKey = ''; fitCache.clear() }
    draw()
  }
  function sampleCover(im) {
    try {
      const c = Object.assign(document.createElement('canvas'), { width: 8, height: 8 }), g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(im, 0, im.naturalHeight * 0.92, im.naturalWidth, im.naturalHeight * 0.08, 0, 0, 8, 8) // el canto de abajo, que es lo que se ve
      const d = g.getImageData(0, 0, 8, 8).data, sum = [0, 0, 0]
      for (let p = 0; p < d.length; p += 4) for (let k = 0; k < 3; k++) sum[k] += d[p + k]
      return sum.map(v => (v / 64 / 255) * 0.62)
    } catch { return coverColor }
  }
  // Se sube de una en una y lo que se ve ahora primero: subir una textura grande para un momento el hilo principal.
  function pump() {
    uploadTimer = 0
    if (dead || !queue.length || gl.isContextLost()) return
    if (anim && !anim.dragging && anim.p < 1) { uploadTimer = setTimeout(pump, 120); return } // no durante un giro
    const visible = view ? pagesOf(view) : []
    const at = queue.findIndex(q => visible.includes(q.i))
    const [next] = queue.splice(Math.max(0, at), 1)
    if (!textures.has(next.i) && wanted(next.i)) upload(next.i, next.im)
    if (queue.length) uploadTimer = setTimeout(pump, visible.includes(queue[0]?.i) ? 0 : 90)
  }
  let keepFrom = 0, keepTo = 0
  let glEpoch = 0 // lo que se pidió antes de perder el contexto ya no vale: su textura nacería muerta y la página quedaría en blanco
  const wanted = i => i === 0 || (i >= keepFrom && i <= keepTo)
  function want(i) {
    if (i == null || i < 0 || i >= total || textures.has(i) || loading.has(i) || gl.isContextLost()) return
    if (queue.some(q => q.i === i)) return
    loading.set(i, true)
    const epoch = glEpoch
    const go = url => {
      if (!url) { if (epoch === glEpoch) loading.delete(i); return }
      const im = new Image()
      im.onload = async () => {
        await im.decode?.().catch(() => {})
        if (dead || epoch !== glEpoch) return
        loading.delete(i)
        queue.push({ i, im })
        if (!uploadTimer) uploadTimer = setTimeout(pump, 0)
      }
      im.onerror = () => { if (epoch === glEpoch) loading.delete(i) }
      im.src = url
    }
    if (whenReady) whenReady(i, go); else go(src(i))
  }
  function trim() {
    for (const [i, t] of textures) if (!wanted(i)) { gl.deleteTexture(t.tex); textures.delete(i) }
    for (let n = queue.length - 1; n >= 0; n--) if (!wanted(queue[n].i)) queue.splice(n, 1)
  }

  // ----- Lo que se ve -----
  const rtl = () => opts.dir() === 'rtl'
  function viewOf(group) {
    const first = group[0], spread = spreadOf(first)
    if (spread.length === 1 && isWide(first)) return { kind: 'wide', page: first, focus: 0, key: `w${first}` }
    if (spread.length === 1 && first === 0) return { kind: 'closed', under: rtl() ? -1 : 1, cover: 0, focus: 0, key: 'c' }
    const [a, b = null] = spread, right = rtl() ? a : b, left = rtl() ? b : a
    return { kind: 'open', right, left, focus: group.length === 1 && !(spread.length === 1 && opts.double?.()) ? (group[0] === right ? 1 : -1) : 0, key: `o${a}` } // a doble página, una suelta se ve con el libro entero
  }
  const pagesOf = v => (v.kind === 'closed' ? [0] : v.kind === 'wide' ? [v.page] : [v.left, v.right]).filter(i => i != null)
  const pageOn = (v, side) => (v.kind === 'wide' ? { i: v.page, wide: true } : v.kind === 'closed' ? { i: null } : { i: side > 0 ? v.right : v.left })

  // Lo que debe llenar la pantalla. A una página, solo esa mitad; la otra sigue ahí, fuera de cuadro.
  function frameOf(v) {
    const O = BOOK.OVER, y0 = -0.5 - O, y1 = 0.5 + O, h = BOOK.BOARD + BOOK.THICK + BOOK.CROWN
    let x0 = -W - O, x1 = W + O
    if (v.kind === 'closed') {
      x0 = v.under > 0 ? -BOOK.SPINE : -W - O
      x1 = v.under > 0 ? W + O : BOOK.SPINE
    } else if (v.focus) {
      x0 = v.focus > 0 ? 0 : -W - O
      x1 = v.focus > 0 ? W + O : 0
    }
    return [[x0, y0, 0], [x1, y0, 0], [x0, y1, 0], [x1, y1, 0], [x0, y0, h], [x1, y0, h], [x0, y1, h], [x1, y1, h]]
  }
  // El encuadre se calcula una vez por vista y tamaño de pantalla: no hace falta repetirlo en cada fotograma.
  function fitOf(v) {
    const margin = Math.max(14, Math.min(40, Math.min(rect.width, rect.height) * 0.04))
    const key = `${v.kind}:${v.under || 0}:${v.focus}:${W}:${rect.width}x${rect.height}`
    let cam = fitCache.get(key)
    if (!cam) {
      cam = fitCamera(frameOf(v), rect.width / rect.height, margin / rect.width, margin / rect.height)
      if (fitCache.size > 12) fitCache.clear()
      fitCache.set(key, cam)
    }
    return cam
  }
  const mixCam = (a, b, t) => ({ target: a.target.map((n, k) => n + (b.target[k] - n) * t), dist: a.dist + (b.dist - a.dist) * t })

  // Libro en reposo: la malla se reutiliza. Durante la cubierta se rehace en cada fotograma.
  function bookShapes(o, under, land) {
    const O = BOOK.OVER, ed = new Shape()
    const out = { left: null, right: null }
    for (const side of [-1, 1]) {
      const isLand = under && side === -under, k = isLand ? land.k : 1, width = isLand ? land.width : 1
      if (!width) continue
      out[side > 0 ? 'right' : 'left'] = pageShape(side, W, o, k, width)
      edgeShape(ed, side, W, o, k, width)
    }
    const landOf = side => (under && side === -under ? land.width : 1)
    const xL = -W * landOf(-1) - (landOf(-1) ? O : 0), xR = W * landOf(1) + (landOf(1) ? O : 0)
    out.edges = ed
    out.board = new Shape().box(xL, xR, -0.5 - O, 0.5 + O, 0, BOOK.BOARD)
    return out
  }
  function staticMeshes(v) {
    const key = `${v.kind === 'closed' ? `c${v.under}` : 'o'}:${W}`
    if (key === staticKey && statics) return statics
    if (statics) for (const m of Object.values(statics)) freeMesh(m)
    staticKey = key
    const sh = v.kind === 'closed' ? bookShapes(0, v.under, { k: 0, width: 0 }) : bookShapes(1, 0, null)
    statics = {}
    for (const [n, s] of Object.entries(sh)) if (s) statics[n] = makeMesh(s)
    return statics
  }

  function pageMap(i, side, wide) {
    const t = textures.get(i)
    if (!t) return null
    const region = wide ? 2 * W : W, a = t.w / t.h
    let sx = 1, sy = 1 // Fracción del hueco que llena la imagen, sin deformarla
    if (a < region) sx = a / region; else sy = region / a
    const ox = (1 - sx) / 2, oy = (1 - sy) / 2
    const scale = wide ? 0.5 : 1, start = wide && side > 0 ? 0.5 : 0
    return { tex: t.tex, map: [scale / sx, (start - ox) / sx, 1 / sy, -oy / sy] }
  }
  function drawPage(mesh, page, side, mirror = false) {
    const p = page?.i == null ? null : pageMap(page.i, side, page.wide)
    gl.uniform1i(u.uKind, 4)
    gl.uniform1f(u.uSeamAt, side > 0 ? 0 : 1)
    gl.uniform1f(u.uHas, p ? 1 : 0)
    gl.uniform1f(u.uMirror, mirror ? 1 : 0)
    if (p) { gl.bindTexture(gl.TEXTURE_2D, p.tex); gl.uniform4fv(u.uMap, p.map) }
    gl.uniform3fv(u.uColor, opts.paper())
    drawMesh(mesh)
    gl.uniform1f(u.uMirror, 0)
  }
  // Dibuja las dos caras de una hoja: la de delante en su lado y la de detrás, ya volteada, en el otro.
  function drawSheet(mesh, side, front, back, lid = null) {
    gl.enable(gl.CULL_FACE)
    gl.frontFace(side > 0 ? gl.CCW : gl.CW)
    gl.cullFace(gl.BACK)
    if (lid) {
      gl.uniform1i(u.uKind, 5)
      gl.uniform1f(u.uHas, lid.tex ? 1 : 0)
      if (lid.tex) gl.bindTexture(gl.TEXTURE_2D, lid.tex)
      gl.uniform3fv(u.uColor, coverColor)
      drawMesh(mesh)
    } else drawPage(mesh, front, side)
    gl.cullFace(gl.FRONT)
    gl.uniform1f(u.uFlip, -1)
    drawPage(mesh, back, -side, true)
    gl.uniform1f(u.uFlip, 1)
    gl.disable(gl.CULL_FACE)
  }

  function drawBook(m, left, right) {
    gl.uniform1i(u.uKind, 2)
    gl.uniform3fv(u.uColor, coverColor)
    drawMesh(m.board)
    gl.uniform1i(u.uKind, 3)
    gl.uniform3fv(u.uColor, opts.paper())
    drawMesh(m.edges)
    if (m.left) drawPage(m.left, left, -1)
    if (m.right) drawPage(m.right, right, 1)
  }
  // Lo que va en la tapa: la portada delante, o la contraportada por detrás del libro. El lomo toma el color de su borde.
  const lidOf = isBack => ({ tex: isBack ? backTex : textures.get(0)?.tex })
  function drawSpine(under, top, size, lid) {
    gl.uniform1i(u.uKind, 6)
    gl.uniform1f(u.uHas, lid.tex ? 1 : 0)
    if (lid.tex) gl.bindTexture(gl.TEXTURE_2D, lid.tex)
    gl.uniform3fv(u.uColor, coverColor)
    gl.uniform1f(u.uSeamAt, under > 0 ? 0.01 : 0.99)
    drawMesh(dynMesh('spine', spineShape(-under, top, size)))
  }
  // La cubierta: una pieza rígida con grosor. a: 0 cerrada, 1 ya abierta.
  function drawCover(under, a, backPage, lid) {
    const O = BOOK.OVER
    const pts = sheetCurve(a, under, W, true, 12, O)
    pts.forEach(p => { p.u = under > 0 ? p.t : 1 - p.t })
    const mesh = dynMesh('cover', sheetShape(pts, -0.5 - O, 0.5 + O))
    gl.uniform1i(u.uKind, 2)
    gl.uniform3fv(u.uColor, coverColor)
    drawMesh(dynMesh('rim', rimShape(pts, -0.5 - O, 0.5 + O, BOOK.BOARD)))
    drawSheet(mesh, under, null, backPage, lid)
    return pts.at(-1)
  }

  function stepTilt(now) {
    tilt.fade(now)
    const on = !still && zoom.s === 1
    const want = on ? { x: tilt.target.x / MAX_DEG, y: tilt.target.y / MAX_DEG } : { x: 0, y: 0 }
    let moving = !!(tilt.target.x || tilt.target.y) && on
    for (const k of ['x', 'y']) {
      const d = want[k] - tiltNow[k]
      if (Math.abs(d) < 0.002) tiltNow[k] = want[k]
      else { tiltNow[k] += d * 0.25; moving = true }
    }
    return moving
  }
  function stepAnim(now) {
    if (!anim) return false
    const dt = Math.min(0.12, (now - anim.last) / 1000) // tras un tirón, recuperar sin alargar la animación
    anim.last = now
    if (anim.dragging) {
      const d = anim.goal - anim.p
      anim.p += d * 0.35
      return true
    }
    const before = anim.p
    anim.p = anim.back ? Math.max(0, before - dt / anim.dur) : Math.min(1, before + dt / anim.dur)
    if ((anim.back && anim.p <= 0) || (!anim.back && anim.p >= 1)) { finishAnim(!anim.back); return !!anim }
    return true
  }
  // Acaba la animación en uno de los dos extremos y deja el libro en reposo.
  function finishAnim(commit = true) {
    const a = anim
    if (!a) return
    anim = null
    view = commit ? a.to : a.from
    camNow = null
    camMove = null
    opts.onTurnEnd?.(a.ctl)
    a.done?.(commit)
    draw()
  }

  // Dónde queda la contraportada en la pantalla: el lector pone ahí los botones, y siguen al libro cuando se mueve.
  function reportBack(M) {
    if (!opts.onBack) return
    let at = null
    if (!anim && view?.back && W > 0) {
      const O = BOOK.OVER, far = view.under * (W + O)
      const q = [[0, -0.5 - O], [far, -0.5 - O], [0, 0.5 + O], [far, 0.5 + O]].map(([x, y]) => project(M, [x, y, LID_Z]))
      const xs = q.map(p => ((p[0] + 1) / 2) * rect.width), ys = q.map(p => ((1 - p[1]) / 2) * rect.height)
      at = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    }
    const key = at ? `${Math.round(at.x)},${Math.round(at.y)},${Math.round(at.width)},${Math.round(at.height)}` : 'off'
    if (key === (backSent || 'off')) return
    backSent = key
    opts.onBack(at, backColors)
  }

  function paint(now) {
    raf = 0
    if (dead || gl.isContextLost()) return
    rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr)
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    gl.viewport(0, 0, cw, ch)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    let again = stepTilt(now)
    if (stepAnim(now)) again = true
    const v = anim ? anim.to : view
    const ready = v && W > 0
    const aspect = cw / ch
    let cam = { target: [0, 0, 0], dist: 4 }
    if (ready) {
      cam = fitOf(v)
      if (anim) cam = mixCam(anim.camFrom, cam, easeIO(anim.p))
      else if (camMove) {
        const t = Math.min(1, (now - camMove.t0) / camMove.dur)
        cam = mixCam(camMove.from, cam, easeIO(t))
        if (t >= 1) camMove = null; else again = true
      }
      camNow = cam
    }
    // La sombra de la hoja se calcula antes, porque cae también en la mesa.
    let castX = 0, castA = 0, cover = null, sheet = null
    if (ready && anim) {
      const e = anim.dragging ? anim.p : easeIO(anim.p)
      if (anim.kind === 'cover') {
        cover = { a: anim.opening ? e : 1 - e, under: anim.under }
        castX = Math.cos(cover.a * Math.PI) * cover.under * (W + BOOK.OVER)
        castA = Math.sin(cover.a * Math.PI) * 0.5
      } else {
        sheet = { a: e, side: anim.side }
        sheet.pts = sheetCurve(e, anim.side, W)
        castX = sheet.pts.at(-1).x
        castA = Math.sin(e * Math.PI) * 0.45
      }
    }
    // Una hoja en alto queda cerca de la cámara: durante el giro, esta se aleja y se pone más vertical para que quepa y no se vea torcida.
    const lift = cover ? Math.sin(cover.a * Math.PI) : sheet ? 0.35 * Math.sin(sheet.a * Math.PI) : 0
    if (lift) cam = { target: cam.target, dist: cam.dist * (1 + 0.3 * lift) }
    // Al rodear el libro, la cámara se aleja un poco para que el lado que se acerca no se salga de la pantalla.
    const round = Math.max(Math.abs(tiltNow.x), Math.abs(tiltNow.y))
    if (round) cam = { target: cam.target, dist: cam.dist * (1 + ORBIT_BACK * round) }
    const dTilt = ((-tiltNow.x * ORBIT_TILT - 9 * lift) * Math.PI) / 180, yaw = (-tiltNow.y * ORBIT_YAW * Math.PI) / 180
    const M = cameraMatrix(cam.target, cam.dist, aspect, TILT + dTilt, yaw)
    // Zoom del lector y el pequeño desplazamiento del movimiento: se aplican a la imagen final, que se vuelve a dibujar nítida.
    const s = zoom.s, ox = (2 * (zoom.x + tiltNow.y * 3)) / rect.width, oy = -(2 * (zoom.y + tiltNow.x * 3)) / rect.height
    for (let c = 0; c < 4; c++) {
      M[c * 4] = s * M[c * 4] + ox * M[c * 4 + 3]
      M[c * 4 + 1] = s * M[c * 4 + 1] + oy * M[c * 4 + 3]
    }
    gl.uniformMatrix4fv(u.uM, false, M)
    reportBack(M)
    gl.uniformMatrix3fv(u.uFx, false, [fxM[0][0], fxM[1][0], fxM[2][0], fxM[0][1], fxM[1][1], fxM[2][1], fxM[0][2], fxM[1][2], fxM[2][2]])
    gl.uniform3f(u.uFxO, fxM[0][3], fxM[1][3], fxM[2][3])
    gl.uniform2f(u.uCast, castX, castA)
    // Mesa
    gl.depthMask(true)
    gl.uniform1i(u.uKind, 0)
    gl.bindTexture(gl.TEXTURE_2D, tableTex || wood)
    if (tableTex) { const ts = tableScale(); gl.uniform3f(u.uTab, ts / tableAspect, ts, 1) } else gl.uniform3f(u.uTab, 0, 0, 0)
    gl.uniform4f(u.uRect, cam.target[0], cam.target[1], Math.max(W, 0.7) * 1.3, 1)
    drawMesh(tableMesh)
    if (!ready) { if (again) draw(); return }
    // Sombras en la mesa: una muy pegada une el libro con la madera, la otra cae a un lado y abajo.
    const O = BOOK.OVER
    let bx0 = -W - O, bx1 = W + O
    if (cover || v.kind === 'closed') {
      const under = cover ? cover.under : v.under, reach = cover ? landWidth(cover.a) : 0
      if (under > 0) { bx0 = -(W + O) * reach - BOOK.SPINE * (1 - reach); bx1 = W + O } else { bx0 = -W - O; bx1 = (W + O) * reach + BOOK.SPINE * (1 - reach) }
    }
    gl.enable(gl.BLEND)
    gl.depthMask(false)
    gl.disable(gl.DEPTH_TEST)
    gl.uniform1i(u.uKind, 1)
    for (const [dx, dy, soft, alpha] of [[-0.05, -0.062, 0.1, 0.5], [-0.02, -0.026, 0.04, 0.58], [-0.003, -0.004, 0.012, 0.75]]) {
      gl.uniform4f(u.uRect, bx0 + dx, -0.5 - O + dy, bx1 + dx, 0.5 + O + dy)
      gl.uniform1f(u.uSoft, soft)
      gl.uniform1f(u.uAlpha, alpha)
      drawMesh(tableMesh)
    }
    gl.disable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(true)
    // Libro
    if (cover) {
      // Durante la apertura, la mitad sobre la que aterriza se extiende justo debajo de la cubierta.
      const openV = anim.opening ? anim.to : anim.from, a = cover.a, o = smooth(0, 1, a)
      const width = landWidth(a), land = { k: smooth(0.97, 1, a), width }
      const sh = bookShapes(o, cover.under, land), m = {}
      for (const [n, q] of Object.entries(sh)) if (q) m[n] = dynMesh(`b_${n}`, q)
      const under = pageOn(openV, cover.under)
      const pages = { [cover.under]: under, [-cover.under]: { i: null } }
      drawBook(m, pages[-1], pages[1])
      const size = BOOK.SPINE * Math.max(0, 1 - a * 2.5)
      const lid = lidOf(anim.from.back || anim.to.back)
      if (size > 0) drawSpine(cover.under, LID_Z, size, lid)
      drawCover(cover.under, a, pageOn(openV, -cover.under), lid)
    } else if (sheet) {
      // La hoja lleva por delante la página vieja de su lado y por detrás la nueva del otro. Debajo ya se ve la nueva de su lado.
      const m = staticMeshes(v), s0 = sheet.side
      const pages = { [s0]: pageOn(anim.to, s0), [-s0]: pageOn(anim.from, -s0) }
      drawBook(m, pages[-1], pages[1])
      sheet.pts.forEach(p => { p.u = s0 > 0 ? p.t : 1 - p.t })
      gl.uniform2f(u.uCast, 0, 0)
      drawSheet(dynMesh('sheet', sheetShape(sheet.pts)), s0, pageOn(anim.from, s0), pageOn(anim.to, -s0))
    } else if (v.kind === 'closed') {
      drawBook(staticMeshes(v), null, null)
      const lid = lidOf(v.back)
      drawSpine(v.under, LID_Z, BOOK.SPINE, lid)
      drawCover(v.under, 0, { i: null }, lid)
    } else {
      drawBook(staticMeshes(v), pageOn(v, -1), pageOn(v, 1))
    }
    if (again) draw()
  }
  function draw() { if (!raf && !dead) raf = requestAnimationFrame(paint) }

  function startTurn(from, to, dir, drag) {
    const fwd = dir > 0, r = rtl()
    const ctl = { anims: [{ cancel() {} }], range: Math.max(200, rect.width * (from.focus || to.focus ? 0.9 : 0.5)) }
    const shut = from.kind === 'closed' ? from : to.kind === 'closed' ? to : null, cover = !!shut
    anim = {
      ctl, from, to, p: 0, goal: 0, back: false, dragging: !!drag, last: performance.now(), camFrom: camNow || fitOf(from),
      kind: cover ? 'cover' : 'sheet', dur: cover ? 1.3 : 0.75,
      opening: to.kind !== 'closed', under: shut?.under ?? (r ? -1 : 1),
      side: fwd === r ? -1 : 1, // lado del que sale la hoja: en der → izq, avanzar la levanta de la izquierda
    }
    ctl.cleanup = () => { if (anim?.ctl === ctl) finishAnim(!anim.back) }
    if (drag) {
      ctl.move = q => { if (anim?.ctl === ctl) { anim.goal = Math.max(0, Math.min(1, q)); draw() } }
      ctl.release = (commit, done) => {
        if (anim?.ctl !== ctl) return done?.(commit)
        anim.dragging = false
        anim.back = !commit
        anim.done = done
        anim.dur *= 0.7
        // Lo arrastrado ya es lineal: se pasa a la curva de la animación sin saltos.
        anim.p = inverseEase(anim.p)
        anim.last = performance.now()
        draw()
      }
    }
    return ctl
  }
  const inverseEase = y => (y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt((1 - y) / 2))

  const ro = new ResizeObserver(draw)
  ro.observe(container)
  function pan(x, y) {
    const bounds = container.getBoundingClientRect()
    const limitX = bounds.width * (zoom.s - 1) / 2, limitY = bounds.height * (zoom.s - 1) / 2
    zoom.x = Math.max(-limitX, Math.min(limitX, x))
    zoom.y = Math.max(-limitY, Math.min(limitY, y))
    draw()
  }
  const updateCursor = enableBookPan(canvas, () => zoom, pan)
  const onVis = () => { if (document.visibilityState === 'visible') { if (!still) tilt.permit() } else tilt.listen(false) }
  document.addEventListener('visibilitychange', onVis)
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault()
    glEpoch++
    if (anim) finishAnim(true)
    textures.clear(); loading.clear(); queue.length = 0; statics = null; staticKey = ''; backTex = null; tableTex = null
  })
  canvas.addEventListener('webglcontextrestored', () => {
    initGL()
    loadTable()
    want(0)
    if (view) for (const i of pagesOf(view)) want(i)
    draw()
  })
  initGL()
  loadTable()
  if (!still) tilt.permit()

  const api = {
    // Devuelve el control del giro si lo hay: el lector lo usa para el arrastre y para acabarlo antes de tiempo.
    show(group, dir = 0, drag = false) {
      if (!group.length) return null
      if (anim) finishAnim(!anim.back)
      const next = viewOf(group), first = group[0], last = group.at(-1)
      keepFrom = first - 3
      keepTo = last + 4
      pagesOf(next).forEach(want)
      want(0) // la portada da el color de la tapa y de la contraportada, aunque se empiece a mitad de capítulo
      if (!backNear && last + 4 >= total - 1) { backNear = true; clearTimeout(backTimer); backTimer = setTimeout(ensureBack, 1200) } // cuando acabe el giro
      for (let k = 1; k <= 3; k++) { want(last + k); want(first - k) }
      trim()
      const prev = view
      let ctl = null
      if (prev && dir && prev.key !== next.key && !(prev.kind === 'closed' && next.kind === 'closed') && W > 0) ctl = startTurn(prev, next, dir, drag)
      else if (prev && dir && prev.key === next.key && prev.focus !== next.focus && W > 0 && camNow) camMove = { from: camNow, t0: performance.now(), dur: 450 } // la otra cara de la misma pareja
      if (ctl) anim.to = next
      else view = next
      draw()
      return ctl
    },
    // Fin del capítulo: la tapa de atrás se cierra sobre las hojas. El libro queda boca abajo y con el lomo al otro lado.
    showBack(dir = 0, drag = false) {
      if (anim) finishAnim(!anim.back)
      want(0)
      backNear = true
      ensureBack()
      const next = { kind: 'closed', back: true, under: rtl() ? 1 : -1, focus: 0, key: 'e' }, prev = view
      const ctl = prev && dir && prev.kind !== 'closed' && W > 0 && textures.has(0) ? startTurn(prev, next, dir, drag) : null
      if (!ctl) view = next
      draw()
      return ctl
    },
    setZoom(s) {
      const ratio = s / zoom.s
      zoom.s = s
      pan(s === 1 ? 0 : zoom.x * ratio, s === 1 ? 0 : zoom.y * ratio)
      updateCursor()
    },
    setFilter(css) { fxM = filterMatrix(css); draw() },
    invalidate(i) {
      const t = textures.get(i)
      if (t) { gl.deleteTexture(t.tex); textures.delete(i) }
      want(i)
    },
    draw,
    // Para las pruebas.
    debug: () => ({ view: view?.key, focus: view?.focus, anim: anim && { kind: anim.kind, p: anim.p, side: anim.side, dragging: anim.dragging }, tilt: { ...tiltNow }, target: { ...tilt.target }, listening: tilt.listening, textures: [...textures.keys()], W, zoom: zoom.s, cam: camNow && { x: camNow.target[0], dist: camNow.dist } }),
    destroy() {
      dead = true
      cancelAnimationFrame(raf)
      clearTimeout(uploadTimer)
      clearTimeout(backTimer)
      ro.disconnect()
      tilt.stop()
      document.removeEventListener('visibilitychange', onVis)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    },
  }
  canvas.b3d = api // para las pruebas
  return api
}
