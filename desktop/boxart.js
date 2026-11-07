// Caras generadas de la caja de un juego, para cuando no hay escaneo real: portada, lomo y contraportada,
// compuestos con la portada, el logo, el banner, las capturas, la descripción y los logos de la desarrolladora y la editora.
// Proporciones de una caja de DVD (13,5 × 19 cm, 14 mm de lomo).
export const BACK_W = 900, BACK_H = 1280, SPINE_W = 96, SPINE_H = 1280, COVER_W = 600, COVER_H = 900
// El lomo se dibuja en unidades de 96 × 1280 pero a más resolución, para que el logo se vea nítido en la caja y con zoom.
const SPINE_SCALE = 1.5
// Icono de Steam (Simple Icons, CC0), en una caja de 24 × 24.
const STEAM_PATH = 'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z'
let steamShape = null

const loadImg = url => new Promise(resolve => {
  if (!url) return resolve(null)
  const im = new Image()
  im.onload = () => resolve(im)
  im.onerror = () => resolve(null)
  im.src = url
})
const toBlob = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
const surface = (width, height) => { const c = Object.assign(document.createElement('canvas'), { width, height }); return [c, c.getContext('2d')] }
const size = im => ({ w: im.naturalWidth || im.width, h: im.naturalHeight || im.height })

// Dibuja la imagen cubriendo el rectángulo (recorta lo que sobra), como «object-fit: cover».
function cover(g, im, x, y, w, h, focusY = 0.5) {
  const { w: iw, h: ih } = size(im), s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s
  g.drawImage(im, (iw - sw) / 2, (ih - sh) * focusY, sw, sh, x, y, w, h)
}
function contain(g, im, x, y, w, h) {
  const { w: iw, h: ih } = size(im), s = Math.min(w / iw, h / ih), dw = iw * s, dh = ih * s
  g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  return { w: dw, h: dh }
}
// Color medio de la portada, oscurecido: el fondo de la caja.
export function baseColor(im) {
  if (!im) return [38, 34, 40]
  const [, g] = surface(8, 12)
  g.drawImage(im, 0, 0, 8, 12)
  const px = g.getImageData(0, 0, 8, 12).data
  let r = 0, gr = 0, b = 0
  for (let i = 0; i < px.length; i += 4) { r += px[i]; gr += px[i + 1]; b += px[i + 2] }
  const n = px.length / 4, k = 0.45
  return [r, gr, b].map(v => Math.round((v / n) * k))
}
const rgb = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`

/** Parte un texto en líneas que caben en el ancho; corta con «…» si pasa del máximo. */
export function wrapLines(text, width, measure, maxLines) {
  const lines = []
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1)
    if (last != null && measure(`${last} ${word}`) <= width) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let tail = kept[maxLines - 1]
  while (tail && measure(`${tail}…`) > width) tail = tail.replace(/\s*\S+$/, '')
  kept[maxLines - 1] = `${tail}…`
  return kept
}

function fitText(g, text, maxWidth, px, weight = 700) {
  g.font = `${weight} ${px}px system-ui, sans-serif`
  const w = g.measureText(text).width
  if (w > maxWidth) { px = Math.max(10, Math.floor((px * maxWidth) / w)); g.font = `${weight} ${px}px system-ui, sans-serif` }
  return px
}
// Placa con el icono de Steam (en lugar de la etiqueta «PC» de las cajas impresas).
function steamBadge(g, x, y, w, h) {
  g.save()
  g.fillStyle = '#171a21'
  g.beginPath()
  if (g.roundRect) g.roundRect(x, y, w, h, Math.min(w, h) * 0.14); else g.rect(x, y, w, h)
  g.fill()
  g.fillStyle = '#1a9fff'
  g.fillRect(x, y + h - Math.max(3, h * 0.07), w, Math.max(3, h * 0.07))
  steamShape ??= new Path2D(STEAM_PATH)
  const s = (Math.min(w, h) * 0.66) / 24
  g.translate(x + w / 2 - 12 * s, y + h / 2 - 12 * s - h * 0.03)
  g.scale(s, s)
  g.fillStyle = '#fff'
  g.fill(steamShape)
  g.restore()
}
// Cómo es un logo: si tiene fondo propio (opaco) y lo claro que es lo que se ve de él.
function logoTone(im) {
  const { w, h } = size(im), sw = Math.max(1, Math.min(64, w)), sh = Math.max(1, Math.round((sw * h) / w))
  const [, g] = surface(sw, sh)
  g.drawImage(im, 0, 0, sw, sh)
  try {
    const px = g.getImageData(0, 0, sw, sh).data
    let alpha = 0, lum = 0
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; alpha += a; lum += a * (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255 }
    return { opaque: alpha / (px.length / 4) > 0.92, light: alpha ? lum / alpha : 0.5 }
  } catch { return { opaque: true, light: 0.5 } }
}
// La forma de un logo transparente, rellena de un color (para su contorno).
function silhouette(im, color) {
  const { w, h } = size(im), [c, g] = surface(Math.max(1, w), Math.max(1, h))
  g.drawImage(im, 0, 0, w, h)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  return c
}
async function loadCompanies(companies = []) {
  return Promise.all(companies.slice(0, 2).map(async item => ({ name: item.name, logo: await loadImg(item.logo) })))
}
// Una empresa en un hueco: su logo o, si no hay, su nombre en varias líneas.
function drawCompany(g, item, x, y, w, h, color) {
  if (item.logo) {
    // Con sus colores, como en las cajas impresas. Uno transparente va sobre una placa que contraste con él.
    const { opaque, light } = logoTone(item.logo), { w: iw, h: ih } = size(item.logo)
    if (opaque) { contain(g, item.logo, x, y, w, h); return }
    const pad = Math.min(w, h) * 0.12, s = Math.min((w - 2 * pad) / iw, (h - 2 * pad) / ih), pw = iw * s + 2 * pad, ph = ih * s + 2 * pad
    const px = x + (w - pw) / 2, py = y + (h - ph) / 2
    g.save()
    g.fillStyle = light > 0.62 ? '#1d1d22' : '#f3f1ec'
    g.beginPath()
    if (g.roundRect) g.roundRect(px, py, pw, ph, Math.min(pw, ph) * 0.18); else g.rect(px, py, pw, ph)
    g.fill()
    g.restore()
    g.drawImage(item.logo, px + pad, py + pad, iw * s, ih * s)
    return
  }
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'
  let px = Math.min(22, h / 2.4)
  g.font = `800 ${px}px system-ui, sans-serif`
  let lines = wrapLines(item.name.toUpperCase(), w, t => g.measureText(t).width, 3)
  while (px > 9 && lines.some(line => g.measureText(line).width > w)) { px--; g.font = `800 ${px}px system-ui, sans-serif`; lines = wrapLines(item.name.toUpperCase(), w, t => g.measureText(t).width, 3) }
  lines.forEach((line, i) => g.fillText(line, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * px * 1.1, w))
}

// La franja vertical (de proporción «aspect» = ancho/alto) más colorida de una imagen: suele caer sobre el personaje.
function bestSlice(im, aspect) {
  const { w, h } = size(im), sw = Math.min(w, h * aspect), steps = 24
  if (sw >= w) return 0
  const [, g] = surface(96, Math.max(8, Math.round((96 * h) / w)))
  g.drawImage(im, 0, 0, 96, g.canvas.height)
  let best = (w - sw) / 2, score = -1
  try {
    const px = g.getImageData(0, 0, 96, g.canvas.height).data, cols = Math.max(1, Math.round((96 * sw) / w))
    for (let i = 0; i <= steps; i++) {
      const x0 = Math.round(((96 - cols) * i) / steps)
      let sum = 0
      for (let y = 0; y < g.canvas.height; y += 2) for (let x = x0; x < x0 + cols; x++) {
        const k = (y * 96 + x) * 4, r = px[k], gg = px[k + 1], b = px[k + 2]
        sum += Math.max(r, gg, b) - Math.min(r, gg, b) + (r + gg + b) / 12 // color y algo de luz
      }
      // Se prefiere algo el centro, donde suele estar lo importante.
      const centered = sum * (1 - 0.25 * Math.abs(i / steps - 0.5))
      if (centered > score) { score = centered; best = (x0 / 96) * w }
    }
  } catch {}
  return best
}

// Estilos del lomo generado:
//  «arte»       la franja más colorida del arte ancho del juego, a todo el alto;
//  «envolvente» el borde izquierdo de la portada, como si la impresión siguiera del frente al lomo;
//  «color»      color liso de la portada con una ventanita de arte arriba (como muchos lomos reales);
//  «banda»      arte en la parte de arriba que se funde con el color liso de abajo, donde va el logo.
export const SPINE_STYLES = ['banda', 'color', 'arte', 'envolvente'] // la primera, por defecto
const vivid = ([r, g, b]) => { const m = Math.max(r, g, b, 1), k = Math.min(2.4, 150 / m); return [r, g, b].map(v => Math.round(v * k)) }

export async function composeSpine({ title, cover: coverUrl, logo: logoUrl, art: artUrl, companies = [], style = 'banda' }) {
  const [cover0, logo, firms, hero] = await Promise.all([loadImg(coverUrl), loadImg(logoUrl), loadCompanies(companies), loadImg(artUrl)])
  const [c, g] = surface(SPINE_W * SPINE_SCALE, SPINE_H * SPINE_SCALE), base = baseColor(cover0 || hero)
  g.scale(SPINE_SCALE, SPINE_SCALE)
  g.imageSmoothingQuality = 'high'
  const solid = style === 'color' || style === 'banda', tone = solid ? vivid(base) : base
  g.fillStyle = rgb(tone)
  g.fillRect(0, 0, SPINE_W, SPINE_H)
  // Pinta en (0, y0)–(SPINE_W, y0 + hgt) el trozo de la imagen con esa proporción: el más colorido o el borde izquierdo.
  const slice = (img, y0, hgt, fromLeft = false) => {
    const { w, h } = size(img), asp = SPINE_W / hgt, sw = Math.min(w, h * asp), sh = sw / asp
    const sx = fromLeft ? 0 : bestSlice(img, asp), sy = (h - sh) / 2
    g.filter = 'saturate(1.12) contrast(1.04)'
    g.drawImage(img, sx, sy, sw, sh, 0, y0, SPINE_W, hgt)
    g.filter = 'none'
  }
  const art = hero || cover0
  if (style === 'envolvente' && cover0) slice(cover0, 0, SPINE_H, true)
  else if (style === 'arte' && art) slice(art, 0, SPINE_H)
  else if (style === 'banda' && art) {
    const hgt = SPINE_H * 0.5
    slice(art, 0, hgt)
    const fade = g.createLinearGradient(0, hgt * 0.55, 0, hgt)
    fade.addColorStop(0, rgb(tone, 0)); fade.addColorStop(1, rgb(tone, 1))
    g.fillStyle = fade; g.fillRect(0, 0, SPINE_W, hgt + 1)
  } else if (style === 'color') {
    // Degradado del color y una franja de acento; arriba, una ventana con el arte, enmarcada.
    const tint = g.createLinearGradient(0, 0, SPINE_W, 0)
    tint.addColorStop(0, rgb(tone.map(v => v * 0.8))); tint.addColorStop(0.5, rgb(tone)); tint.addColorStop(1, rgb(tone.map(v => v * 0.8)))
    g.fillStyle = tint; g.fillRect(0, 0, SPINE_W, SPINE_H)
    g.fillStyle = 'rgba(255,255,255,.85)'
    g.fillRect(0, 92 + 300 + 6, SPINE_W, 4)
    if (art) slice(art, 92 + 6, 300)
  }
  // Oscurece arriba (placa) y abajo (empresas) para que se lean; en los estilos con arte a todo el alto, también el centro.
  const shade = g.createLinearGradient(0, 0, 0, SPINE_H)
  if (solid) { shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(0.75, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.45)') }
  else { shade.addColorStop(0, 'rgba(0,0,0,.55)'); shade.addColorStop(0.14, 'rgba(0,0,0,.1)'); shade.addColorStop(0.62, 'rgba(0,0,0,.1)'); shade.addColorStop(0.78, 'rgba(0,0,0,.55)'); shade.addColorStop(1, 'rgba(0,0,0,.8)') }
  g.fillStyle = shade
  g.fillRect(0, 0, SPINE_W, SPINE_H)
  steamBadge(g, 0, 0, SPINE_W, 92)
  // Abajo, de pie y una sobre otra, la editora y la desarrolladora, como en los lomos impresos.
  const slot = 104, bottom = SPINE_H - 18
  firms.forEach((item, i) => drawCompany(g, item, 12, bottom - slot * (firms.length - i), SPINE_W - 24, slot - 22, 'rgba(255,255,255,.92)'))
  // El nombre se lee de arriba abajo, entre la placa y las empresas, sobre una franja translúcida.
  const top = style === 'color' ? 92 + 300 + 40 : style === 'banda' ? SPINE_H * 0.5 : 92 + 30, end = bottom - slot * firms.length - 20, room = end - top, thick = SPINE_W * 0.72
  // Largo real del título (logo o texto) para que la franja solo lo cubra a él y el arte siga a la vista.
  const wideLogo = logo && size(logo).w > size(logo).h
  let len
  if (wideLogo) len = size(logo).w * Math.min(room / size(logo).w, thick / size(logo).h)
  else { fitText(g, title, room, SPINE_W * 0.42); len = Math.min(room, g.measureText(title).width) }
  g.fillStyle = solid ? 'rgba(0,0,0,0)' : rgb(base, 0.5) // sobre color liso no hace falta franja
  if (g.roundRect) { g.beginPath(); g.roundRect(SPINE_W * 0.1, top + (room - len) / 2 - 16, SPINE_W * 0.8, len + 32, 10); g.fill() }
  else g.fillRect(SPINE_W * 0.1, top + (room - len) / 2 - 16, SPINE_W * 0.8, len + 32)
  g.save()
  g.translate(SPINE_W / 2, top + room / 2)
  g.rotate(Math.PI / 2)
  // Nítido, sin sombra difuminada. Si se confunde con el color de detrás, lleva un contorno del color contrario.
  if (wideLogo) {
    const { opaque, light } = logoTone(logo), behind = solid ? tone : base
    const back = (behind[0] * 0.299 + behind[1] * 0.587 + behind[2] * 0.114) / 255
    if (!opaque && Math.abs(light - back) < 0.4) {
      const s = Math.min(room / size(logo).w, thick / size(logo).h), lw = size(logo).w * s, lh = size(logo).h * s
      const edge = silhouette(logo, light > 0.5 ? '#111214' : '#ffffff'), r = 2.2
      for (let a = 0; a < 16; a++) g.drawImage(edge, -lw / 2 + Math.cos((a / 16) * Math.PI * 2) * r, -lh / 2 + Math.sin((a / 16) * Math.PI * 2) * r, lw, lh)
    }
    contain(g, logo, -room / 2, -thick / 2, room, thick)
  }
  else {
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
    fitText(g, title, room, SPINE_W * 0.42)
    g.fillText(title, 0, 0)
  }
  g.restore()
  return toBlob(c)
}

// Portada de último recurso: la cabecera de la tienda sobre su propio fondo difuminado, con el logo o el título.
export async function composeCover({ title, header: headerUrl, logo: logoUrl }) {
  const [header, logo] = await Promise.all([loadImg(headerUrl), loadImg(logoUrl)])
  const [c, g] = surface(COVER_W, COVER_H), base = baseColor(header)
  g.fillStyle = rgb(base)
  g.fillRect(0, 0, COVER_W, COVER_H)
  if (header) {
    g.filter = 'blur(24px) saturate(1.3)'
    cover(g, header, -40, -40, COVER_W + 80, COVER_H + 80)
    g.filter = 'none'
    g.fillStyle = 'rgba(8,8,12,.45)'
    g.fillRect(0, 0, COVER_W, COVER_H)
    const h = Math.round((COVER_W * size(header).h) / size(header).w)
    g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 24
    g.drawImage(header, 0, 250, COVER_W, h)
    g.restore()
  }
  steamBadge(g, 0, 0, COVER_W, 70)
  g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 12
  if (logo) contain(g, logo, 50, 600, COVER_W - 100, 200)
  else {
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = '800 56px system-ui, sans-serif'
    const lines = wrapLines(title, COVER_W - 80, t => g.measureText(t).width, 3)
    lines.forEach((line, i) => g.fillText(line, COVER_W / 2, 700 + (i - (lines.length - 1) / 2) * 64, COVER_W - 60))
  }
  return toBlob(c)
}

export async function composeBack({ title, description, cover: coverUrl, logo: logoUrl, hero: heroUrl, shots: shotUrls = [], companies = [], developers = [], publishers = [] }) {
  const [art, logo, hero, firms, ...shots] = await Promise.all([loadImg(coverUrl), loadImg(logoUrl), loadImg(heroUrl), loadCompanies(companies), ...shotUrls.slice(0, 3).map(loadImg)])
  const pics = shots.filter(Boolean)
  const [c, g] = surface(BACK_W, BACK_H), base = baseColor(art), M = 54
  // Fondo: la portada muy difuminada y oscurecida.
  g.fillStyle = rgb(base)
  g.fillRect(0, 0, BACK_W, BACK_H)
  if (art) {
    g.filter = 'blur(28px) saturate(1.3)'
    cover(g, art, -60, -60, BACK_W + 120, BACK_H + 120)
    g.filter = 'none'
    g.fillStyle = 'rgba(8,8,12,.66)'
    g.fillRect(0, 0, BACK_W, BACK_H)
  }
  // Banner arriba, fundido con el fondo, y el logo encima.
  const heroH = 380, banner = hero || pics[0] || art
  if (banner) {
    cover(g, banner, 0, 0, BACK_W, heroH, banner === art ? 0.3 : 0.5)
    const fade = g.createLinearGradient(0, heroH * 0.45, 0, heroH)
    fade.addColorStop(0, 'rgba(8,8,12,0)'); fade.addColorStop(1, rgb(base.map(v => Math.round(v * 0.4)), 1))
    g.fillStyle = fade
    g.fillRect(0, 0, BACK_W, heroH + 1)
  }
  let y = heroH - 20
  g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 10
  if (logo) { const box = contain(g, logo, BACK_W * 0.2, heroH - 150, BACK_W * 0.6, 130); y = heroH - 150 + (130 + box.h) / 2 + 10 }
  else {
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
    fitText(g, title, BACK_W - 2 * M, 54, 800)
    g.fillText(title, BACK_W / 2, heroH - 40)
  }
  g.shadowBlur = 0
  // Descripción.
  y = Math.max(y, heroH) + 34
  g.fillStyle = 'rgba(255,255,255,.92)'; g.textAlign = 'left'; g.textBaseline = 'top'
  g.font = '400 27px system-ui, sans-serif'
  const lines = wrapLines(description, BACK_W - 2 * M, t => g.measureText(t).width, pics.length > 2 ? 6 : 9)
  lines.forEach((line, i) => g.fillText(line, M, y + i * 36))
  y += lines.length * 36 + (lines.length ? 30 : 0)
  // Capturas: dos arriba y la tercera abajo, junto a la ficha.
  const gap = 18, cw = (BACK_W - 2 * M - gap) / 2, ch = Math.round((cw * 9) / 16)
  const frame = (im, x, yy, w, h) => {
    g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 12
    g.fillStyle = '#000'; g.fillRect(x, yy, w, h); g.restore()
    cover(g, im, x, yy, w, h)
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.strokeRect(x, yy, w, h)
  }
  const footY = BACK_H - 104
  pics.slice(0, 2).forEach((im, i) => { if (y + ch < footY) frame(im, M + i * (cw + gap), y, cw, ch) })
  if (pics.length) y += ch + gap
  if (pics[2] && y + ch < footY) frame(pics[2], M, y, cw, ch)
  // Ficha: título y créditos.
  const x = pics[2] ? M + cw + gap : M, w = pics[2] ? cw : BACK_W - 2 * M, panelH = Math.min(ch, footY - y - 20), top = y
  if (panelH >= 110) {
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, top, w, panelH)
    g.fillStyle = '#fff'; g.textBaseline = 'top'; g.textAlign = 'left'
    fitText(g, title, w - 36, 30, 800)
    g.fillText(title, x + 18, top + 18)
    g.font = '500 21px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.78)'
    const credits = [developers.length && `Desarrolla: ${developers.join(', ')}`, publishers.length && `Distribuye: ${publishers.join(', ')}`, 'Juego para PC · Steam'].filter(Boolean)
    let line = top + 62
    for (const text of credits) {
      for (const part of wrapLines(text, w - 36, t => g.measureText(t).width, 2)) { if (line + 24 > top + panelH - 8) break; g.fillText(part, x + 18, line); line += 28 }
    }
  }
  // Franja inferior, como las de las cajas impresas: Steam a la izquierda, las empresas a la derecha.
  g.fillStyle = 'rgba(0,0,0,.72)'
  g.fillRect(0, footY, BACK_W, BACK_H - footY)
  steamBadge(g, M, footY + 20, 64, 64)
  if (firms.length) {
    const slotW = 190, slotH = 56
    firms.forEach((item, i) => drawCompany(g, item, BACK_W - M - slotW * (firms.length - i) + 10, footY + 24, slotW - 20, slotH, 'rgba(255,255,255,.9)'))
  } else {
    g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'right'; g.textBaseline = 'middle'
    fitText(g, title, BACK_W - 2 * M - 120, 24, 600)
    g.fillText(title, BACK_W - M, footY + 52)
  }
  return toBlob(c)
}

// Disco generado: el arte del juego en la etiqueta, el aro transparente del centro, el logo y el icono de Steam.
function drawDisc(g, cx, cy, R, { art, logo, title }) {
  g.save()
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip()
  if (art) { cover(g, art, cx - R, cy - R, 2 * R, 2 * R, 0.35); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(cx - R, cy - R, 2 * R, 2 * R) }
  else { g.fillStyle = '#c9ccd2'; g.fillRect(cx - R, cy - R, 2 * R, 2 * R) }
  // Reflejo irisado de la cara grabada.
  if (g.createConicGradient) {
    const rainbow = g.createConicGradient(0.6, cx, cy)
    ;['rgba(255,80,80,.10)', 'rgba(255,240,90,.12)', 'rgba(80,255,160,.10)', 'rgba(80,160,255,.12)', 'rgba(220,90,255,.10)', 'rgba(255,80,80,.10)'].forEach((c, i, all) => rainbow.addColorStop(i / (all.length - 1), c))
    g.fillStyle = rainbow; g.fillRect(cx - R, cy - R, 2 * R, 2 * R)
  }
  const shine = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
  shine.addColorStop(0, 'rgba(255,255,255,.22)'); shine.addColorStop(0.45, 'rgba(255,255,255,0)'); shine.addColorStop(1, 'rgba(255,255,255,.12)')
  g.fillStyle = shine; g.fillRect(cx - R, cy - R, 2 * R, 2 * R)
  // Logo en la mitad de abajo; la placa de Steam arriba.
  if (logo && size(logo).w > size(logo).h) { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 10; contain(g, logo, cx - R * 0.62, cy + R * 0.42, R * 1.24, R * 0.36); g.shadowBlur = 0 }
  else { g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 8; fitText(g, title, R * 1.2, R * 0.13, 800); g.fillText(title, cx, cy + R * 0.6); g.shadowBlur = 0 }
  steamBadge(g, cx - R * 0.12, cy - R * 0.72, R * 0.24, R * 0.2)
  // Centro: aro de plástico transparente y el agujero.
  const hub = g.createRadialGradient(cx, cy, R * 0.12, cx, cy, R * 0.34)
  hub.addColorStop(0, 'rgba(225,230,236,.92)'); hub.addColorStop(0.55, 'rgba(190,198,208,.75)'); hub.addColorStop(1, 'rgba(160,170,182,.55)')
  g.beginPath(); g.arc(cx, cy, R * 0.34, 0, Math.PI * 2); g.fillStyle = hub; g.fill()
  g.restore()
  g.save()
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(2, R * 0.012)
  for (const r of [R - g.lineWidth / 2, R * 0.34]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke() }
  g.restore()
}

// Interior de la caja, abierta y plana: a la izquierda la tapa por dentro, con el manual sujeto por sus pestañas,
// y a la derecha la bandeja negra con su eje dentado y el disco (el real de LaunchBox o uno generado).
export const INSIDE_W = BACK_W * 2
export async function composeInside({ title, disc: discUrl, cover: coverUrl, logo: logoUrl, art: artUrl }) {
  const [disc, art, logo, hero] = await Promise.all([loadImg(discUrl), loadImg(coverUrl), loadImg(logoUrl), loadImg(artUrl)])
  const [c, g] = surface(INSIDE_W, BACK_H)
  const plastic = x => {
    const tray = g.createRadialGradient(x + BACK_W / 2, BACK_H * 0.47, BACK_W * 0.1, x + BACK_W / 2, BACK_H * 0.47, BACK_H * 0.75)
    tray.addColorStop(0, '#1d1f23'); tray.addColorStop(1, '#08090a')
    g.fillStyle = tray; g.fillRect(x, 0, BACK_W, BACK_H)
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 6
    g.strokeRect(x + 26, 26, BACK_W - 52, BACK_H - 52)
  }
  // --- Tapa: el manual (la portada impresa en pequeño) y dos pestañas que lo sujetan.
  plastic(0)
  const bw = BACK_W * 0.8, bh = BACK_H * 0.8, bx = (BACK_W - bw) / 2, by = (BACK_H - bh) / 2
  g.save(); g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 24; g.shadowOffsetY = 6
  g.fillStyle = '#f2efe8'; g.fillRect(bx, by, bw, bh); g.restore()
  const page = hero || art
  if (page) {
    g.save(); g.beginPath(); g.rect(bx + 14, by + 14, bw - 28, bh - 28); g.clip()
    cover(g, page, bx + 14, by + 14, bw - 28, bh - 28, 0.4)
    const fade = g.createLinearGradient(0, by + bh * 0.45, 0, by + bh)
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,.75)')
    g.fillStyle = fade; g.fillRect(bx, by, bw, bh)
    g.restore()
  }
  g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 10
  if (logo) contain(g, logo, bx + bw * 0.12, by + bh * 0.62, bw * 0.76, bh * 0.2)
  else { g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, title, bw * 0.8, 52, 800); g.fillText(title, BACK_W / 2, by + bh * 0.72) }
  g.shadowBlur = 0
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 26px system-ui, sans-serif'
  g.fillText('Manual del juego', BACK_W / 2, by + bh * 0.9)
  for (const y of [by - 6, by + bh - 34]) {
    g.save(); g.fillStyle = '#16171a'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8
    g.beginPath(); if (g.roundRect) g.roundRect(BACK_W / 2 - 60, y, 120, 40, 10); else g.rect(BACK_W / 2 - 60, y, 120, 40); g.fill(); g.restore()
  }
  // --- Bandeja.
  const ox = BACK_W, cx = ox + BACK_W / 2, cy = BACK_H * 0.47, R = BACK_W * 0.44
  plastic(ox)
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 6
  g.beginPath(); g.arc(cx, cy, R + 14, 0, Math.PI * 2); g.stroke()
  g.fillStyle = 'rgba(255,255,255,.05)'
  for (const y of [BACK_H * 0.88, BACK_H * 0.92]) g.fillRect(ox + BACK_W * 0.25, y, BACK_W * 0.5, 8)
  // Eje dentado (asoma por el agujero del disco).
  g.fillStyle = '#2a2d33'
  g.beginPath(); g.arc(cx, cy, R * 0.12, 0, Math.PI * 2); g.fill()
  g.strokeStyle = '#3c4048'; g.lineWidth = 4
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.05, cy + Math.sin(a) * R * 0.05); g.lineTo(cx + Math.cos(a) * R * 0.115, cy + Math.sin(a) * R * 0.115); g.stroke() }
  // Sombra del disco y el disco.
  g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 30; g.shadowOffsetY = 8
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.arc(cx, cy, R * 0.11, 0, Math.PI * 2, true); g.fillStyle = '#000'; g.fill('evenodd')
  g.restore()
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.arc(cx, cy, R * 0.11, 0, Math.PI * 2, true); g.clip('evenodd')
  if (disc) contain(g, disc, cx - R, cy - R, 2 * R, 2 * R) // el escaneo real ya es redondo; se recorta igual por si no
  else drawDisc(g, cx, cy, R, { art, logo, title })
  g.restore()
  return toBlob(c)
}
