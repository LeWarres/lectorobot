// Estante 3D: un mueble de madera con los tomos de la biblioteca. Mira hacia +z, con y hacia arriba; se reciben las piezas comunes de book3d.js.
export const SHELF = { PITCH: 1.2, BOOK_H: 1, DEPTH: 0.82, FRONT: 0.74, FACE_W: 0.7, FACE_Z: 0.58, FACE_T: 0.09, GAP: 0.07, BOARD: 0.055, SIDE: 0.075 }

// ----- Arte del lomo -----
const hslOf = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return { sat: max ? (max - min) / max : 0, val: max / 255, chroma: (max - min) / 255 }
}
/** Lo a color que es una imagen: la parte de sus píxeles con color de verdad. El blanco, el negro y los grises no cuentan. */
export function colorfulness(data) {
  let colored = 0, n = 0
  for (let p = 0; p < data.length; p += 4) {
    n++
    if (hslOf(data[p], data[p + 1], data[p + 2]).chroma > 0.16) colored++
  }
  return n ? colored / n : 0
}
export const COLOR_PAGE = 0.25
/** La columna más vistosa de una imagen, para el lomo: mucho color y detalle, sin los bordes, donde suele haber marcos. Devuelve su x izquierda. */
export function bestColumn(data, w, h, colW, from = 0) {
  const cols = new Float64Array(w), detail = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    let last = 0
    for (let y = from; y < h; y++) {
      const p = (y * w + x) * 4, { chroma } = hslOf(data[p], data[p + 1], data[p + 2]), lum = (data[p] * 0.3 + data[p + 1] * 0.59 + data[p + 2] * 0.11) / 255
      cols[x] += chroma
      if (y > from) detail[x] += Math.min(0.25, Math.abs(lum - last))
      last = lum
    }
  }
  const lo = Math.round(w * 0.06), hi = Math.max(lo, Math.round(w * 0.94) - colW)
  let best = lo, bestScore = -1
  for (let x = lo; x <= hi; x++) {
    let score = 0
    for (let k = x; k < x + colW && k < w; k++) score += cols[k] + detail[k] * 0.8
    if (score > bestScore) { bestScore = score; best = x }
  }
  return best
}

const FACE_LOGO_Y = 0.24, FACE_LOGO_W = 0.26
const FACE_MIN = 0.14 // Los rostros más pequeños, respecto al ancho de la portada, casi siempre son errores o figuras lejanas.

/** El rostro para el lomo: el mayor entre los de tamaño suficiente. Devuelve [x, y, ancho, alto] en fracciones de la imagen, o 0. */
export function chooseFace(faces, w, h) {
  // Pequeño y en lo alto de la portada suele ser el logo: la calavera de One Piece tiene cara de rostro.
  const big = (faces || []).filter(f => f.w >= w * FACE_MIN && !(f.y + f.h / 2 < h * FACE_LOGO_Y && f.w < w * FACE_LOGO_W))
  if (!big.length) return 0
  const f = big.reduce((a, b) => (b.w > a.w ? b : a))
  return [f.x / w, f.y / h, f.w / w, f.h / h].map(v => Math.round(v * 1000) / 1000)
}
/** La franja alrededor de un rostro, como en los lomos de verdad: algo de pelo arriba y la cara debajo. Todo en píxeles de la imagen. */
export function faceStrip(face, w, h) {
  const fx = face[0] * w, fy = face[1] * h, fw = face[2] * w, fh = face[3] * h
  const visible = 1 / ART_RATIO, sw = Math.min(fw * 1.3, h / visible, w) // visible: alto que se ve, en anchos de franja
  return {
    sx: Math.max(0, Math.min(w - sw, fx + fw / 2 - sw / 2)),
    sy: Math.max(0, Math.min(h - sw * visible, fy - fh * 0.4)),
    sw,
  }
}

// Medidas de un tomo, en altos de un B6 (18,2 cm). El grosor sale de las páginas, como en papel: unos 0,07 mm por página más las tapas.
// Sin páginas contadas se estiman por capítulos. Con tope, para que un tomo enorme no parezca un ladrillo.
export const SPINE_MIN = 0.06, SPINE_MAX = 0.1
export const spineWidth = (pages, chapters) => {
  const p = pages > 0 ? pages : chapters ? chapters * 19 : 180
  return Math.max(SPINE_MIN, Math.min(SPINE_MAX, (2 + p * 0.07) / 182))
}
// Alto y fondo de una colección, según la proporción de sus portadas: la de bolsillo de las revistas shōnen (11,2 × 17,6 cm)
// es más estrecha que la B6 de las seinen (12,8 × 18,2 cm). Todos los tomos de una obra miden lo mismo; solo cambia el grosor.
export function bookSize(aspect) {
  const a = Math.max(0.6, Math.min(0.76, aspect || 0.703)), mm = a < 0.655 ? 176 : 182
  return { h: mm / 182, d: (SHELF.FACE_W * mm * a) / 128 }
}

/** El tomo que se muestra de frente: por el que se va o, si no se ha empezado, el primero. */
export function faceIndex(vols, chapterId) {
  const i = vols.findIndex(v => (v.chapters || []).includes(chapterId))
  return i < 0 ? 0 : i
}

/** Reparte las obras en filas de un ancho dado. Una obra sin tomos conocidos es un solo libro, de frente. */
export function layoutShelf(works, rowWidth, sizeOf = () => bookSize()) {
  const rows = [[]]
  let x = 0
  const place = (item, w) => {
    if (x + w > rowWidth && rows.at(-1).length) { rows.push([]); x = 0 }
    rows.at(-1).push({ ...item, x, w })
    x += w
  }
  for (const work of works) {
    if (rows.at(-1).length) x += SHELF.GAP
    const vols = work.vols?.length ? work.vols : [{ vol: null, chapters: [], thumb: work.cover }]
    const face = faceIndex(vols, work.chapterId), { h, d } = sizeOf(work)
    vols.forEach((vol, i) => {
      const isFace = i === face, t = spineWidth(vol.pages, vol.chapters?.length)
      place({ work, vol, face: isFace, h, d, t }, isFace ? d : t)
    })
  }
  return rows.filter(r => r.length)
}

const VS = `#version 300 es
uniform mat4 uM, uModel; // uModel: solo el tomo que se saca; lo demás ya está en el mueble
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUV;
out vec3 vPos; out vec3 vNor; out vec2 vUV;
void main() { vec4 p = uModel * vec4(aPos, 1.0); vPos = p.xyz; vNor = mat3(uModel) * aNor; vUV = aUV; gl_Position = uM * p; }`
const FS = `#version 300 es
precision highp float;
uniform int uKind;
uniform sampler2D uTex;
uniform vec3 uColor;
uniform float uHas, uPitch, uDepth, uDim, uAlpha, uManage;
uniform vec4 uSpot; // mesa: centro del tomo y radio de la luz
uniform vec2 uTab; // mesa propia: escala de la foto; sin ella, madera repetida
uniform vec2 uSize;
uniform vec4 uHide; // x0, x1, y0, y1 del hueco del tomo sacado: ni él ni sus costados se pintan en la fila
in vec3 vPos; in vec3 vNor; in vec2 vUV;
out vec4 color;
const vec3 L = normalize(vec3(-0.22, 0.42, 0.88));
void main() {
  if (uKind != 0 && uHide.y > uHide.x && vPos.y > uHide.z && vPos.y < uHide.w) {
    const float e = 0.0002;
    bool inside = vPos.x > uHide.x + e && vPos.x < uHide.y - e;
    bool own = (abs(vPos.x - uHide.x) <= e && vNor.x < -0.5) || (abs(vPos.x - uHide.y) <= e && vNor.x > 0.5);
    if (inside || own) discard; // los costados de los vecinos sí quedan a la vista
  }
  vec3 c;
  if (uKind == 0) c = texture(uTex, vUV, -0.4).rgb * vec3(0.92, 0.84, 0.76); // madera del mueble, algo más oscura que la mesa
  else if (uKind == 1) c = texture(uTex, vUV).rgb; // lomos
  else if (uKind == 2) c = uHas > 0.5 ? texture(uTex, vUV, -0.5).rgb : uColor; // portada
  else if (uKind == 3 || uKind == 5) { // las hojas, vistas por arriba: rayas irregulares a lo ancho del tomo, medidas en el mueble
    float a = uKind == 3 ? vUV.x : vUV.y, v = a / 0.0042, w = fwidth(v), k = floor(v);
    float n = fract(sin(k * 12.9898) * 43758.5453);
    float line = 1.0 - smoothstep(0.08, 0.08 + max(w, 0.25), abs(fract(v) - 0.5));
    float dense = 1.0 - smoothstep(0.45, 0.9, w); // muy lejos, las rayas se funden en un tono
    c = vec3(0.91, 0.88, 0.81) * (1.0 - (0.1 + 0.05 * n) * dense) * (1.0 - line * (0.16 + 0.22 * n) * dense);
    // Entre un tomo y otro queda una rendija oscura.
    if (uKind == 3) c *= mix(0.45, 1.0, smoothstep(0.0, 0.0035, min(vUV.x, vUV.y - vUV.x)));
  } else if (uKind == 6) { // la mesa del lector, que aparece detrás del tomo
    vec3 t = uHas > 0.5 ? texture(uTex, clamp(vUV * uTab + 0.5, 0.0, 1.0)).rgb : texture(uTex, vUV / 1.7).rgb;
    float d = length(vPos - uSpot.xyz) / uSpot.w;
    color = vec4(t * mix(1.04, 0.42, smoothstep(0.35, 1.6, d)), uAlpha);
    return;
  } else c = uColor; // tapas, de canto
  if (uManage > 0.5 && uKind > 0 && uKind < 6) c = mix(c, vec3(0.85, 0.08, 0.08), 0.68);
  float lit = mix(0.62, 1.05, clamp(dot(normalize(vNor), L), 0.0, 1.0));
  // Lo del fondo y lo que queda bajo la balda de arriba recibe menos luz.
  float z = clamp(vPos.z / uDepth, 0.0, 1.0);
  float under = fract(vPos.y / uPitch);
  float shade = mix(0.5, 1.0, smoothstep(0.0, 0.95, z)) * mix(mix(0.5, 1.0, z), 1.0, smoothstep(0.62, 0.98, 1.0 - under));
  vec2 q = gl_FragCoord.xy / uSize - 0.5;
  float room = 1.0 - 0.34 * smoothstep(0.25, 0.8, length(q * vec2(1.0, 0.8)));
  color = vec4(c * lit * shade * room * uDim * vec3(1.03, 1.0, 0.95), uAlpha);
}`

// Un cuadrilátero: origen, dos lados, normal y coordenadas de textura en sus esquinas.
function quad(sh, o, a, b, n, uv = [0, 0, 1, 1]) {
  sh.grid(1, 1, (c, r) => [o[0] + a[0] * c + b[0] * r, o[1] + a[1] * c + b[1] * r, o[2] + a[2] * c + b[2] * r, ...n, uv[0] + (uv[2] - uv[0]) * c, uv[1] + (uv[3] - uv[1]) * r])
}
const hash = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) }
const hsl = (h, s, l) => { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }; return [f(0), f(8), f(4)] }

const STORE = 'shelfPalette'
// Lo que cuesta sacar se guarda en el dispositivo (Cache Storage, se conserva al actualizar la app): el arte recortado
// de cada lomo, y las portadas de frente y los logos tal cual. La siguiente visita no espera a la red, y sin
// conexión el mueble se ve igual.
const KEEP = 'shelf-v1'
let keepBox = null
const keeper = () => (keepBox ||= typeof caches !== 'undefined' && globalThis.isSecureContext !== false ? caches.open(KEEP).catch(() => null) : Promise.resolve(null))
const keptKey = (kind, url) => `/__shelf/${kind}?u=${encodeURIComponent(url)}`
export const keptBlob = (kind, url) => keeper().then(c => c?.match(keptKey(kind, url))).then(r => (r ? r.blob() : null)).catch(() => null)
export const keepBlob = (kind, url, blob) => keeper().then(c => c?.put(keptKey(kind, url), new Response(blob, { headers: { 'content-type': blob.type || 'image/jpeg' } }))).catch(() => {})
const STRIP_PER_UNIT = 440, STRIP_MAX = 2048, STRIP_H = 512, IMG_AT_ONCE = 4 // ancho de la tira según el de la fila; más de 2048 no se nota y gasta memoria
const blurBox = typeof document === 'undefined' ? null : document.createElement('canvas') // de paso, para desenfocar bajo las letras
const ART_SKIP = 0.26, FACE_INPUT = 360 // sin rostro se salta lo alto de la portada; ancho con que se buscan los rostros
const ART_RATIO = 0.14, ART_H = 512, ART_KEEP = 240 // franja guardada: algo más ancha que el lomo más grueso
// Notas adhesivas con el nombre de cada colección: fuentes manuscritas propias (fonts/LICENSE.txt) y colores de pósit.
const NOTE_FONTS = [['Caveat', 'caveat', 600, 1.15], ['Patrick Hand', 'patrickhand', 400, 1], ['Kalam', 'kalam', 700, 0.95], ['Gochi Hand', 'gochihand', 400, 1], ['Indie Flower', 'indieflower', 400, 0.95], ['Permanent Marker', 'permanentmarker', 400, 0.85], ['Shadows Into Light', 'shadows', 400, 1.05]]
const NOTE_COLORS = ['#fff27a', '#ffb8cf', '#a9dcff', '#c4f2a8', '#ffd38f', '#e3c8ff']
const NOTE_INKS = ['#24242e', '#1b2b6e', '#3a1f5c', '#123c2c']
const NOTE_H = 0.13, NOTE_PX = 128
// El nombre de la nota: como mucho 40 letras, cortando entre palabras.
export function shortTitle(title, max = 40) {
  const t = String(title || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max), sp = cut.lastIndexOf(' ')
  return `${(sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·–—-]+$/, '')}…`
}
// Aspecto de la nota de una obra: el mismo en el mueble y en la ficha del tomo sacado.
export function noteStyle(id) {
  const seed = hash(id), [family, , weight, scale] = NOTE_FONTS[seed % NOTE_FONTS.length]
  return { seed, family: `shelf ${family}`, weight, scale, paper: NOTE_COLORS[(seed >> 3) % NOTE_COLORS.length], ink: NOTE_INKS[(seed >> 6) % NOTE_INKS.length], tilt: ((seed % 97) / 96 - 0.5) * 0.1 }
}
let notesFonts = null
export function loadNoteFonts() {
  if (notesFonts || typeof FontFace === 'undefined') return notesFonts || Promise.resolve()
  notesFonts = Promise.all(NOTE_FONTS.map(([name, file, weight]) => new FontFace(`shelf ${name}`, `url(/fonts/${file}.woff2)`, { weight: String(weight) }).load().then(f => { document.fonts.add(f) }, () => {})))
  return notesFonts
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const FLY_MS = 900
const PEEK_OPEN_MS = 720, PEEK_CLOSE_MS = 520, PEEK_SLIDE = 0.34 // el tomo sale recto de la fila y luego gira hacia la cámara
const ZOOM_MAX = 3, ORBIT_TILT = 10, ORBIT_YAW = 18, ORBIT_BACK = 0.08, REST_TILT = -3, FRICTION_MS = 320

export function createShelf3D(container, lib, { works: firstWorks = [], rowsLandscape = 2.3, rowsPortrait = 3, still = false, pagesOf = null, onPeek = null, onOpen = null, onManage = null, table = null } = {}) {
  const { Shape, woodCanvas, cameraMatrix, project, FOV, coverPalette, inkOn, css, createTilt, MAX_DEG } = lib
  const canvas = document.createElement('canvas')
  canvas.className = 'shelfcanvas'
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, powerPreference: 'high-performance' })
  if (!gl) return null
  container.replaceChildren(canvas)
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048

  let dead = false, raf = 0, u = {}, prog = null, wood = null, furniture = null, works = firstWorks, aniso = null, managing = false
  let rows = [], rowWidth = 3, size = { w: 1, h: 1 }, visibleH = 2.8, top = 0, bottom = 0, y = 0, layoutTimer = 0, rowsKey = ''
  const built = new Map(), covers = new Map(), loadingImg = new Map(), waiting = []
  const arts = new Map(), panels = new Map(), askedPanel = new Set() // arte de los lomos, y página a color de los tomos sin portada
  let toTopNext = false
  let x = 0, zoom = 1, velocity = 0, lastMove = 0, focusId = null // focusId: obra que se mantiene a la vista hasta que se toque el mueble
  const tiltNow = { x: 0, y: 0 }
  const tilt = createTilt(() => draw())
  let imgBusy = 0
  let palettes = {}
  try { palettes = JSON.parse(localStorage.getItem(STORE) || '{}') } catch {}
  let saveTimer = 0
  const savePalettes = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(palettes)) } catch {} }, 800)
  }

  function makeMesh(sh) {
    const vao = gl.createVertexArray(), vb = gl.createBuffer(), ib = gl.createBuffer()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sh.v), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sh.i), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24)
    gl.bindVertexArray(null)
    return { vao, vb, ib, n: sh.i.length }
  }
  const freeMesh = m => { if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib) } }
  const drawMesh = m => { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0) }
  function texFrom(source, tex = gl.createTexture()) {
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

  function initGL() {
    const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s }
    prog = gl.createProgram()
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'shader')
    gl.useProgram(prog)
    u = {}
    for (const n of ['uM', 'uModel', 'uKind', 'uTex', 'uColor', 'uHas', 'uPitch', 'uDepth', 'uSize', 'uDim', 'uHide', 'uAlpha', 'uSpot', 'uTab', 'uManage']) u[n] = gl.getUniformLocation(prog, n)
    gl.uniform1i(u.uTex, 0)
    gl.uniformMatrix4fv(u.uModel, false, IDENTITY)
    gl.uniform1f(u.uDim, 1)
    gl.uniform1f(u.uAlpha, 1)
    gl.uniform4f(u.uHide, 0, 0, 0, 0)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniform1f(u.uPitch, SHELF.PITCH)
    gl.uniform1f(u.uDepth, SHELF.DEPTH)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.CULL_FACE) // las mallas no siguen un solo sentido de giro
    gl.clearColor(0.09, 0.055, 0.035, 1)
    aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    wood = texFrom(woodCanvas())
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  }

  // ----- Colocación -----
  const rowBase = k => -(k + 1) * SHELF.PITCH // la cara de arriba de la balda de esa fila
  function buildFurniture() {
    freeMesh(furniture)
    const sh = new Shape(), { BOARD, SIDE, DEPTH } = SHELF, W = rowWidth, low = rowBase(Math.max(rows.length, 1) - 1) - BOARD, TILE = 1.7
    // Fondo.
    quad(sh, [-SIDE, low, 0], [W + 2 * SIDE, 0, 0], [0, -low + BOARD, 0], [0, 0, 1], [0, low / TILE, (W + 2 * SIDE) / TILE, BOARD / TILE])
    // Laterales, por dentro y de canto.
    for (const [x, n] of [[0, 1], [W, -1]]) quad(sh, [x, low, 0], [0, 0, DEPTH], [0, -low + BOARD, 0], [n, 0, 0], [0.2, low / TILE, 0.2 + DEPTH / TILE, BOARD / TILE])
    for (const x of [-SIDE, W]) quad(sh, [x, low, DEPTH], [SIDE, 0, 0], [0, -low + BOARD, 0], [0, 0, 1], [x, low / TILE, x + SIDE / TILE, BOARD / TILE])
    // Baldas, con la veta a lo largo.
    const board = yTop => {
      const uv = (a, b) => [yTop * 0.37, a / TILE, yTop * 0.37 + b / TILE, 0]
      quad(sh, [W, yTop, 0], [-W, 0, 0], [0, 0, DEPTH], [0, 1, 0], [yTop * 0.37, 0, yTop * 0.37 + DEPTH / TILE, W / TILE])
      quad(sh, [0, yTop - BOARD, DEPTH], [W, 0, 0], [0, BOARD, 0], [0, 0, 1], uv(W, 0))
      quad(sh, [0, yTop - BOARD, 0], [W, 0, 0], [0, 0, DEPTH], [0, -1, 0], [yTop * 0.37, 0, yTop * 0.37 + DEPTH / TILE, W / TILE])
    }
    for (let k = 0; k < Math.max(rows.length, 1); k++) board(rowBase(k))
    // Tapa de arriba.
    quad(sh, [-SIDE, 0, DEPTH], [W + 2 * SIDE, 0, 0], [0, BOARD, 0], [0, 0, 1], [0, 0, W / TILE, 0.04])
    quad(sh, [-SIDE, BOARD, 0], [W + 2 * SIDE, 0, 0], [0, 0, DEPTH], [0, 1, 0], [0, 0, W / TILE, DEPTH / TILE])
    quad(sh, [0, 0, 0], [W, 0, 0], [0, 0, DEPTH], [0, -1, 0], [0, 0, W / TILE, DEPTH / TILE])
    furniture = makeMesh(sh)
  }
  const urlOf = item => item.vol.art || item.vol.thumb || item.work.cover || null
  const panelKey = item => item.vol.chapters?.[0] || null
  // De dónde sale el arte de este lomo: su portada, una página a color o, en último caso, la portada de la obra.
  const artOf = item => item.vol.art || item.vol.thumb || panels.get(panelKey(item)) || item.work.cover || null
  const fallbackPalette = item => {
    const h = hash(item.work.id) % 360, base = hsl(h, 0.42, 0.34)
    return { base, accent: hsl((h + 40) % 360, 0.55, 0.72) }
  }
  const paletteOf = item => palettes[artOf(item)] || fallbackPalette(item)
  // Una obra sin portada: su color y su título.
  function plainCover(item) {
    const c = Object.assign(document.createElement('canvas'), { width: 358, height: 512 }), g = c.getContext('2d'), { base, accent } = paletteOf(item)
    g.fillStyle = css(base)
    g.fillRect(0, 0, c.width, c.height)
    g.strokeStyle = css(accent)
    g.lineWidth = 5
    g.strokeRect(22, 22, c.width - 44, c.height - 44)
    g.fillStyle = css(inkOn(base))
    g.textAlign = 'center'
    g.font = '700 34px system-ui, sans-serif'
    const lines = []
    for (const word of String(item.work.title).split(/\s+/)) {
      const last = lines.at(-1)
      if (last != null && g.measureText(`${last} ${word}`).width <= c.width - 80) lines[lines.length - 1] = `${last} ${word}`
      else lines.push(word)
    }
    const shown = lines.slice(0, 8)
    shown.forEach((line, i) => g.fillText(line, c.width / 2, c.height / 2 + (i - (shown.length - 1) / 2) * 42 + 12, c.width - 70))
    return c
  }
  const coverKey = item => urlOf(item) || `plain:${item.work.id}`
  const plainFor = key => item => { if (!covers.has(key)) { covers.set(key, texFrom(plainCover(item))); draw() } }
  // keep: la imagen se guarda en el dispositivo (portadas de frente y logos) y de ahí sale la próxima vez.
  const keepUrls = new Set()
  function loadImage(url, done, keep = false) {
    if (keep && url.startsWith('/')) keepUrls.add(url)
    if (loadingImg.has(url)) { loadingImg.get(url).push(done); return }
    loadingImg.set(url, [done])
    waiting.push(url)
    pumpImages()
  }
  async function keptSrc(url) {
    const hit = await keptBlob('img', url)
    if (hit) return URL.createObjectURL(hit)
    const r = await fetch(url, { credentials: 'same-origin' }).catch(() => null)
    if (!r?.ok || !/^image\//.test(r.headers.get('content-type') || '')) return null
    const blob = await r.blob()
    keepBlob('img', url, blob)
    return URL.createObjectURL(blob)
  }
  function pumpImages() {
    while (!dead && imgBusy < IMG_AT_ONCE && waiting.length) {
      const url = waiting.pop() // lo último pedido es lo que está a la vista
      imgBusy++
      const im = new Image()
      im.decoding = 'async'
      // Una imagen que no acaba (una fuente colgada) no puede tapar la cola: a los 15 s deja su hueco, y si llega luego se usa igual.
      let freed = false
      const free = () => { if (!freed) { freed = true; imgBusy--; clearTimeout(slow); pumpImages() } }
      const slow = setTimeout(free, 15000)
      const finish = ok => {
        const list = loadingImg.get(url) || []
        loadingImg.delete(url)
        if (!dead) for (const f of list) f(ok ? im : null)
        free()
      }
      if (!keepUrls.has(url)) {
        im.onload = () => finish(true)
        im.onerror = () => finish(false)
        im.src = url
        continue
      }
      keptSrc(url).catch(() => null).then(src => {
        im.onload = () => { if (src) URL.revokeObjectURL(src); finish(true) }
        im.onerror = () => {
          if (src) { URL.revokeObjectURL(src); src = null; im.src = url; return } // lo guardado no sirve: de la red
          finish(false)
        }
        im.src = src || url
      })
    }
  }
  // Alto y fondo de cada obra, por la proporción de su portada. Lo aprendido rehace el mueble una vez; luego se recuerda.
  const sizeOf = work => bookSize(palettes[`size:${work.id}`])
  function learnSize(item, url, im) {
    const work = item.work
    const key = `size:${work.id}`
    if (palettes[key] || !im?.naturalHeight || !url || url !== (item.vol.art || item.vol.thumb || work.cover)) return // solo portadas, no páginas
    const before = sizeOf(work)
    palettes[key] = Math.round((im.naturalWidth / im.naturalHeight) * 1000) / 1000
    savePalettes()
    const now = sizeOf(work)
    if (now.h !== before.h || Math.abs(now.d - before.d) > 0.004) api.relayout()
  }
  function learnPalette(url, im) {
    if (palettes[url]) return
    try {
      const small = Object.assign(document.createElement('canvas'), { width: 48, height: 72 }), g = small.getContext('2d', { willReadFrequently: true })
      g.drawImage(im, 0, 0, 48, 72)
      const { base, accent } = coverPalette(g.getImageData(0, 0, 48, 72).data)
      palettes[url] = { base, accent }
      savePalettes()
    } catch {}
  }

  // Rostros: de uno en uno y lo último pedido primero. Lo encontrado se recuerda, y también lo no encontrado.
  const faceWaiting = []
  let faceWorker = null, faceBusy = false, faceSeq = 0
  function askFace(url) {
    if (faceWaiting.some(q => q === url)) return
    faceWaiting.push(url)
    pumpFaces()
  }
  function startFaceWorker() {
    try {
      faceWorker = new Worker(new URL('./animeface.js', import.meta.url))
      faceWorker.onerror = () => { faceWorker?.terminate(); faceWorker = false; faceBusy = false; faceWaiting.length = 0 }
    } catch { faceWorker = false }
    return faceWorker
  }
  function pumpFaces() {
    if (dead || faceBusy || !faceWaiting.length || faceWorker === false || (!faceWorker && !startFaceWorker())) return
    const url = faceWaiting.pop()
    if (palettes[`face:${url}`] !== undefined) return pumpFaces()
    faceBusy = true
    let given = false
    const giveUp = setTimeout(() => { given = true; faceBusy = false; pumpFaces() }, 30000) // la imagen no llega: se sigue con las demás
    loadImage(url, im => {
      clearTimeout(giveUp)
      if (given) return
      let pixels = null, w = FACE_INPUT, h = 0
      if (im) try {
        h = Math.max(1, Math.round((w * im.naturalHeight) / im.naturalWidth))
        const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(im, 0, 0, w, h)
        pixels = g.getImageData(0, 0, w, h).data.buffer
      } catch { pixels = null }
      if (!pixels || !faceWorker) { faceBusy = false; return pumpFaces() }
      const id = ++faceSeq
      faceWorker.onmessage = ({ data }) => {
        if (data.id !== id) return
        faceBusy = false
        if (dead) return
        if (data.faces) {
          const face = chooseFace(data.faces, w, h)
          palettes[`face:${url}`] = face
          savePalettes()
          if (face) {
            cropArt(url, im, face)
            // La fila pudo rehacerse mientras tanto: se avisa a las que hay ahora.
            for (const b of built.values()) if (rows[b.k]?.some(it => !it.face && artOf(it) === url)) b.repaint?.()
          }
        }
        pumpFaces()
      }
      faceWorker.postMessage({ id, pixels, w, h }, [pixels])
    })
  }
  function learnArt(url, im, wantFace) {
    if (!arts.has(url)) cropArt(url, im, palettes[`face:${url}`] || null)
    if (wantFace && palettes[`face:${url}`] === undefined) askFace(url)
  }
  function cropArt(url, im, face) {
    try {
      const w = im.naturalWidth, h = im.naturalHeight
      const small = Object.assign(document.createElement('canvas'), { width: 64, height: Math.max(1, Math.round((64 * h) / w)) }), g = small.getContext('2d', { willReadFrequently: true })
      g.drawImage(im, 0, 0, small.width, small.height)
      const colW = Math.max(2, Math.round(small.height * ART_RATIO))
      const out = Object.assign(document.createElement('canvas'), { width: Math.round(ART_H * ART_RATIO), height: ART_H })
      if (face) {
        const { sx, sy, sw } = faceStrip(face, w, h)
        out.getContext('2d').drawImage(im, sx, sy, sw, sw / ART_RATIO, 0, 0, out.width, out.height)
      } else {
        // Sin rostro: de la banda de en medio hacia abajo, porque arriba suelen ir el logo y la editorial.
        const keep = 1 - ART_SKIP, from = Math.round(small.height * ART_SKIP), cw = Math.max(2, Math.round(colW * keep))
        const at = bestColumn(g.getImageData(0, 0, small.width, small.height).data, small.width, small.height, Math.min(cw, small.width), from)
        out.getContext('2d').drawImage(im, (at / small.width) * w, h * ART_SKIP, h * ART_RATIO * keep, h * keep, 0, 0, out.width, out.height)
      }
      putArt(url, out)
      out.toBlob?.(b => { if (b) keepBlob('art', url, b) }, 'image/jpeg', 0.88)
    } catch {}
  }
  function putArt(url, art) {
    arts.delete(url)
    arts.set(url, art)
    if (arts.size > ART_KEEP) { const old = arts.keys().next().value; arts.get(old)?.close?.(); arts.delete(old) } // se vuelve a sacar del dispositivo si hace falta
  }
  // El arte ya recortado en otra visita. Solo vale si también se recuerda su color (localStorage); si no, se rehace.
  const artAsked = new Set()
  function keptArt(url, done) {
    if (artAsked.has(url)) return
    artAsked.add(url)
    const miss = () => { artAsked.delete(url); done(false) }
    if (!palettes[url]) return miss()
    keptBlob('art', url).then(async b => {
      if (dead) return
      if (!b) return miss()
      let art = null
      try { art = typeof createImageBitmap === 'function' ? await createImageBitmap(b) : null } catch {}
      if (!art) {
        art = await new Promise(res => { const im = new Image(), src = URL.createObjectURL(b); im.onload = () => { URL.revokeObjectURL(src); res(im) }; im.onerror = () => { URL.revokeObjectURL(src); res(null) }; im.src = src })
      }
      artAsked.delete(url)
      if (dead) return
      if (!art) return done(false)
      putArt(url, art)
      done(true)
    })
  }
  // Tomo sin portada: la primera de sus páginas que sea a color. Lo encontrado se recuerda; lo no encontrado, también, para no volver a descargar páginas.
  function findPanel(item, done) {
    const key = panelKey(item)
    if (!key || !pagesOf || askedPanel.has(key)) return
    askedPanel.add(key)
    const saved = palettes[`panel:${key}`]
    if (saved !== undefined) { if (saved) { panels.set(key, saved); done() } return }
    pagesOf(key).then(async urls => {
      let found = null
      for (const url of urls) {
        const im = await new Promise(res => loadImage(url, res))
        if (dead) return
        if (!im) continue
        try {
          const c = Object.assign(document.createElement('canvas'), { width: 40, height: 60 }), g = c.getContext('2d', { willReadFrequently: true })
          g.drawImage(im, 0, 0, 40, 60)
          if (colorfulness(g.getImageData(0, 0, 40, 60).data) >= COLOR_PAGE) { found = url; break }
        } catch {}
      }
      palettes[`panel:${key}`] = found || false
      savePalettes()
      if (found) { panels.set(key, found); done() }
    }, () => {})
  }
  // Los lomos de una fila se dibujan juntos en una tira: una textura por fila, por muchos tomos que tenga.
  const stripWidth = () => Math.max(512, Math.min(STRIP_MAX, maxTex, Math.round(rowWidth * STRIP_PER_UNIT)))
  // ----- Logos de las obras (Wikimedia Commons, por el proxy propio para poder pintarlos en la tira) -----
  const logos = new Map()
  function logoLight(im) {
    try {
      const c = Object.assign(document.createElement('canvas'), { width: 96, height: Math.max(1, Math.round((96 * im.naturalHeight) / im.naturalWidth)) }), g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(im, 0, 0, c.width, c.height)
      const px = g.getImageData(0, 0, c.width, c.height).data
      let lum = 0, a = 0
      for (let p = 0; p < px.length; p += 4) { const al = px[p + 3] / 255; lum += al * (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114); a += al }
      return a ? lum / a / 255 : 0.5
    } catch { return 0.5 }
  }
  function setLogo(id, url) {
    if (!url || logos.has(id)) return
    loadImage(url, im => {
      if (!im || dead || im.naturalWidth < im.naturalHeight * 1.2) return
      logos.set(id, { im, light: logoLight(im) })
      for (const b of built.values()) if ((rows[b.k] || []).some(i => i.work.id === id)) b.repaint?.()
    }, true)
  }

  // ----- Notas: un pósit por colección, pegado al canto de la balda de arriba -----
  function rowNotes(row) {
    const groups = []
    for (let i = 0; i < row.length;) {
      let j = i
      while (j + 1 < row.length && row[j + 1].work === row[i].work) j++
      groups.push({ work: row[i].work, x0: row[i].x, x1: row[j].x + row[j].w })
      i = j + 1
    }
    const out = []
    let free = 0.02
    for (const n of groups) {
      const span = n.x1 - n.x0, w = Math.max(0.26, Math.min(0.42, span * 0.85))
      let x = Math.max(free, n.x0 + Math.min(0.03, span * 0.1))
      if (x + w > rowWidth - 0.02) x = rowWidth - 0.02 - w
      if (x < free - 1e-6 || x > n.x1 + 0.12) continue // no cabe junto a los suyos
      out.push({ ...n, x, w, seed: hash(n.work.id) })
      free = x + w + 0.03
    }
    return out
  }
  function paintNotes(notes, canvas) {
    const g = canvas.getContext('2d')
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    let x = 0
    for (const n of notes) {
      const W = n.px, H = NOTE_PX, { family, weight, scale, paper, ink } = noteStyle(n.work.id)
      g.save()
      g.translate(x, 0)
      g.fillStyle = paper
      g.fillRect(0, 0, W, H)
      g.fillStyle = 'rgba(0,0,0,.07)' // la franja con pegamento
      g.fillRect(0, 0, W, H * 0.16)
      const curl = g.createLinearGradient(0, H * 0.7, 0, H)
      curl.addColorStop(0, 'rgba(0,0,0,0)')
      curl.addColorStop(1, 'rgba(0,0,0,.14)')
      g.fillStyle = curl
      g.fillRect(0, 0, W, H)
      g.fillStyle = ink
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const title = shortTitle(n.work.title), font = px => `${weight} ${Math.round(px)}px "${family}", cursive`
      let size = H * 0.5 * scale
      g.font = font(size)
      const room = W * 0.9
      if (g.measureText(title).width > room) size = Math.max(H * 0.3 * scale, (size * room) / g.measureText(title).width)
      g.font = font(size)
      if (g.measureText(title).width > room) {
        // Dos renglones, partiendo por el espacio más cercano al centro.
        const words = title.split(/\s+/)
        let best = 1, bestD = Infinity
        for (let i = 1; i < words.length; i++) { const d = Math.abs(words.slice(0, i).join(' ').length - title.length / 2); if (d < bestD) { bestD = d; best = i } }
        const a = words.slice(0, best).join(' '), b = words.slice(best).join(' ')
        size = Math.min(H * 0.36 * scale, (size * room) / Math.max(g.measureText(a).width, g.measureText(b).width, 1) * 1)
        g.font = font(size)
        g.fillText(a, W / 2, H * 0.4, room)
        g.fillText(b, W / 2, H * 0.4 + size * 0.95, room)
      } else g.fillText(title, W / 2, H * 0.56, room)
      g.restore()
      x += W
    }
  }
  function buildNotes(b, k) {
    const notes = rowNotes(rows[k])
    if (!notes.length) return
    const base = rowBase(k), edge = k === 0 ? base + SHELF.PITCH : base + SHELF.PITCH - SHELF.BOARD, top = edge + SHELF.BOARD * 0.75, z = SHELF.DEPTH + 0.004
    for (const n of notes) n.px = Math.round((NOTE_PX * n.w) / NOTE_H)
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.min(maxTex, notes.reduce((a, n) => a + n.px, 0)), height: NOTE_PX })
    const sh = new Shape()
    let u = 0
    for (const n of notes) {
      const a = noteStyle(n.work.id).tilt, c = Math.cos(a), sn = Math.sin(a), U0 = u / canvas.width, U1 = (u + n.px) / canvas.width
      quad(sh, [n.x, top, z], [n.w * c, n.w * sn, 0], [NOTE_H * sn, -NOTE_H * c, 0], [0, 0, 1], [U0, 0, U1, 1])
      u += n.px
    }
    paintNotes(notes, canvas)
    b.notes = { mesh: makeMesh(sh), canvas, tex: texFrom(canvas), list: notes }
    loadNoteFonts().then(() => { if (!dead && built.get(k) === b && b.notes) { paintNotes(notes, canvas); texFrom(canvas, b.notes.tex); draw() } })
  }

  function paintStrip(row, strip) {
    const g = strip.getContext('2d'), toPx = strip.width / rowWidth
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#222'
    g.fillRect(0, 0, strip.width, STRIP_H)
    for (const it of row) {
      if (it.face) continue
      const { base, accent } = paletteOf(it)
      const x = it.x * toPx, w = it.w * toPx, PX = STRIP_H / it.h
      // Se escribe en unidades de la pantalla: en una fila estrecha la tira se estira a lo ancho y el texto se deformaría.
      const sx = toPx / PX, wText = it.w * PX
      g.setTransform(1, 0, 0, 1, x, 0)
      const art = arts.get(artOf(it))
      let ink = inkOn(base), backing = null
      if (art) {
        // El arte ocupa todo el lomo; de la franja guardada se usa el centro, lo que corresponde a su grosor.
        const part = Math.min(art.width, (art.height * it.w) / it.h)
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
        g.drawImage(art, (art.width - part) / 2, 0, part, art.height, 0, 0, w, STRIP_H)
        backing = (x0, y0, bw, bh, force) => {
          // Desenfoque suave bajo las letras: se reduce lo pintado y se vuelve a estirar.
          const X = x + x0, sw = Math.max(2, Math.round(bw / 4)), sh = Math.max(2, Math.round(bh / 4))
          blurBox.width = sw; blurBox.height = sh
          const bg = blurBox.getContext('2d', { willReadFrequently: true })
          bg.imageSmoothingEnabled = true
          bg.drawImage(strip, X, y0, bw, bh, 0, 0, sw, sh)
          const px = bg.getImageData(0, 0, sw, sh).data
          let lum = 0
          for (let p = 0; p < px.length; p += 4) lum += px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114
          const light = force ? force === 'light' : lum / (px.length / 4) / 255 > 0.6
          g.save()
          g.beginPath()
          if (g.roundRect) g.roundRect(x0, y0, bw, bh, Math.min(bw, bh) * 0.45)
          else g.rect(x0, y0, bw, bh)
          g.clip()
          g.drawImage(blurBox, 0, 0, sw, sh, x0 - bw * 0.04, y0 - bh * 0.04, bw * 1.08, bh * 1.08)
          g.fillStyle = light ? 'rgba(255,255,255,.34)' : 'rgba(0,0,0,.32)'
          g.fillRect(x0, y0, bw, bh)
          g.restore()
          return light ? [0.08, 0.08, 0.09] : [0.98, 0.97, 0.95]
        }
      } else {
        g.fillStyle = css(base)
        g.fillRect(0, 0, w, STRIP_H)
        g.fillStyle = css(accent)
        g.fillRect(0, STRIP_H * 0.045, w, STRIP_H * 0.012)
        g.fillRect(0, STRIP_H * 0.86, w, STRIP_H * 0.012)
      }
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      // El título, en la mitad de abajo para no tapar la cara: primero se reduce la letra; si aun así no cabe, se estrecha.
      const from = art ? 0.4 : 0.07, to = art ? 0.865 : 0.85, room = STRIP_H * (to - from)
      const logo = logos.get(it.work.id)
      if (logo) {
        // El logo de la obra en lugar del texto, girado como el título; la pastilla contrasta con el propio logo.
        const lw = logo.im.naturalWidth, lh = logo.im.naturalHeight, sc = Math.min(room / lw, (wText * 0.74) / lh), len = lw * sc, thick = lh * sc
        const mid = art ? to - len / STRIP_H / 2 - 0.012 : (from + to) / 2
        if (backing) { const bw = Math.min(w * 0.96, (thick + wText * 0.2) * sx), pad = wText * 0.16; ink = backing((w - bw) / 2, STRIP_H * mid - len / 2 - pad, bw, len + pad * 2, logo.light > 0.55 ? 'dark' : 'light') }
        g.save()
        g.scale(sx, 1)
        g.translate(wText / 2, STRIP_H * mid)
        g.rotate(Math.PI / 2)
        if (!backing) { g.shadowColor = logo.light > 0.55 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.6)'; g.shadowBlur = 4 }
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
        g.drawImage(logo.im, -len / 2, -thick / 2, len, thick)
        g.restore()
      }
      let size = wText * (art ? 0.44 : 0.5)
      g.font = `700 ${Math.round(size)}px system-ui, sans-serif`
      let long = g.measureText(it.work.title).width
      if (long > room) { size = Math.max(wText * 0.32, (size * room) / long); g.font = `700 ${Math.round(size)}px system-ui, sans-serif`; long = g.measureText(it.work.title).width }
      const len = Math.min(long, room), mid = art ? to - len / STRIP_H / 2 - 0.012 : (from + to) / 2
      if (backing && !logo) {
        const bw = size * 1.45 * sx, pad = size * 0.55
        ink = backing((w - bw) / 2, STRIP_H * mid - len / 2 - pad, bw, len + pad * 2)
      }
      g.save()
      g.scale(sx, 1)
      if (logo) g.globalAlpha = 0 // ya está el logo
      g.fillStyle = css(ink)
      if (backing) { g.shadowColor = ink[0] > 0.5 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.5)'; g.shadowBlur = 3 }
      g.translate(wText / 2, STRIP_H * mid)
      g.rotate(Math.PI / 2)
      g.fillText(it.work.title, 0, 0, room)
      g.restore()
      if (it.vol.vol != null) {
        const nSize = wText * 0.5, label = String(it.vol.vol), cy = STRIP_H * 0.935
        g.font = `800 ${Math.round(nSize)}px system-ui, sans-serif`
        let numInk = ink
        if (backing) {
          const tw = Math.min(g.measureText(label).width, wText * 0.86) * sx, bw = Math.min(w * 0.94, tw + nSize * 0.6 * sx), bh = nSize * 1.35
          numInk = backing((w - bw) / 2, cy - bh / 2, bw, bh)
        }
        g.save()
        g.scale(sx, 1)
        g.fillStyle = css(numInk)
        if (backing) { g.shadowColor = numInk[0] > 0.5 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.5)'; g.shadowBlur = 3 }
        g.fillText(label, wText / 2, cy, wText * 0.86)
        g.restore()
      }
      // Redondez del lomo: se oscurece hacia los bordes.
      const round = g.createLinearGradient(0, 0, w, 0)
      round.addColorStop(0, 'rgba(0,0,0,.38)'); round.addColorStop(0.16, 'rgba(0,0,0,.05)'); round.addColorStop(0.42, 'rgba(255,255,255,.12)'); round.addColorStop(0.8, 'rgba(0,0,0,.05)'); round.addColorStop(1, 'rgba(0,0,0,.42)')
      g.fillStyle = round
      g.fillRect(0, 0, w, STRIP_H)
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
  }
  function buildRow(k) {
    const row = rows[k], base = rowBase(k), F = SHELF.FRONT, strip = Object.assign(document.createElement('canvas'), { width: stripWidth(), height: STRIP_H })
    const spines = new Shape(), paper = new Shape(), faces = []
    for (const it of row) {
      const x0 = it.x, x1 = it.x + it.w, U0 = x0 / rowWidth, U1 = x1 / rowWidth, H = it.h, D = it.d
      if (it.face) {
        const z = SHELF.FACE_Z, t = it.t, sh = new Shape(), edge = new Shape(), pages = new Shape()
        quad(sh, [x0, base + H, z], [it.w, 0, 0], [0, -H, 0], [0, 0, 1])
        quad(edge, [x0, base, z - t], [0, 0, t], [0, H, 0], [-1, 0, 0])
        quad(edge, [x1, base, z], [0, 0, -t], [0, H, 0], [1, 0, 0])
        quad(pages, [x0, base + H, z - t], [it.w, 0, 0], [0, 0, t], [0, 1, 0], [0, 0, it.w, t])
        faces.push({ it, mesh: makeMesh(sh), edge: makeMesh(edge), pages: makeMesh(pages) })
        continue
      }
      quad(spines, [x0, base + H, F], [it.w, 0, 0], [0, -H, 0], [0, 0, 1], [U0, 0, U1, 1])
      // Los costados son las tapas: un solo color del lomo, no una columna de la tira estirada a lo largo del fondo.
      const Um = (U0 + U1) / 2, side = [Um, 0.02, Um, 0.02]
      quad(spines, [x0, base, F - D], [0, 0, D], [0, H, 0], [-1, 0, 0], side)
      quad(spines, [x1, base, F], [0, 0, -D], [0, H, 0], [1, 0, 0], side)
      quad(paper, [x0, base + H, F - D], [it.w, 0, 0], [0, 0, D], [0, 1, 0], [0, it.w, it.w, it.w]) // u: a lo ancho, en el mueble; v: el grosor
    }
    paintStrip(row, strip)
    const b = { k, key: rowKey(row), strip, tex: texFrom(strip), spines: spines.i.length ? makeMesh(spines) : null, paper: paper.i.length ? makeMesh(paper) : null, faces, stale: 0 }
    built.set(k, b)
    buildNotes(b, k)
    // Colores y portadas, de poco en poco: lo de fuera de la vista espera.
    for (const it of row) {
      const url = it.face ? urlOf(it) : artOf(it)
      if (!url) {
        if (it.face) plainFor(coverKey(it))(it)
      }
      // A intervalos, y no durante un gesto: repintar y subir la tira en pleno arrastre daría tirones.
      const repaint = () => {
        if (built.get(k) !== b || b.stale) return
        b.stale = setTimeout(() => {
          b.stale = 0
          if (built.get(k) !== b || dead) return
          if (pointers.size || velocity) return repaint()
          paintStrip(row, strip)
          texFrom(strip, b.tex)
          draw()
        }, 400)
      }
      b.repaint = repaint
      if (!it.face && !it.vol.art && !it.vol.thumb) findPanel(it, () => {
        const panel = artOf(it)
        if (panel && !arts.has(panel)) keptArt(panel, ok => ok ? repaint() : loadImage(panel, im => { if (im) { learnPalette(panel, im); learnArt(panel, im, true); repaint() } }))
        else repaint()
      })
      if (!url) continue
      if (it.face) {
        if (!covers.has(url)) loadImage(url, im => {
          if (!im) return plainFor(url)(it)
          learnSize(it, url, im)
          learnPalette(url, im)
          learnArt(url, im)
          covers.set(url, texFrom(im))
          draw()
        }, true)
      } else if (arts.has(url)) {
        if (palettes[`face:${url}`] === undefined) askFace(url) // su arte salió de la portada de frente, donde no se buscan rostros
      } else keptArt(url, ok => {
        if (ok) {
          if (palettes[`face:${url}`] === undefined) askFace(url)
          return repaint()
        }
        loadImage(url, im => {
          if (!im) return
          learnSize(it, url, im)
          learnPalette(url, im)
          learnArt(url, im, true)
          repaint()
        })
      })
    }
    return b
  }
  function freeRow(b) {
    clearTimeout(b.stale)
    gl.deleteTexture(b.tex)
    freeMesh(b.spines); freeMesh(b.paper)
    for (const f of b.faces) { freeMesh(f.mesh); freeMesh(f.edge); freeMesh(f.pages) }
    if (b.notes) { freeMesh(b.notes.mesh); gl.deleteTexture(b.notes.tex) }
    built.delete(b.k)
  }
  const rowKey = row => row ? row.map(i => `${i.work.id}/${i.vol.vol}/${i.x.toFixed(4)}/${i.w.toFixed(4)}/${i.h.toFixed(3)}/${i.d.toFixed(3)}/${i.face ? 1 : 0}/${urlOf(i)}`).join() : ''
  function dropAllRows() { for (const b of [...built.values()]) freeRow(b) }

  // Lo que se puede recorrer depende del zoom: de cerca hay más mueble fuera de la pantalla.
  function limits() {
    const half = visibleH / 2 / zoom
    top = SHELF.BOARD + 0.045 - half
    bottom = Math.min(top, rowBase(Math.max(rows.length, 1) - 1) - SHELF.BOARD - 0.045 + half)
  }
  function clampView() {
    const hit = y > top || y < bottom
    y = Math.max(bottom, Math.min(top, y))
    if (hit) velocity = 0
    const room = (visibleH * (size.w / size.h) / 2) * (1 - 1 / zoom)
    x = Math.max(-room, Math.min(room, x))
  }
  function setZoom(next, cx = size.w / 2, cy = size.h / 2) {
    const z = Math.max(1, Math.min(ZOOM_MAX, next))
    if (z === zoom) return
    // El punto bajo los dedos no se mueve.
    const per = visibleH / size.h, dx = cx - size.w / 2, dy = cy - size.h / 2
    x += dx * per * (1 / zoom - 1 / z)
    y -= dy * per * (1 / zoom - 1 / z)
    zoom = z
    limits()
    clampView()
    draw()
  }
  function layout() {
    const rect = container.getBoundingClientRect()
    size = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) }
    const aspect = size.w / size.h
    visibleH = (size.w >= size.h ? rowsLandscape : rowsPortrait) * SHELF.PITCH
    rowWidth = visibleH * aspect - 2 * SHELF.SIDE - 0.05
    rows = layoutShelf(works, rowWidth, sizeOf)
    // Solo se rehace lo que cambia: al aprender tamaños, casi todas las filas siguen igual.
    const key = `${rowWidth.toFixed(3)}:${rows.length}`
    if (key !== rowsKey) {
      rowsKey = key
      dropAllRows()
      buildFurniture()
    } else for (const b of [...built.values()]) if (b.key !== rowKey(rows[b.k])) freeRow(b)
    const was = top
    limits()
    y = y === was || !y || toTopNext ? top : y
    toTopNext = false
    if (focusId) { const k = rows.findIndex(r => r.some(i => i.work.id === focusId)); if (k >= 0) y = rowBase(k) + SHELF.PITCH * 0.42 }
    clampView()
  }

  // ----- Dibujo -----
  function draw() {
    if (dead || raf) return
    raf = requestAnimationFrame(paint)
  }
  function stepInertia(now) {
    if (!velocity || pointers.size) return false
    const dt = Math.min(120, now - lastMove)
    lastMove = now
    y += velocity * dt
    velocity *= Math.exp(-dt / FRICTION_MS)
    clampView()
    if (Math.abs(velocity) < 0.00004) velocity = 0
    return !!velocity
  }
  function stepTilt(now) {
    tilt.fade(now)
    const on = !still && zoom === 1
    const want = on ? { x: tilt.target.x / MAX_DEG, y: tilt.target.y / MAX_DEG } : { x: 0, y: 0 }
    let moving = !!(tilt.target.x || tilt.target.y) && on
    for (const k of ['x', 'y']) {
      const d = want[k] - tiltNow[k]
      if (Math.abs(d) < 0.002) tiltNow[k] = want[k]
      else { tiltNow[k] += d * 0.25; moving = true }
    }
    return moving
  }
  function paint() {
    raf = 0
    if (dead) return
    const rect = container.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2.5)
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    if (rect.width !== size.w || rect.height !== size.h) layout()
    const now = performance.now()
    let again = stepInertia(now)
    if (stepTilt(now)) again = true
    if (stepPeek(now)) again = true
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (again) draw()
    if (!furniture) return
    const aspect = rect.width / rect.height
    const round = Math.max(Math.abs(tiltNow.x), Math.abs(tiltNow.y))
    const dist = (visibleH / 2 / Math.tan(FOV / 2) / zoom) * (1 + ORBIT_BACK * round)
    const M = cameraMatrix([rowWidth / 2 + x, y, SHELF.DEPTH], dist, aspect, ((REST_TILT - tiltNow.x * ORBIT_TILT) * Math.PI) / 180, (-tiltNow.y * ORBIT_YAW * Math.PI) / 180)
    gl.uniformMatrix4fv(u.uM, false, M)
    gl.uniform1f(u.uManage, managing ? 1 : 0)
    lastM = M
    gl.uniform2f(u.uSize, w, h)
    gl.uniform1f(u.uDim, peek ? (1 - 0.42 * ease(peek.t)) * (1 - 0.6 * ease(peek.fly?.t || 0)) : 1)
    if (peek) gl.uniform4f(u.uHide, peek.it.x, peek.it.x + peek.it.w, peek.base - 0.002, peek.base + peek.it.h + 0.002)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(u.uKind, 0)
    gl.bindTexture(gl.TEXTURE_2D, wood)
    drawMesh(furniture)
    const nearest = Math.round((-y - SHELF.PITCH / 2) / SHELF.PITCH)
    const reach = Math.ceil(visibleH / zoom / SHELF.PITCH / 2) + 1
    for (const b of [...built.values()]) if (Math.abs(b.k - nearest) > reach + 2) freeRow(b)
    for (let k = Math.max(0, nearest - reach); k <= Math.min(rows.length - 1, nearest + reach); k++) {
      const b = built.get(k) || buildRow(k)
      if (b.spines) {
        gl.uniform1i(u.uKind, 1)
        gl.bindTexture(gl.TEXTURE_2D, b.tex)
        drawMesh(b.spines)
      }
      if (b.notes) {
        gl.uniform1i(u.uKind, 1)
        gl.bindTexture(gl.TEXTURE_2D, b.notes.tex)
        drawMesh(b.notes.mesh)
      }
      gl.uniform1i(u.uKind, 3)
      if (b.paper) drawMesh(b.paper)
      for (const f of b.faces) {
        const tex = covers.get(coverKey(f.it)), { base } = paletteOf(f.it)
        gl.uniform1i(u.uKind, 2)
        gl.uniform1f(u.uHas, tex ? 1 : 0)
        gl.uniform3fv(u.uColor, base)
        if (tex) gl.bindTexture(gl.TEXTURE_2D, tex)
        drawMesh(f.mesh)
        gl.uniform1i(u.uKind, 4)
        drawMesh(f.edge)
        gl.uniform1i(u.uKind, 5)
        drawMesh(f.pages)
      }
    }
    if (peek) {
      // Ya delante, el tomo no sigue al giroscopio: su cámara pierde la inclinación a medida que se acerca.
      const k = 1 - ease(peek.t), dk = (visibleH / 2 / Math.tan(FOV / 2) / zoom) * (1 + ORBIT_BACK * round * k)
      peekM = cameraMatrix([rowWidth / 2 + x, y, SHELF.DEPTH], dk, aspect, ((REST_TILT - tiltNow.x * ORBIT_TILT * k) * Math.PI) / 180, (-tiltNow.y * ORBIT_YAW * k * Math.PI) / 180)
      gl.uniformMatrix4fv(u.uM, false, peekM)
      if (peek.fly) drawTable()
      drawPeek()
      if (peek.fly && peek.fly.t >= 1 && !peek.fly.shot) {
        // Último fotograma, tomado ahora que el lienzo aún lo tiene: tapa el cambio al lector.
        peek.fly.shot = true
        let snap = null
        try { snap = canvas.toDataURL('image/jpeg', 0.9) } catch {}
        const done = peek.fly.done
        setTimeout(() => done?.(snap), 0)
      }
    }
  }

  // ----- Vistazo: el tomo sale recto de la fila, gira y se acerca enseñando la portada -----
  let peek = null, lastM = null, peekM = null, deferLayout = false
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
  const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
  // Caja centrada en el origen con la portada hacia +z y el lomo a la derecha (+x), como un manga: en la fila, la portada mira a la izquierda.
  function peekBox(W, H, T, U0, U1) {
    const cover = new Shape(), spine = new Shape(), back = new Shape(), paper = new Shape(), X = W / 2, Y = H / 2, Z = T / 2
    quad(cover, [-X, Y, Z], [W, 0, 0], [0, -H, 0], [0, 0, 1])
    quad(spine, [X, Y, Z], [0, 0, -T], [0, -H, 0], [1, 0, 0], [U0, 0, U1, 1]) // en la fila, con el giro, coincide con su trozo de la tira
    quad(back, [X, Y, -Z], [-W, 0, 0], [0, -H, 0], [0, 0, -1])
    quad(paper, [-X, Y, -Z], [W, 0, 0], [0, 0, T], [0, 1, 0], [0, 0, W, T])
    quad(paper, [-X, -Y, -Z], [W, 0, 0], [0, 0, T], [0, -1, 0], [0, 0, W, T])
    quad(paper, [-X, -Y, -Z], [0, H, 0], [0, 0, T], [-1, 0, 0], [0, 0, H, T])
    return [cover, spine, back, paper].map(makeMesh)
  }
  // Dónde queda delante de la cámara: a un lado de la ficha en apaisado, encima en vertical.
  function peekTarget(W, H) {
    const aspect = size.w / size.h, tan = Math.tan(FOV / 2), dist = visibleH / 2 / tan / zoom, wide = aspect >= 1
    let dd = H / ((wide ? 0.62 : 0.42) * 2 * tan)
    if (!wide) dd = Math.max(dd, W / (0.6 * 2 * tan * aspect))
    dd = Math.min(dd, dist * 0.92)
    const vh = 2 * tan * dd, vw = vh * aspect
    // Sobre el eje de la cámara en reposo (mira algo hacia abajo), y desplazado en su plano.
    const tl = (REST_TILT * Math.PI) / 180, T = [rowWidth / 2 + x, y, SHELF.DEPTH], eye = [T[0], T[1] - dist * Math.sin(tl), T[2] + dist * Math.cos(tl)]
    const f = [0, T[1] - eye[1], T[2] - eye[2]], n = Math.hypot(f[1], f[2]), F = [0, f[1] / n, f[2] / n], U = [0, -F[2], F[1]] // derecha: +x
    const dx = wide ? -vw * 0.2 : 0, dy = wide ? 0 : vh * 0.16
    return [eye[0] + dx, eye[1] + F[1] * dd + U[1] * dy, eye[2] + F[2] * dd + U[2] * dy]
  }
  function peekInfo(it) {
    const vols = it.work.vols || [], i = vols.indexOf(it.vol), ch = it.work.chapterId
    const cur = ch ? vols.findIndex(v => (v.chapters || []).includes(ch)) : -1
    const state = !ch ? 'new' : !vols.length ? 'reading' : cur < 0 ? 'unknown' : i < cur ? 'read' : i === cur ? 'reading' : 'new'
    return { work: it.work, vol: it.vol, index: i, count: vols.length, state }
  }
  function startPeek(it, k) {
    const b = built.get(k)
    if (!b) return
    if (peek) freePeek()
    const base = rowBase(k), out = !it.face, W = out ? it.d : it.w, H = it.h, T = out ? it.w : it.t
    const from = out ? { pos: [it.x + it.w / 2, base + H / 2, SHELF.FRONT - it.d / 2], rot: -Math.PI / 2 } : { pos: [it.x + it.w / 2, base + H / 2, SHELF.FACE_Z - it.t / 2], rot: 0 }
    const mid = { pos: [from.pos[0], from.pos[1] + 0.006, from.pos[2] + (out ? it.d + 0.03 : 0.14)], rot: from.rot }
    peek = { it, k, b, base, out, W, H, T, from, mid, to: { pos: peekTarget(W, H), rot: 0 }, box: peekBox(W, H, T, it.x / rowWidth, (it.x + it.w) / rowWidth), t: 0, dir: 1, at: performance.now(), tex: null, rank: -1 }
    velocity = 0
    // Portada: primero la que ya hay, luego la grande.
    const p = peek, shared = covers.get(coverKey(it))
    if (shared) p.shared = shared
    else { p.tex = texFrom(plainCover(it)); p.rank = 0 }
    ;[it.vol.thumb || it.work.cover, it.vol.art, it.vol.front].forEach((url, rank) => {
      if (url) loadImage(url, im => {
        if (peek !== p || !im || rank + 1 <= p.rank) return
        if (p.tex) gl.deleteTexture(p.tex)
        p.tex = texFrom(im); p.rank = rank + 1; p.shared = null
        draw()
      })
    })
    onPeek?.(peekInfo(it))
    draw()
  }
  function freePeek() {
    if (!peek) return
    for (const m of peek.box) freeMesh(m)
    if (peek.tex && !gl.isContextLost()) gl.deleteTexture(peek.tex)
    peek = null
    if (deferLayout) { deferLayout = false; api.relayout() }
  }
  function unpeek() {
    if (!peek || peek.dir < 0 || peek.fly) return
    peek.dir = -1
    peek.at = performance.now()
    onPeek?.(null)
    draw()
  }
  function peekPose(p) {
    if (p.fly) {
      const a = p.fly.from, e = ease(p.fly.t)
      return { pos: lerp3(a.pos, p.fly.to.pos, e), rot: a.rot + (p.fly.to.rot - a.rot) * e, lean: (a.lean || 0) + (p.fly.to.lean - (a.lean || 0)) * e }
    }
    const t = p.t
    if (t <= PEEK_SLIDE) return { pos: lerp3(p.from.pos, p.mid.pos, ease(t / PEEK_SLIDE)), rot: p.from.rot }
    const e = ease((t - PEEK_SLIDE) / (1 - PEEK_SLIDE))
    return { pos: lerp3(p.mid.pos, p.to.pos, e), rot: p.from.rot + (p.to.rot - p.from.rot) * e }
  }
  function stepPeek(now) {
    if (!peek) return false
    if (peek.fly) {
      const f = peek.fly
      f.t = still ? 1 : Math.min(1, f.t + (now - f.at) / FLY_MS)
      f.at = now
      return f.t < 1 || !f.shot
    }
    const dt = still ? 1 : (now - peek.at) / (peek.dir > 0 ? PEEK_OPEN_MS : PEEK_CLOSE_MS)
    peek.at = now
    peek.t = Math.max(0, Math.min(1, peek.t + peek.dir * dt))
    if (peek.dir < 0 && peek.t === 0) { freePeek(); return true }
    return peek.t < 1 || peek.dir < 0
  }
  function drawPeek() {
    const p = peek, pose = peekPose(p), [cover, spine, back, paper] = p.box
    gl.uniform4f(u.uHide, 0, 0, 0, 0)
    gl.uniform1f(u.uDim, 1)
    gl.uniformMatrix4fv(u.uModel, false, modelOf(pose))
    const tex = p.tex || p.shared
    gl.uniform3fv(u.uColor, paletteOf(p.it).base)
    gl.uniform1i(u.uKind, 2)
    gl.uniform1f(u.uHas, tex ? 1 : 0)
    if (tex) gl.bindTexture(gl.TEXTURE_2D, tex)
    drawMesh(cover)
    if (p.out && built.get(p.k) === p.b) { gl.uniform1i(u.uKind, 1); gl.bindTexture(gl.TEXTURE_2D, p.b.tex) } else gl.uniform1i(u.uKind, 4)
    drawMesh(spine)
    gl.uniform1i(u.uKind, 4)
    drawMesh(back)
    gl.uniform1i(u.uKind, 5)
    drawMesh(paper)
    gl.uniformMatrix4fv(u.uModel, false, IDENTITY)
  }
  // Giro del tomo: primero sobre su eje vertical (sacarlo y enseñar la portada), luego hacia atrás (posarlo en la mesa).
  function modelOf({ pos, rot, lean = 0 }) {
    const cy = Math.cos(rot), sy = Math.sin(rot), cx = Math.cos(lean), sx = Math.sin(lean)
    return new Float32Array([cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, pos[0], pos[1], pos[2], 1])
  }
  // ----- A la mesa: el tomo se centra y se recuesta como en el lector, y la mesa aparece detrás -----
  let tableTex = null, tableAspect = 1, tableMesh = null
  if (table) loadImage(table, im => { if (im && !dead) { tableTex = texFrom(im); tableAspect = im.naturalWidth / im.naturalHeight; draw() } })
  function flyTarget(W, H) {
    // Como el encuadre del tomo cerrado en el lector: centrado, con un margen de 14 a 40 px.
    const aspect = size.w / size.h, tan = Math.tan(FOV / 2), dist = visibleH / 2 / tan / zoom
    const m = Math.max(14, Math.min(40, Math.min(size.w, size.h) * 0.04))
    let dd = (H * 1.04) / (2 * tan * (1 - (2 * m) / size.h))
    dd = Math.max(dd, (W * 1.06) / (2 * tan * aspect * (1 - (2 * m) / size.w)))
    dd = Math.min(dd, dist * 0.95)
    const tl = (REST_TILT * Math.PI) / 180, T = [rowWidth / 2 + x, y, SHELF.DEPTH], eye = [T[0], T[1] - dist * Math.sin(tl), T[2] + dist * Math.cos(tl)]
    const f = [T[1] - eye[1], T[2] - eye[2]], n = Math.hypot(f[0], f[1])
    return { pos: [eye[0], eye[1] + (f[0] / n) * dd, eye[2] + (f[1] / n) * dd], rot: 0, lean: (-(14 - REST_TILT) * Math.PI) / 180 } // en el lector la mesa se ve a 14°
  }
  function drawTable() {
    const f = peek.fly, a = Math.min(1, Math.max(0, (f.t - 0.1) / 0.75))
    if (a <= 0) return
    const pose = peekPose(peek), Tz = peek.T / 2 + 0.003
    if (!tableMesh) {
      const sh = new Shape(), S = 14
      quad(sh, [-S, S, 0], [2 * S, 0, 0], [0, -2 * S, 0], [0, 0, 1], [-S, S, S, -S])
      tableMesh = makeMesh(sh)
    }
    gl.uniform4f(u.uHide, 0, 0, 0, 0) // el hueco del tomo en la fila no recorta la mesa
    const M = modelOf(pose)
    // La mesa queda bajo el tomo: se baja a lo largo de su normal.
    M[12] -= M[8] * Tz; M[13] -= M[9] * Tz; M[14] -= M[10] * Tz
    gl.uniformMatrix4fv(u.uModel, false, M)
    gl.uniform4f(u.uSpot, pose.pos[0], pose.pos[1], pose.pos[2], Math.max(peek.W, peek.H) * 0.9)
    const tex = tableTex || wood, k = Math.max(peek.H * 1.6, (peek.W * 2.2) / tableAspect)
    gl.uniform1f(u.uHas, tableTex ? 1 : 0)
    gl.uniform2f(u.uTab, 1 / (k * tableAspect), -1 / k)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(u.uKind, 6)
    gl.uniform1f(u.uAlpha, ease(a))
    // De fondo, aunque al recostarse se meta tras el mueble; luego el tomo se dibuja encima sin que el mueble lo tape.
    gl.enable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    drawMesh(tableMesh)
    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.uniform1f(u.uAlpha, 1)
  }
  function fly(done) {
    if (!peek || peek.dir < 0 || peek.fly) return false
    const from = peekPose(peek)
    peek.fly = { t: 0, at: performance.now(), from, to: flyTarget(peek.W, peek.H), done, shot: false }
    onPeek?.(null)
    draw()
    return true
  }

  // Pantalla: píxeles CSS dentro del lienzo.
  const toScreen = (q, m = lastM) => { const [nx, ny] = project(m, q); return [((nx + 1) / 2) * size.w, ((1 - ny) / 2) * size.h] }
  function itemRect(it, k) {
    const base = rowBase(k), z = it.face ? SHELF.FACE_Z : SHELF.FRONT, [ax, ay] = toScreen([it.x, base + it.h, z]), [bx, by] = toScreen([it.x + it.w, base, z])
    return { l: Math.min(ax, bx), r: Math.max(ax, bx), t: Math.min(ay, by), b: Math.max(ay, by) }
  }
  // El lomo bajo el dedo; con lomos estrechos, el de centro más cercano.
  function pickAt(px, py) {
    if (!lastM) return null
    let best = null
    for (const b of built.values()) for (const it of rows[b.k] || []) {
      const r = itemRect(it, b.k), slack = 4
      if (px < r.l - slack || px > r.r + slack || py < r.t || py > r.b) continue
      const d = Math.abs(px - (r.l + r.r) / 2) / Math.max(1, r.r - r.l)
      if (!best || d < best.d) best = { it, k: b.k, d }
    }
    return best
  }
  function peekRect() {
    if (!peekM || !peek) return null
    const { pos } = peekPose(peek), [ax, ay] = toScreen([pos[0] - peek.W / 2, pos[1] + peek.H / 2, pos[2]], peekM), [bx, by] = toScreen([pos[0] + peek.W / 2, pos[1] - peek.H / 2, pos[2]], peekM)
    return { l: Math.min(ax, bx), r: Math.max(ax, bx), t: Math.min(ay, by), b: Math.max(ay, by) }
  }
  function onPeekBook(px, py) {
    const r = peekRect()
    return !!r && px >= r.l && px <= r.r && py >= r.t && py <= r.b
  }
  function onTap(cx, cy, wasMoving) {
    const r = canvas.getBoundingClientRect(), px = cx - r.left, py = cy - r.top
    if (peek?.fly) return
    if (peek) {
      if (peek.dir > 0 && peek.t >= 1 && onPeekBook(px, py) && onOpen) return onOpen(peekInfo(peek.it))
      return unpeek()
    }
    if (wasMoving) return // ese toque solo frenó la inercia
    const hit = pickAt(px, py)
    if (hit && managing) return onManage?.(hit.it.work)
    if (hit) startPeek(hit.it, hit.k)
  }

  // ----- Gestos: un dedo recorre, dos acercan -----
  const pointers = new Map()
  let pinch = null, track = null, tap = null
  const unitsPerPx = () => visibleH / Math.max(1, size.h) / zoom
  const spread = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 } }
  function onDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { canvas.setPointerCapture(e.pointerId) } catch {}
    tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp, moving: !!velocity } : null
    focusId = null
    velocity = 0
    track = null
    if (pointers.size === 2) { const s = spread(); pinch = { ...s, zoom } }
    else if (pointers.size === 1) track = { x: e.clientX, y: e.clientY, t: e.timeStamp, v: 0 }
    draw()
  }
  function onMove(e) {
    const p = pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null
    if (peek) return // con un tomo fuera, el mueble se queda quieto
    if (pinch && pointers.size >= 2) {
      const s = spread()
      setZoom(pinch.zoom * (s.d / Math.max(1, pinch.d)), s.cx, s.cy)
      return
    }
    if (pointers.size !== 1) return
    y += dy * unitsPerPx()
    x -= dx * unitsPerPx()
    clampView()
    if (track) {
      const dt = Math.max(1, e.timeStamp - track.t)
      track.v = track.v * 0.6 + ((dy * unitsPerPx()) / dt) * 0.4
      track.t = e.timeStamp
    }
    draw()
  }
  function onUp(e) {
    if (!pointers.delete(e.pointerId)) return
    if (pointers.size < 2) pinch = null
    if (tap && !pointers.size && e.type === 'pointerup' && e.timeStamp - tap.t < 450) { const { moving } = tap; tap = null; track = null; return onTap(e.clientX, e.clientY, moving) }
    tap = null
    if (!pointers.size && track && e.timeStamp - track.t < 80 && Math.abs(track.v) > 0.0002) {
      velocity = track.v
      lastMove = performance.now()
      draw()
    }
    if (pointers.size) track = null
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    if (peek) return
    focusId = null
    velocity = 0
    if (e.ctrlKey) return setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY) // pellizco en el panel táctil
    y -= e.deltaY * unitsPerPx()
    x += e.deltaX * unitsPerPx()
    clampView()
    draw()
  }, { passive: false })
  const onVis = () => { if (document.visibilityState === 'visible') { if (!still) tilt.permit() } else tilt.listen(false) }
  document.addEventListener('visibilitychange', onVis)

  const ro = new ResizeObserver(() => { layout(); draw() })
  ro.observe(container)
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault()
    built.clear(); covers.clear(); furniture = null; rowsKey = ''
    if (peek) { const f = peek.fly; peek = null; onPeek?.(null); f?.done?.(null) } // sus mallas y texturas se perdieron con el contexto
    tableMesh = null; tableTex = null
  })
  canvas.addEventListener('webglcontextrestored', () => { initGL(); layout(); draw() })
  initGL()
  layout()
  if (!still) tilt.permit()
  draw()

  const api = {
    setManage(value) { managing = Boolean(value); if (peek) unpeek(); draw() },
    setWorks(next) { works = next; api.relayout() },
    toTop() { focusId = null; velocity = 0; toTopNext = true; api.relayout() }, // tras cambiar el orden
    relayout() {
      clearTimeout(layoutTimer)
      layoutTimer = setTimeout(() => {
        if (dead) return
        if (peek) { deferLayout = true; return } // con un tomo fuera, el mueble no se reordena hasta que vuelva
        layout(); draw()
      }, 350)
    },
    setVolumes(id, vols) {
      const w = works.find(x => x.id === id)
      if (!w) return
      w.vols = vols
      api.relayout()
    },
    unpeek,
    setLogo,
    fly,
    focus(id) { focusId = id; layout(); draw() },
    peeked: () => (peek && peek.dir > 0 ? peekInfo(peek.it) : null),
    // Centro en pantalla de un tomo (para las pruebas y para enfocar).
    screenOf(id, vol) {
      if (!lastM) return null
      for (const b of built.values()) for (const it of rows[b.k] || []) if (it.work.id === id && (vol === undefined || it.vol.vol === vol)) { const r = itemRect(it, b.k); return { x: (r.l + r.r) / 2, y: (r.t + r.b) / 2, w: r.r - r.l, h: r.b - r.t } }
      return null
    },
    scrollTo(next) { velocity = 0; y = next; clampView(); draw() },
    moveHorizontal(delta) { focusId = null; velocity = 0; x += delta; clampView(); draw() },
    setZoom,
    draw,
    // Para las pruebas.
    debug: () => ({ faces: Object.entries(palettes).filter(([k, v]) => k.startsWith('face:') && v).length, facesAsked: Object.keys(palettes).filter(k => k.startsWith('face:')).length, faceWaiting: faceWaiting.length, faceBusy, faceWorker: faceWorker === false ? 'off' : !!faceWorker, rows: rows.map(r => r.map(i => ({ id: i.work.id, vol: i.vol.vol, x: i.x, w: i.w, h: i.h, d: i.d, face: i.face }))), rowWidth, y, x, zoom, velocity, top, bottom, peek: peek && { id: peek.it.work.id, vol: peek.it.vol.vol, t: peek.t, dir: peek.dir, rank: peek.rank, rect: peekRect(), fly: peek.fly ? peek.fly.t : null }, focusId, notes: [...built.values()].map(b => ({ k: b.k, notes: (b.notes?.list || []).map(n => ({ id: n.work.id, x: n.x, w: n.w })) })), logos: logos.size, tilt: { ...tiltNow }, listening: tilt.listening, arts: arts.size, panels: panels.size, built: [...built.keys()], covers: covers.size, palettes: Object.keys(palettes).length, waiting: waiting.length, busy: imgBusy, ctx: !gl.isContextLost() }),
    destroy() {
      if (faceWorker) faceWorker.terminate()
      dead = true
      cancelAnimationFrame(raf)
      clearTimeout(layoutTimer)
      clearTimeout(saveTimer)
      ro.disconnect()
      tilt.stop()
      document.removeEventListener('visibilitychange', onVis)
      try { localStorage.setItem(STORE, JSON.stringify(palettes)) } catch {}
      freePeek()
      freeMesh(tableMesh)
      if (tableTex) gl.deleteTexture(tableTex)
      dropAllRows()
      for (const t of covers.values()) gl.deleteTexture(t)
      covers.clear()
      freeMesh(furniture)
      gl.deleteTexture(wood)
      gl.deleteProgram(prog)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    },
  }
  canvas.shelf = api
  return api
}
