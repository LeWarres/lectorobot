#!/usr/bin/env node
// Exporta a CBZ los capítulos que la webapp Manga Reader guardó «en este dispositivo» (la caché del service
// worker de Brave/Chrome), para tener mangas de prueba en Manga Desktop.
//
//   node tools/brave-cache-a-cbz.cjs --origin https://tu-servidor-de-manga [carpeta-de-salida] [--cache <carpeta>]
//
// Sin --cache busca en el perfil por defecto de Brave (Linux y Windows) las cachés con páginas de ese origen.
// Solo lee la caché; conviene cerrar la app web antes para no leer una entrada a medio escribir.
// Salida: <salida>/<Título>/Capitulo NNNN.cbz (páginas 001.jpg…, ComicInfo.xml) y cover.jpg.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')

// Entrada de la caché «simple» de Chromium (archivo <hash>_0): cabecera de 24 bytes (número mágico, versión,
// largo de la clave, hash), la clave (la URL) y el cuerpo de la respuesta, que acaba en un registro EOF.
const HEADER_MAGIC = Buffer.from('305c72a71b6dfbfc', 'hex'), EOF_MAGIC = Buffer.from('d8410d97456ffaf4', 'hex')
function readEntry(file) {
  const b = fs.readFileSync(file)
  if (b.length < 24 || !b.subarray(0, 8).equals(HEADER_MAGIC)) return null
  const keyLength = b.readUInt32LE(12), key = b.subarray(24, 24 + keyLength).toString('utf8'), end = b.indexOf(EOF_MAGIC, 24 + keyLength)
  if (end < 0) return null
  return { key, body: b.subarray(24 + keyLength, end) }
}

function braveCaches(origin) {
  const profiles = [
    path.join(os.homedir(), '.config', 'BraveSoftware', 'Brave-Browser', 'Default'),
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default')
  ]
  const found = []
  for (const profile of profiles) {
    const root = path.join(profile, 'Service Worker', 'CacheStorage')
    let origins
    try { origins = fs.readdirSync(root) } catch { continue }
    for (const o of origins) {
      let caches
      try { caches = fs.readdirSync(path.join(root, o)) } catch { continue }
      for (const c of caches) {
        const dir = path.join(root, o, c)
        let files
        try { files = fs.readdirSync(dir).filter(f => f.endsWith('_0')) } catch { continue }
        if (files.some(f => readEntry(path.join(dir, f))?.key.startsWith(`${origin}/api/local/`))) found.push(dir)
      }
    }
  }
  return found
}

const imageType = buf => buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' ? 'webp'
  : buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG' ? 'png' : buf.subarray(0, 3).toString() === 'GIF' ? 'gif' : buf.subarray(4, 12).toString().startsWith('ftypavi') ? 'avif' : null
const xml = text => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]))
const safeName = text => String(text).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sin título'

function exportCache(dirs, out, origin) {
  const mangas = new Map(), chapters = new Map(), pages = new Map()
  for (const dir of dirs) for (const file of fs.readdirSync(dir).filter(f => f.endsWith('_0'))) {
    const entry = readEntry(path.join(dir, file))
    if (!entry || !entry.key.startsWith(origin)) continue
    const url = new URL(entry.key), p = decodeURIComponent(url.pathname)
    let m
    if ((m = p.match(/^\/api\/manga\/(.+)$/))) { try { mangas.set(m[1], JSON.parse(entry.body)) } catch {} }
    else if ((m = p.match(/^\/api\/chapter\/(.+)$/))) { try { chapters.set(m[1], JSON.parse(entry.body)) } catch {} }
    else if ((m = p.match(/^\/api\/local\/(.+)\/(\d+)$/)) && imageType(entry.body)) {
      if (!pages.has(m[1])) pages.set(m[1], new Map())
      pages.get(m[1]).set(Number(m[2]), entry.body)
    }
  }
  const report = [], covers = new Map() // carpeta → primera página del capítulo más bajo
  for (const [chapterId, got] of pages) {
    const mangaId = chapterId.slice(0, chapterId.lastIndexOf('~')), data = mangas.get(mangaId)
    const info = data?.chapters?.find(c => c.id === chapterId), title = data?.manga?.title || mangaId.split('~').pop()
    const num = info?.num ?? chapterId.split('~').pop()
    // Las páginas esperadas salen de la lista del capítulo; sin ella, se toman las que haya.
    const expected = (chapters.get(chapterId)?.pages || []).length || Math.max(...got.keys()) + 1
    const missing = []
    for (let i = 0; i < expected; i++) if (!got.has(i)) missing.push(i)
    const folder = path.join(out, safeName(title)), padded = String(num).replace(/^(\d+)/, n => n.padStart(4, '0'))
    fs.mkdirSync(folder, { recursive: true })
    const zip = new AdmZip(), order = [...got.keys()].sort((a, b) => a - b)
    order.forEach((index, i) => {
      const name = `${String(i + 1).padStart(3, '0')}.${imageType(got.get(index))}`
      zip.addFile(name, got.get(index))
      zip.getEntry(name).header.method = 0 // las imágenes ya van comprimidas
    })
    zip.addFile('ComicInfo.xml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>${xml(title)}</Series>
  <Number>${xml(num)}</Number>${info?.title ? `\n  <Title>${xml(info.title)}</Title>` : ''}${info?.volume ? `\n  <Volume>${xml(info.volume)}</Volume>` : ''}
  <PageCount>${order.length}</PageCount>
  <LanguageISO>es</LanguageISO>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>
`))
    zip.writeZip(path.join(folder, `Capitulo ${padded}.cbz`))
    const best = covers.get(folder)
    if (!best || Number(num) < best.num) covers.set(folder, { num: Number(num), image: got.get(order[0]) })
    report.push({ title, num, pages: order.length, missing })
  }
  // Portada: la primera página del primer capítulo, en su formato (cover.jpg, cover.webp…).
  for (const [folder, { image }] of covers) {
    for (const old of fs.readdirSync(folder).filter(f => /^cover\.\w+$/.test(f))) fs.rmSync(path.join(folder, old))
    fs.writeFileSync(path.join(folder, `cover.${imageType(image)}`), image)
  }
  return report.sort((a, b) => a.title.localeCompare(b.title) || Number(a.num) - Number(b.num))
}

if (require.main === module) {
  const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null }
  const origin = (opt('--origin') || process.env.MANGA_READER_URL || '').replace(/\/$/, ''), cache = opt('--cache')
  if (!/^https?:\/\//.test(origin)) { console.error('Indica la dirección de la webapp: --origin https://tu-servidor (o MANGA_READER_URL).'); process.exit(1) }
  const out = path.resolve(args[0] || 'mangas-prueba')
  const dirs = cache ? [cache] : braveCaches(origin)
  if (!dirs.length) { console.error(`No se encontró ninguna caché de ${origin} en Brave.`); process.exit(1) }
  const report = exportCache(dirs, out, origin)
  for (const r of report) console.log(`${r.title} · capítulo ${r.num}: ${r.pages} páginas${r.missing.length ? ` (faltan ${r.missing.length}: ${r.missing.join(', ')})` : ''}`)
  console.log(`${report.length} capítulos en ${out}`)
}

module.exports = { readEntry, exportCache, imageType }
