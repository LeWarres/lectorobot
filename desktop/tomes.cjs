// Tomos de las obras locales, como en manga-reader: qué capítulos lleva cada tomo, su portada original (MangaDex),
// su contraportada (ISBN de la Biblioteca Nacional de Japón u Open Library → imagen de Amazon) y el logo de la obra
// (Wikimedia Commons). Solo metadatos e imágenes: los mangas son los archivos locales.
// Todo queda en <dir>: cache.json (respuestas, con caducidad) y <id de MangaDex>/… (imágenes).
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const T = require('./tomes-pure.cjs')

const DAY = 24 * 3600e3
const MD = 'https://api.mangadex.org'
const NDL = 'https://ndlsearch.ndl.go.jp/api/opensearch'
const OPEN_LIBRARY = 'https://openlibrary.org/search.json'
const AMAZON = 'https://m.media-amazon.com/images/P'
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const UA = 'LectorObot/0.1 (https://github.com/LeWarres/lectorobot)'
const MD_RATINGS = ['safe', 'suggestive', 'erotica']

// ISBN de cada tomo en las listas de Wikipedia ({{Graphic novel list}}): el de la edición original y el de la licenciada
// (en inglés). Otra fuente de contraportadas cuando la NDL u Open Library no aciertan con la edición.
function parseWikiIsbns(text) {
  const out = {}
  const isbnIn = value => [...String(value || '').matchAll(/97[89][\d\- ]{10,14}\d|\b\d[\d\- ]{8,11}[\dXx]\b/g)].map(m => T.isbn10(m[0])).filter(Boolean)
  for (const block of String(text).split(/\{\{\s*Graphic novel list(?![\w/ ]*(?:header|\/))/i).slice(1)) {
    const vol = T.volKey(/\|\s*VolumeNumber\s*=\s*([^\n|<]*)/i.exec(block)?.[1])
    if (!vol || out[vol]) continue
    const field = name => isbnIn(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n]*)`, 'i').exec(block)?.[1])
    out[vol] = { original: field('OriginalISBN'), licensed: field('LicensedISBN') }
  }
  return out
}

function createTomes({ dir, fetchImpl = fetch, lang = 'es' }) {
  // ---------- Caché de respuestas: lo encontrado dura más que lo no encontrado; un fallo de red no se guarda ----------
  const file = path.join(dir, 'cache.json')
  let cache = null, saving = Promise.resolve(), saveTimer = null
  const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { cache = {} } } return cache }
  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saving = saving.then(async () => {
        await fsp.mkdir(dir, { recursive: true })
        await fsp.writeFile(file + '.tmp', JSON.stringify(cache))
        await fsp.rename(file + '.tmp', file)
      }).catch(() => {})
    }, 500)
  }
  const inflight = new Map()
  function stored(key, ttl, produce) {
    const hit = load()[key]
    if (hit && Date.now() - hit.at < (typeof ttl === 'function' ? ttl(hit.value) : ttl)) return Promise.resolve(hit.value)
    if (!inflight.has(key)) inflight.set(key, produce().then(value => { load()[key] = { at: Date.now(), value }; persist(); return value }).finally(() => inflight.delete(key)))
    return inflight.get(key)
  }

  // ---------- Red: de una en una y espaciadas con Wikipedia, Commons y la NDL (piden no insistir) ----------
  let gate = Promise.resolve()
  const turn = (ms = 1100) => { const p = gate.then(() => new Promise(r => setTimeout(r, ms))); gate = p.catch(() => {}); return p }
  // waits: esperas antes de cada reintento si el servicio pide calma (429).
  async function get(url, { json = true, waits = [3000] } = {}) {
    let r = await fetchImpl(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    for (const wait of waits) {
      if (r.status !== 429) break
      await new Promise(res => setTimeout(res, wait))
      r = await fetchImpl(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    }
    if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} respondió ${r.status}`), { status: r.status })
    return json ? r.json() : r.text()
  }
  const qs = params => {
    const s = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) s.append(k, x)
    return s
  }
  const md = async (p, params = {}) => { await turn(250); return get(`${MD}${p}${Object.keys(params).length ? `?${qs(params)}` : ''}`) }
  async function fetchImage(url) {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
    if (r.status >= 500 || r.status === 429) throw new Error('La fuente de la imagen no responde')
    if (!r.ok) return null
    const b = Buffer.from(await r.arrayBuffer())
    return b.length >= T.MIN_IMAGE && b.length <= T.MAX_IMAGE && T.imageKind(b) ? b : null
  }

  // ---------- La obra en MangaDex: por título, solo si alguno de sus títulos coincide ----------
  const mdTitles = m => [...Object.values(m.attributes?.title || {}), ...(m.attributes?.altTitles || []).flatMap(t => Object.values(t))]
  function identify(title) {
    const name = T.workTitle(title)
    return stored(`mdwork:${T.titleKey(name)}`, v => (v ? 60 * DAY : 3 * DAY), async () => {
      const r = await md('/manga', { title: name, limit: 10, 'contentRating[]': MD_RATINGS, 'order[relevance]': 'desc' })
      const hits = (r?.data || []).filter(m => mdTitles(m).some(t => T.similar(t, name)))
      // Lo oficial antes que los dōjinshi y las versiones a color, que comparten título.
      const plain = hits.filter(m => !/doujinshi|colou?r/i.test(mdTitles(m).join(' ')))
      return (plain[0] || hits[0])?.id || null
    })
  }

  // ---------- Lo que dice MangaDex: capítulo → tomo y portada de cada tomo ----------
  function mdVolumes(mdId) {
    return stored(`volumes:${mdId}:${lang}`, DAY, async () => {
      const [agg, mangaData] = await Promise.all([md(`/manga/${mdId}/aggregate`), md(`/manga/${mdId}`)])
      const byNum = {}
      const vols = Object.values(agg.volumes || {}).sort((a, b) => T.volOrder(a.volume, b.volume))
      for (const v of vols) {
        const vol = T.volKey(v.volume)
        if (!vol) continue
        const inVol = Object.values(v.chapters || {})
        const stray = /^\d/.test(vol) ? T.strayNums(inVol.map(c => c.chapter)) : new Set()
        for (const c of inVol) {
          const n = T.numKey(c.chapter)
          if (n && !byNum[n] && !stray.has(parseFloat(n))) byNum[n] = vol
        }
      }
      const records = []
      for (let offset = 0; offset < 1000; offset += 100) {
        const r = await md('/cover', { 'manga[]': [mdId], limit: 100, offset, 'order[volume]': 'asc' })
        records.push(...r.data)
        if (offset + 100 >= r.total || !r.data.length) break
      }
      const a = mangaData.data.attributes
      const pick = key => [a.title?.[key], ...(a.altTitles || []).map(t => t[key])].filter(Boolean)
      return { byNum, covers: T.pickCovers(records, lang), jaTitles: pick('ja'), enTitles: pick('en'), roTitles: pick('ja-ro'), year: a.year || null, original: a.originalLanguage || null, type: a.publicationDemographic || null }
    })
  }

  // ---------- Wikipedia: las listas de capítulos por tomo ----------
  async function wikiPages(titles) {
    if (!titles.length) return []
    await turn()
    const data = await get(`${WIKIPEDIA}?${new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', format: 'json', formatversion: '2', titles: titles.join('|') })}`)
    return (data.query?.pages || []).map(p => p.revisions?.[0]?.slots?.main?.content).filter(Boolean)
  }
  async function wikiSearch(names) {
    await turn()
    const data = await get(`${WIKIPEDIA}?${new URLSearchParams({ action: 'query', list: 'search', srsearch: `intitle:list intitle:chapters ${names[0]}`, srlimit: '10', format: 'json', formatversion: '2' })}`)
    const wanted = new Set(names.map(T.wikiKey))
    return (data.query?.search || []).map(x => x.title).filter(t => wanted.has(T.wikiKey(t.replace(/^List of /i, '').replace(/ (?:manga )?(?:chapters|volumes)$/i, '')))).slice(0, 3)
  }
  function wikiMap(key, names) {
    return stored(`wiki:${key}`, v => (Object.keys(v.map).length ? 30 * DAY : 7 * DAY), async () => {
      const titles = names.slice(0, 8).flatMap(n => [`List of ${n} chapters`, `List of ${n} manga volumes`, `List of ${n} manga chapters`]).filter(t => !/[|#<>[\]{}]/.test(t))
      let best = {}, isbns = {}
      let pages = []
      for (let i = 0; i < titles.length; i += 20) pages.push(...await wikiPages(titles.slice(i, i + 20))) // la API acepta hasta 50 títulos
      if (!pages.length) pages = await wikiPages(await wikiSearch(names)) // «SPY×FAMILY» es «Spy × Family» en Wikipedia
      for (const text of pages) {
        const subs = [...text.matchAll(/\{\{:(List of [^}|]+)\}\}/g)].map(m => m[1]).slice(0, 40) // One Piece reparte la lista en subpáginas
        let found = T.parseWikiVolumes(text), codes = parseWikiIsbns(text)
        for (let i = 0; i < subs.length; i += 10) for (const sub of await wikiPages(subs.slice(i, i + 10))) { found = { ...T.parseWikiVolumes(sub), ...found }; codes = { ...parseWikiIsbns(sub), ...codes } }
        if (Object.keys(found).length > Object.keys(best).length) { best = found; isbns = codes }
      }
      return { map: best, isbns }
    })
  }
  const wikiIsbnsByMd = new Map() // mdId → ISBN de Wikipedia por tomo (los deja list())

  // ---------- ISBN de cada tomo (NDL; si no, Open Library en inglés) ----------
  async function ndlSearch(title) {
    const pages = []
    for (let idx = 1; idx <= 501; idx += 500) {
      await turn(3000) // la NDL corta enseguida a quien pregunta seguido
      const xml = await get(`${NDL}?${new URLSearchParams({ title, mediatype: 'books', cnt: '500', idx: String(idx) })}`, { json: false, waits: [8000, 20000] })
      pages.push(xml)
      if (parseInt(/totalResults>(\d+)/.exec(xml)?.[1], 10) <= idx + 499) break
    }
    return pages
  }
  function isbnsOf(mdId) {
    return stored(`isbns:${mdId}`, v => (Object.keys(v).length ? 30 * DAY : 7 * DAY), async () => {
      const d = await mdVolumes(mdId)
      if (d.original !== 'ja' || !d.jaTitles.length) return {}
      for (const t of d.jaTitles.slice(0, 3)) {
        const found = T.pickIsbns(await ndlSearch(t), d.jaTitles, d.year)
        if (Object.keys(found).length) return found
      }
      return {}
    })
  }
  async function englishIsbns(mdId, vol) {
    const titles = (await mdVolumes(mdId)).enTitles.slice(0, 3)
    if (!titles.length) return []
    await turn()
    const data = await get(`${OPEN_LIBRARY}?${new URLSearchParams({ title: `${titles[0]}, Vol. ${vol}`, limit: '10', fields: 'title,isbn' })}`)
    return T.pickEnglishIsbns(data.docs || [], titles, vol).slice(0, 4)
  }

  // ---------- Imágenes de un tomo: thumb (256), art (512, para el arte del lomo), front (original) y back ----------
  async function fetchFace(mdId, vol, side) {
    const c = (await mdVolumes(mdId)).covers[vol]
    if (side === 'thumb' || side === 'art') return c ? fetchImage(`https://uploads.mangadex.org/covers/${mdId}/${c.file}.${side === 'thumb' ? 256 : 512}.jpg`) : null
    if (side === 'front' && c) { const b = await fetchImage(`https://uploads.mangadex.org/covers/${mdId}/${c.file}`); if (b) return b }
    const volNum = /^\d+$/.test(vol) ? vol : null
    if (!volNum) return null
    // ISBN de Wikipedia: los de esta sesión o, tras reiniciar, los guardados con la obra.
    const saved = load()[`wiki:${load()[`wikikey:${mdId}`]?.value}`]?.value?.isbns
    const wiki = (wikiIsbnsByMd.get(mdId) || saved || {})[volNum] || {}
    for (const isbn of [...new Set([...((await isbnsOf(mdId).catch(() => ({})))[volNum] || []), ...(wiki.original || [])])]) {
      const b = await fetchImage(`${AMAZON}/${isbn}.01.${side === 'back' ? 'BACK.' : ''}_SCRM_.jpg`)
      if (b) return b
    }
    if (side === 'back') for (const isbn of [...new Set([...(wiki.licensed || []), ...await englishIsbns(mdId, volNum).catch(() => [])])]) {
      const b = await fetchImage(`${AMAZON}/${isbn}.01.BACK._SCRM_.jpg`)
      if (b) return b
    }
    return null
  }
  const faceFile = (mdId, vol, side) => path.join(dir, mdId, `${crypto.createHash('sha1').update(vol).digest('hex').slice(0, 16)}-${side}.img`)
  const faceTasks = new Map()
  /** La imagen de una cara de un tomo, descargada una vez. Lo que no existe se recuerda 14 días. */
  function face(mdId, vol, side) {
    if (!T.MD_ID.test(mdId) || !T.VOL.test(vol) || !['thumb', 'art', 'front', 'back'].includes(side)) return Promise.resolve(null)
    const target = faceFile(mdId, vol, side)
    if (fs.existsSync(target)) return fsp.readFile(target)
    const key = `tome:${mdId}:${vol}:${side}`
    if (!faceTasks.has(key)) faceTasks.set(key, stored(key, 14 * DAY, async () => {
      const b = await fetchFace(mdId, vol, side)
      if (!b) return { found: false }
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target + '.tmp', b)
      await fsp.rename(target + '.tmp', target)
      return { found: true }
    }).then(() => (fs.existsSync(target) ? fsp.readFile(target) : null)).finally(() => faceTasks.delete(key)))
    return faceTasks.get(key)
  }

  // ---------- Logo de la obra (Wikimedia Commons), para el título de los lomos ----------
  let commonsRest = 0
  async function commonsGet(params) {
    if (Date.now() < commonsRest) throw new Error('Wikimedia Commons pidió esperar')
    await turn()
    const r = await fetchImpl(`${COMMONS}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' })}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    const text = r.ok ? await r.text() : ''
    if (r.status === 429 || (r.ok && !text.startsWith('{')) || /"code":\s*"maxlag"/.test(text)) commonsRest = Date.now() + 10 * 60e3
    const data = text.startsWith('{') ? JSON.parse(text) : null
    if (!data || data.error) throw new Error('No se pudo consultar Wikimedia Commons')
    return data
  }
  async function commonsLogo(names) {
    const queries = [...new Set([...names.slice(0, 3), ...names.slice(0, 1).flatMap(n => T.logoWords(n).sort((a, b) => b.length - a.length).slice(0, 1))])]
    for (const q of queries) {
      const res = await commonsGet({ action: 'query', list: 'search', srnamespace: '6', srsearch: `${q} logo`, srlimit: '15' })
      const best = T.pickLogo((res.query?.search || []).map(h => h.title), names)
      if (!best) continue
      const info = await commonsGet({ action: 'query', titles: best, prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '960' })
      const ii = info.query?.pages?.[0]?.imageinfo?.[0]
      if (ii && ii.width >= ii.height * 1.2) return ii.thumburl || ii.url || null // un logotipo es apaisado
    }
    return null
  }
  /** El logo de la obra (bytes), buscado una vez; lo no encontrado se vuelve a buscar a la semana. */
  async function logo(key, names) {
    const url = await stored(`logo:${key}`, v => (v ? 60 : 7) * DAY, () => commonsLogo(names))
    if (!url) return null
    const target = path.join(dir, 'logos', `${key}.img`)
    if (fs.existsSync(target)) return fsp.readFile(target)
    const b = await fetchImage(url)
    if (!b) return null
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, b)
    return b
  }

  // ---------- Reparto de los capítulos locales en tomos ----------
  /** chapters: [{ id, num, volume }] de una obra, en orden. Devuelve { mdId, names, vols: [{ vol, chapters: [id] }], loose: [id] }. */
  async function list(title, chapters) {
    const key = T.titleKey(T.workTitle(title))
    const mdId = await identify(title).catch(() => null)
    const data = mdId ? await mdVolumes(mdId).catch(() => null) : null
    // También la parte antes de los dos puntos: Wikipedia llama «List of Frieren chapters» a «Frieren: Beyond Journey's End».
    const full = [T.workTitle(title), title, ...(data?.enTitles || []), ...(data?.roTitles || [])].filter(Boolean)
    const names = [...new Set([...full, ...full.map(n => n.split(/\s*[:：]\s*/)[0]).filter(n => n.length >= 4)])]
    if (T.hasNoVolumes(data?.type, data?.original)) return { mdId, names, vols: [], loose: chapters.map(c => c.id) }
    const own = T.cleanVolMap(T.ownVolMap(chapters))
    let vols
    if (T.numbersRestart(chapters)) vols = chapters.map(c => T.volKey(c.volume))
    else {
      const wiki = await wikiMap(key, names).catch(() => ({ map: {}, isbns: {} }))
      if (mdId) { wikiIsbnsByMd.set(mdId, wiki.isbns); load()[`wikikey:${mdId}`] = { at: Date.now(), value: key }; persist() }
      const byNum = T.cleanVolMap(data?.byNum || {})
      vols = T.assignVolumes(chapters, T.mergeVolMaps({ wiki: T.cleanVolMap(wiki.map), md: { ...byNum, ...own } }))
    }
    vols = T.placeLoose(chapters, vols, Object.keys(data?.covers || {}))
    const groups = new Map(), loose = []
    vols.forEach((vol, i) => {
      if (!vol) return loose.push(chapters[i].id)
      if (!groups.has(vol)) groups.set(vol, [])
      groups.get(vol).push(chapters[i].id)
    })
    return { mdId, key, names, vols: [...groups.keys()].sort(T.volOrder).map(vol => ({ vol, chapters: groups.get(vol), cover: Boolean(data?.covers[vol]) })), loose }
  }

  return { list, face, logo, identify, mdVolumes, wikiMap }
}

module.exports = { createTomes, parseWikiIsbns }
