// Mangas y cómics locales: qué obra, capítulo y tomo es cada archivo (ComicInfo.xml, el nombre o su carpeta),
// las carpetas de la biblioteca y cómo se agrupan en obras con tomos para el estante. Todo sin red.
const fs = require('node:fs/promises')
const path = require('node:path')
const yauzl = require('yauzl')

const COMIC = /\.(cbz|cbr|zip|pdf)$/i
const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i

const decode = text => String(text).replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()]
  ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))))
const field = (xml, name) => { const m = String(xml).match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i')); return m ? decode(m[1]).trim() : '' }

/** Lo que interesa del ComicInfo.xml (el formato de ComicRack, Kavita, Komga y Mihon). */
function parseComicInfo(xml) {
  const manga = field(xml, 'Manga').toLowerCase()
  return {
    series: field(xml, 'Series') || null,
    number: field(xml, 'Number') || null,
    volume: field(xml, 'Volume') || null,
    title: field(xml, 'Title') || null,
    rtl: manga === 'yesandrighttoleft' ? true : manga === 'no' ? false : null,
    pages: Number(field(xml, 'PageCount')) || null
  }
}

// El ComicInfo.xml (si lo hay) y cuántas páginas tiene un CBZ, sin descomprimir las imágenes.
function readZipInfo(file) {
  return new Promise(resolve => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return resolve({ info: null, pages: 0 })
      let pages = 0, info = null, waiting = false, ended = false
      const done = () => { if (ended && !waiting) { zip.close(); resolve({ info, pages }) } }
      zip.on('error', () => resolve({ info, pages }))
      zip.on('end', () => { ended = true; done() })
      zip.on('entry', entry => {
        if (IMAGE.test(entry.fileName)) pages++
        if (/(^|\/)comicinfo\.xml$/i.test(entry.fileName) && entry.uncompressedSize < 1024 * 1024) {
          waiting = true
          zip.openReadStream(entry, (err, stream) => {
            if (err) { waiting = false; zip.readEntry(); return }
            const chunks = []
            stream.on('data', c => chunks.push(c))
            stream.on('end', () => { info = parseComicInfo(Buffer.concat(chunks).toString('utf8')); waiting = false; zip.readEntry(); done() })
            stream.on('error', () => { waiting = false; zip.readEntry() })
          })
          return
        }
        zip.readEntry()
      })
      zip.readEntry()
    })
  })
}

const CHAPTER_ONLY = /^(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|ep\.?|c|#)?\s*\d+(?:\.\d+)?$/i
/** Obra, capítulo y tomo según el nombre del archivo; si el nombre es solo «Capítulo 12», la obra es su carpeta. */
function guessFromName(file) {
  const name = path.basename(file, path.extname(file)).replace(/[_]+/g, ' ').replace(/\s*[[(][^\])]*[\])]\s*/g, ' ').replace(/\s+/g, ' ').trim()
  const volume = name.match(/(?:\bvol(?:umen|ume)?\.?|\btomo|\bv)\s*0*(\d+(?:\.\d+)?)/i)?.[1] || null
  let number = name.match(/(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|ep\.?|\bc|#)\s*0*(\d+(?:\.\d+)?)/i)?.[1] || null
  number ??= name.replace(/(?:\bvol(?:umen|ume)?\.?|\btomo|\bv)\s*\d+(?:\.\d+)?/gi, '').match(/(\d+(?:\.\d+)?)\s*$/)?.[1]?.replace(/^0+(?=\d)/, '') || null
  const folder = path.basename(path.dirname(file))
  let series = name
    .replace(/(?:\bvol(?:umen|ume)?\.?|\btomo|\bv)\s*\d+(?:\.\d+)?/gi, '')
    .replace(/(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|ep\.?|\bc|#)\s*\d+(?:\.\d+)?.*$/i, '')
    .replace(/[\s\-–:.]*\d+(?:\.\d+)?\s*$/, '')
    .replace(/[\s\-–:.]+$/, '').replace(/\s+/g, ' ').trim()
  if (!series || CHAPTER_ONLY.test(name)) series = folder
  return { series: series || null, number, volume }
}

/** Todo lo que se sabe de un archivo: el ComicInfo manda y el nombre completa lo que falte. */
async function describe(file) {
  const guess = guessFromName(file)
  const { info, pages } = /\.(cbz|zip)$/i.test(file) ? await readZipInfo(file) : { info: null, pages: 0 }
  const series = info?.series || guess.series, number = info?.number || guess.number, volume = info?.volume || guess.volume
  const label = number ? `Capítulo ${number}` : volume ? `Tomo ${volume}` : null
  return {
    series, number, volume, pages: pages || info?.pages || null, rtl: info?.rtl ?? null,
    title: series && label ? `${series} · ${label}${info?.title ? ` — ${info.title}` : ''}` : path.basename(file, path.extname(file))
  }
}

/** Los cómics de una carpeta y sus subcarpetas (sin las ocultas, como .hd). */
async function scanFolder(dir, depth = 8) {
  const out = []
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && depth > 0) out.push(...await scanFolder(full, depth - 1))
    else if (entry.isFile() && COMIC.test(entry.name)) out.push(full)
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

const seriesKey = name => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : Infinity }
const order = (a, b) => num(a.volume) - num(b.volume) || num(a.number) - num(b.number) || String(a.title).localeCompare(String(b.title), undefined, { numeric: true })

/** Agrupa los libros en obras para el estante. Una obra con dos o más archivos lleva tomos: los del ComicInfo (<Volume>)
 *  o, si no los dice, uno por archivo (cada capítulo es un tomo fino). Lo demás sigue como libro suelto. El orden es el de
 *  la biblioteca (la primera aparición de cada obra). chapterId: el último que se ha leído, para poner ese tomo de frente. */
function groupWorks(books) {
  const series = new Map(), items = []
  for (const book of books) {
    const key = book.type !== 'steam' && book.series ? seriesKey(book.series) : ''
    if (!key) { items.push({ kind: 'book', id: book.id }); continue }
    if (!series.has(key)) { const group = { kind: 'series', id: `series:${key}`, title: book.series, books: [] }; series.set(key, group); items.push(group) }
    series.get(key).books.push(book)
  }
  const out = []
  for (const item of items) {
    if (item.kind === 'book') { out.push(item); continue }
    if (item.books.length < 2) { out.push({ kind: 'book', id: item.books[0].id }); continue }
    const sorted = [...item.books].sort(order), vols = []
    const withVolume = sorted.some(b => b.volume)
    for (const book of sorted) {
      const label = withVolume && book.volume ? String(book.volume).replace(/^0+(?=\d)/, '') : String(book.number ?? vols.length + 1)
      const last = vols.at(-1)
      if (withVolume && book.volume && last?.vol === label && last.byVolume) { last.chapters.push(book.id); last.pages = last.pages && book.pages ? last.pages + book.pages : null }
      else vols.push({ vol: label, byVolume: Boolean(withVolume && book.volume), chapters: [book.id], pages: book.pages || null })
    }
    const read = sorted.filter(b => b.readAt).sort((a, b) => b.readAt - a.readAt)[0]
    out.push({ kind: 'series', id: item.id, title: item.title, chapters: sorted.map(b => b.id), chapterId: read?.id || null,
      vols: vols.map(({ byVolume, ...v }) => ({ ...v, label: byVolume ? `Tomo ${v.vol}` : `Capítulo ${v.vol}` })) })
  }
  return out
}

module.exports = { parseComicInfo, readZipInfo, guessFromName, describe, scanFolder, groupWorks, seriesKey, COMIC }
