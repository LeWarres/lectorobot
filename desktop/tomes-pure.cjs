// Funciones de cálculo de tomos portadas tal cual de manga-reader (app/volumes.js): reparto capítulo → tomo a partir
// de varias fuentes, limpieza, estimación de lo que falta, ISBN de la NDL / Open Library, portadas de MangaDex y
// elección del logo. Sin red: quien llama hace las consultas (desktop/tomes.cjs).
// Tomos: qué capítulos forman cada tomo y sus cubiertas originales.
// - Reparto, capítulo a capítulo: lista de Wikipedia, MangaDex (la edición con más datos), MangaUpdates y M440. Ninguna basta: MangaDex
//   pierde los capítulos licenciados y M440 mete lo reciente en un tomo cajón. Cada una se limpia y se contrasta con las demás.
// - Portada: /cover de MangaDex, a tamaño original (prefiere la edición japonesa).
// - Contraportada: la Biblioteca Nacional de Japón (NDL) da el ISBN de cada tomo y Amazon sirve la imagen por ISBN.
//   Si la edición japonesa no la tiene, se prueba la inglesa (ISBN por Open Library).
// Lo descargado queda en <DATA_DIR>/tomes/<id de MangaDex>/<tomo>-<cara>.img.

const DAY = 24 * 3600e3
const NDL = 'https://ndlsearch.ndl.go.jp/api/opensearch'
const OPEN_LIBRARY = 'https://openlibrary.org/search.json'
const AMAZON = 'https://m.media-amazon.com/images/P'
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php'
const MAX_IMAGE = 30 * 1024 * 1024
const MIN_IMAGE = 8000 // por debajo son el píxel transparente o una miniatura de Amazon
const VOL = /^[\p{L}\p{N}._-]{1,16}$/u
const MD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// "01" -> "1", "1.50" -> "1.5", "Vol. 3" no es un número y se queda igual.
const volKey = v => {
  const s = String(v ?? '').trim()
  if (!s || s.toLowerCase() === 'none') return null
  return /^\d+(\.\d+)?$/.test(s) ? String(parseFloat(s)) : s
}
const numKey = n => { const f = parseFloat(n); return Number.isFinite(f) ? String(f) : null }
const volOrder = (a, b) => (parseFloat(a) || Infinity) - (parseFloat(b) || Infinity) || String(a).localeCompare(String(b))

// Título comparable: sin signos, espacios ni diferencias de anchura.
const titleKey = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
function ndlVolume(s) {
  const m = /^(?:vol\.?|第)?\s*(\d{1,4})\s*巻?$/i.exec(String(s || '').normalize('NFKC').trim())
  return m ? String(parseInt(m[1], 10)) : null
}
function isbn10(raw) {
  const s = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase()
  if (/^\d{9}[\dX]$/.test(s)) return s
  if (!/^978\d{10}$/.test(s)) return null
  const body = s.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(body[i])
  const c = (11 - (sum % 11)) % 11
  return body + (c === 10 ? 'X' : String(c))
}
const xmlText = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()

// De los registros de la NDL, los tomos de esta obra: mismo título exacto, tomo numérico, clasificado como manga y del
// autor con más tomos. Si el primer tomo sale muy lejos del año de la obra, es otra obra con el mismo título.
function pickIsbns(xmlPages, titles, year) {
  const keys = new Set(titles.map(titleKey).filter(Boolean))
  const groups = new Map()
  for (const xml of xmlPages) {
    for (const [, it] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      if (!keys.has(titleKey(xmlText(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(it)?.[1])))) continue
      const vol = ndlVolume(xmlText(/<dcndl:volume>([\s\S]*?)<\/dcndl:volume>/.exec(it)?.[1]))
      if (!vol) continue
      const isbns = [...it.matchAll(/xsi:type="dcndl:ISBN">([^<]+)</g)].map(m => isbn10(m[1])).filter(Boolean)
      if (!isbns.length) continue
      const author = titleKey(xmlText(/<author>([\s\S]*?)<\/author>/.exec(it)?.[1]).split(/[, ]/)[0]) || '?'
      const when = parseInt(/<dc:date[^>]*>(\d{4})/.exec(it)?.[1], 10) || null
      if (!groups.has(author)) groups.set(author, new Map())
      const g = groups.get(author)
      if (!g.has(vol)) g.set(vol, { isbns: [], when })
      const e = g.get(vol)
      for (const i of isbns) if (!e.isbns.includes(i)) e.isbns.push(i)
      if (when && (!e.when || when < e.when)) e.when = when
    }
  }
  const firstYear = g => Math.min(...[...g.values()].map(e => e.when || Infinity))
  const best = [...groups.values()]
    .filter(g => !year || !Number.isFinite(firstYear(g)) || Math.abs(firstYear(g) - year) <= 3)
    .sort((a, b) => b.size - a.size)[0]
  if (!best) return {}
  return Object.fromEntries([...best].map(([v, e]) => [v, e.isbns]))
}

// Open Library: solo el título exacto seguido del tomo («Berserk of Gluttony, Vol. 1» no es Berserk) y solo ISBN en inglés.
// Ediciones de varios tomos y otros libros: su contraportada no es la de este tomo. One Piece "Vol. 1 (Romance Dawn /
// Buggy the Clown / Don't Get Fooled Again)" es en realidad el ómnibus East Blue 1-2-3.
const SEVERAL_VOLUMES = /omnibus|ómnibus|\d\s*-?\s*in\s*-?\s*\d|\d\s*[-–&]\s*\d|\s\/\s|box(ed)? set|collection|coloring|how to draw/
function pickEnglishIsbns(docs, titles, vol) {
  const out = []
  for (const title of titles) {
    const esc = titleLower(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^${esc}[,:]?\\s*(?:vol(?:ume)?\\.?\\s*)?0*${vol}(?:\\D|$)`)
    for (const d of docs) {
      if (!re.test(titleLower(d.title)) || SEVERAL_VOLUMES.test(titleLower(d.title))) continue
      for (const x of d.isbn || []) {
        const i = isbn10(x)
        if (i && /^[01]/.test(i) && !out.includes(i)) out.push(i)
      }
    }
  }
  return out
}
const titleLower = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

// Una por tomo: la japonesa, si no la del idioma de lectura, luego la inglesa y luego cualquiera.
function pickCovers(records, lang) {
  const rank = l => { const i = ['ja', lang, 'en'].indexOf(l); return i < 0 ? 9 : i }
  const out = {}
  for (const r of records) {
    const vol = volKey(r.attributes?.volume), file = r.attributes?.fileName, l = r.attributes?.locale
    if (!vol || !file) continue
    if (!out[vol] || rank(l) < rank(out[vol].locale)) out[vol] = { file, locale: l }
  }
  return out
}

function imageKind(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

/** MangaDex trae errores de quien subió cada capítulo: el 232 en el tomo 1 de Chainsaw Man, por ejemplo.
 *  Devuelve los números que quedan lejos del resto de su tomo. Con menos de 3 no hay con qué comparar. */
function strayNums(nums) {
  const known = nums.map(parseFloat).filter(Number.isFinite).sort((a, b) => a - b)
  if (known.length < 3) return new Set()
  const middle = a => (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2
  const center = middle(known)
  const spread = middle(known.map(n => Math.abs(n - center)).sort((a, b) => a - b))
  const limit = Math.max(4 * spread, 5)
  const far = known.filter(n => Math.abs(n - center) > limit)
  return new Set(far.length > Math.max(1, known.length * 0.15) ? [] : far) // varios lejos: es la numeración de la obra (Berserk)
}

/** Un mapa capítulo -> tomo sin lo que no es fiable: capítulos fuera de sitio y tomos cajón, mucho mayores que los demás. */
function cleanVolMap(map) {
  const byVol = new Map()
  for (const [n, v] of Object.entries(map)) byVol.set(v, [...(byVol.get(v) || []), n])
  const whole = nums => new Set(nums.map(n => Math.floor(parseFloat(n)))).size // el 2 y el 2.2 son un capítulo partido
  const sizes = [...byVol.values()].map(whole).sort((a, b) => a - b)
  const usual = sizes[(sizes.length - 1) >> 1]
  const out = {}
  for (const [v, nums] of byVol) {
    const size = whole(nums)
    if (size >= 40 || (size >= 20 && (sizes.length === 1 || size > 3 * usual))) continue
    const stray = /^\d/.test(v) ? strayNums(nums) : new Set()
    for (const n of nums) if (!stray.has(parseFloat(n))) out[n] = v
  }
  return out
}

/** ¿Dos fuentes dan el mismo reparto donde coinciden? Si numeran distinto (Berserk en Wikipedia), no. */
function volMapsAgree(a, b) {
  const shared = Object.keys(a).filter(n => n in b)
  if (shared.length < 5) return true
  return shared.filter(n => a[n] === b[n]).length / shared.length >= 0.6
}

/** Junta las fuentes por orden de preferencia; cada una solo rellena lo que falta. */
function mergeVolMaps({ wiki = {}, md = {}, mu = {}, mi = {} }) {
  const merged = {}
  // M440 acierta más que las anotaciones de MangaUpdates, salvo si le falta un tomo en medio: suele haberlo unido al anterior.
  const shown = new Set(Object.values(mi).map(Number))
  const inMu = new Set(Object.values(mu).map(Number))
  const miHasHole = [...inMu].some(v => !shown.has(v) && v < Math.max(...shown))
  for (const src of [volMapsAgree(wiki, md) ? wiki : {}, md, ...(miHasHole ? [mu, mi] : [mi, mu])]) {
    if (!volMapsAgree(src, merged)) continue
    for (const [n, v] of Object.entries(src)) if (!(n in merged)) merged[n] = v
  }
  return merged
}

/** Publicaciones de MangaUpdates: cada grupo anota, a veces, el tomo de lo que publica ("35a", "12-14"). Si discrepan, gana la mayoría. */
function parseMuVolumes(rows) {
  const votes = {}
  for (const { volume, chapter } of rows) {
    const vol = /^\s*0*([1-9]\d{0,3})\s*$/.exec(String(volume ?? ''))?.[1]
    if (!vol) continue
    const ch = String(chapter ?? '').trim()
    const one = /^(\d+(?:\.\d+)?)[a-z]?$/i.exec(ch)
    const range = /^(\d+(?:\.\d+)?)[a-z]?\s*-\s*(\d+(?:\.\d+)?)[a-z]?$/i.exec(ch)
    const nums = one ? [parseFloat(one[1])] : []
    if (range) {
      const [lo, hi] = [parseFloat(range[1]), parseFloat(range[2])]
      if (hi >= lo && hi - lo < 50) {
        nums.push(lo, hi)
        for (let k = Math.ceil(lo); k <= hi; k++) nums.push(k)
      }
    }
    for (const n of new Set(nums)) {
      const count = (votes[n] ||= {})
      count[vol] = (count[vol] || 0) + 1
    }
  }
  const map = {}
  for (const [n, count] of Object.entries(votes)) map[n] = Object.keys(count).reduce((a, b) => (count[b] > count[a] ? b : a))
  return map
}

/** Lo aprovechable de las anotaciones de MangaUpdates: sin lo que rompe el orden de los tomos. Si no incluyen el tomo 1, solo valen
 *  si cubren al menos una cuarta parte de los capítulos (si no, son anotaciones sueltas). */
function orderedMuMap(map, total = 0) {
  const nums = Object.keys(map).sort((a, b) => parseFloat(a) - parseFloat(b))
  const vol = nums.map(n => parseInt(map[n], 10))
  // La subsecuencia no decreciente más larga.
  const len = vol.map(() => 1), from = vol.map(() => -1)
  let end = 0
  vol.forEach((v, i) => {
    for (let k = 0; k < i; k++) if (vol[k] <= v && len[k] + 1 > len[i]) { len[i] = len[k] + 1; from[i] = k }
    if (len[i] > len[end]) end = i
  })
  const out = {}
  for (let i = nums.length ? end : -1; i >= 0; i = from[i]) out[nums[i]] = map[nums[i]]
  const size = Object.keys(out).length
  return Object.values(out).includes('1') || (total && size >= total / 4) ? out : {}
}

/** MangaUpdates apunta el tomo de unos pocos capítulos. Se completa lo que queda claro entre dos de ellos:
 *  antes del primero, si es el tomo 1; entre dos del mismo tomo; y tras un extra (5.5, el cierre de su tomo) si después viene el tomo siguiente. */
function fillVolGaps(map, nums) {
  const anchors = Object.keys(map).map(parseFloat).sort((a, b) => a - b)
  const out = { ...map }
  for (const key of nums) {
    if (key == null || key in map) continue
    const n = parseFloat(key)
    const prev = anchors.filter(a => a < n).at(-1)
    const next = anchors.find(a => a > n)
    if (next === undefined) continue
    const after = map[next]
    if (prev === undefined) {
      if (after === '1' && n >= 1) out[key] = after // el capítulo 0 no suele ser parte del tomo
      continue
    }
    const before = map[prev]
    if (before === after ? next - prev <= 5 : !Number.isInteger(prev) && parseInt(after, 10) === parseInt(before, 10) + 1 && next - prev <= 15) out[key] = after
  }
  return out
}

const ownVolMap = chapters => {
  const map = {}
  for (const c of chapters) {
    const n = numKey(c.num), v = volKey(c.volume)
    if (n && v && !(n in map)) map[n] = v
  }
  return map
}

/** Numeración que vuelve a empezar en cada tomo: el número no identifica el capítulo y solo vale su propio tomo. */
function numbersRestart(chapters) {
  const seen = new Map()
  let repeated = 0
  for (const c of chapters) {
    const n = numKey(c.num), v = volKey(c.volume)
    if (!n || !v) continue
    if (seen.has(n) && seen.get(n) !== v) repeated++
    else seen.set(n, v)
  }
  return repeated >= 3
}

/** El tomo de cada capítulo, en el orden de la lista (de menor a mayor). Un extra (7.5) va con el capítulo al que sigue,
 *  y lo que no tiene tomo entre dos del mismo se queda con ellos, para que el libro no se salte nada. */
function assignVolumes(chapters, map = {}) {
  const vols = chapters.map(c => map[numKey(c.num)] ?? null)
  vols.forEach((v, i) => {
    const n = parseFloat(chapters[i].num)
    if (!v && i && vols[i - 1] && !Number.isInteger(n) && Math.floor(n) === Math.floor(parseFloat(chapters[i - 1].num))) vols[i] = vols[i - 1]
  })
  let last = -1
  vols.forEach((v, i) => {
    if (!v) return
    if (last >= 0 && vols[last] === v && i - last <= 4) for (let k = last + 1; k < i; k++) vols[k] = v // un hueco grande no se sabe qué tiene
    last = i
  })
  return vols
}

/** Quita el tomo a los capítulos mal etiquetados: un tramo corto cuyo tomo rompe el orden, y sin él los de alrededor quedan en orden
 *  (T14, T13, T15). Si no se arregla al quitarlo, es que la obra numera así: Berserk recorre los tomos 1-5 con el prólogo (0.01-0.2) y vuelve al T1 con el capítulo 1. */
function dropMisplaced(vols, maxRun = 3) {
  const out = [...vols]
  if (!vols.every(v => !v || /^\d+$/.test(v))) return out
  const runsOf = () => {
    const runs = []
    out.forEach((v, i) => {
      if (!v) return
      if (runs.at(-1)?.v === parseInt(v, 10)) runs.at(-1).at.push(i)
      else runs.push({ v: parseInt(v, 10), at: [i] })
    })
    return runs
  }
  // De uno en uno y primero el más corto: al quitar un tramo, sus vecinos dejan de parecer mal puestos.
  for (;;) {
    const runs = runsOf()
    const wrong = runs.filter((r, j) => {
      if (r.at.length > maxRun) return false
      const [a, b] = [runs[j - 1], runs[j + 1]]
      if (a && b) return a.v <= b.v && (r.v < a.v || r.v > b.v)
      const near = a || b
      return near && r.at.length < near.at.length && (a ? r.v < a.v : r.v > b.v)
    })
    if (!wrong.length) return out
    const hit = wrong.reduce((x, y) => (y.at.length < x.at.length ? y : x))
    for (const i of hit.at) out[i] = null
  }
}

/** Estima el tomo de lo que ninguna fuente sitúa: solo pueden quedar sin tomo los capítulos del final que no quepan en un tomo conocido.
 *  known: los tomos que se sabe que existen (tienen portada), aunque no se sepa qué capítulos llevan. */
function placeLoose(chapters, vols, known = []) {
  const out = dropMisplaced(vols)
  const isNum = v => /^\d+$/.test(v ?? '')
  const floorOf = i => Math.floor(parseFloat(chapters[i].num))
  // Un corte no separa un capítulo de sus partes o su extra (5 y 5.5).
  const cut = i => { while (i > 0 && i < chapters.length && floorOf(i) === floorOf(i - 1)) i++; return i }
  const spread = (from, to, names) => {
    let start = from
    names.forEach((name, j) => {
      const end = j === names.length - 1 ? to : Math.min(to, cut(from + Math.round((to - from) * (j + 1) / names.length)))
      for (let i = start; i < end; i++) out[i] = name
      start = Math.max(start, end)
    })
  }
  const last = known.filter(isNum).reduce((a, v) => Math.max(a, parseInt(v, 10)), 0)
  const assigned = out.flatMap((v, i) => (v ? [i] : []))
  if (!assigned.length) {
    if (last && chapters.length >= last * 2) spread(0, chapters.length, Array.from({ length: last }, (_, i) => String(i + 1)))
    return out
  }
  const count = {}
  for (const i of assigned) count[out[i]] = (count[out[i]] || 0) + 1
  const sizes = Object.values(count).sort((a, b) => a - b)
  const usual = Math.max(1, sizes[(sizes.length - 1) >> 1])
  const between = (a, b) => { // los tomos que aún no tienen capítulos en ese tramo de números
    const free = []
    for (let k = a + 1; k < b; k++) if (!count[k]) free.push(String(k))
    return free
  }
  // Antes del primer tomo.
  const first = assigned[0]
  if (first) {
    const head = out[first]
    const free = isNum(head) ? between(0, parseInt(head, 10)) : []
    const n = Math.min(free.length, Math.round(first / usual))
    if (n) spread(0, first, free.slice(-n))
    else for (let i = 0; i < first; i++) out[i] = head
  }
  // Entre dos tomos.
  for (let a = 0; a < assigned.length - 1; a++) {
    const [l, r] = [assigned[a], assigned[a + 1]]
    if (r - l < 2) continue
    const [left, right] = [out[l], out[r]]
    const free = isNum(left) && isNum(right) ? between(parseInt(left, 10), parseInt(right, 10)) : []
    if (free.length) {
      // Se igualan también los dos tomos de los lados: suelen venir de datos parciales (T1 con 4 capítulos, T3 con 1).
      const per = (count[left] + count[right] + r - l - 1) / (free.length + 2)
      const from = cut(l + 1 + Math.max(0, Math.round(per - count[left])))
      const to = Math.max(from, r - Math.max(0, Math.round(per - count[right])))
      for (let i = l + 1; i < from; i++) out[i] = left
      for (let i = to; i < r; i++) out[i] = right
      spread(from, to, free)
      count[left] += from - l - 1
      count[right] += r - to
      continue
    }
    if (left === right || !isNum(left) || !isNum(right) || parseInt(right, 10) < parseInt(left, 10)) {
      for (let i = l + 1; i < r; i++) out[i] = left
      continue
    }
    // Dos tomos seguidos: el corte que más los iguala. Si hay un extra, cierra tomo: se corta justo después.
    const whole = []
    for (let i = l + 1; i <= r; i++) if (floorOf(i) !== floorOf(i - 1)) whole.push(i)
    if (!whole.length) whole.push(r) // todo es del capítulo del tomo de la izquierda
    const closes = whole.filter(i => i > l + 1 && !Number.isInteger(parseFloat(chapters[i - 1].num)))
    const score = i => Math.abs((count[left] + i - l - 1) - (count[right] + r - i))
    const at = (closes.length ? closes : whole).reduce((x, y) => (score(y) < score(x) ? y : x))
    for (let i = l + 1; i < r; i++) out[i] = i < at ? left : right
    count[left] += at - l - 1
    count[right] += r - at
  }
  // Tras el último: solo en tomos que existen. Lo que no quepa se queda sin tomo.
  const end = assigned.at(-1)
  const free = isNum(out[end]) ? between(parseInt(out[end], 10), last + 1) : []
  const rest = chapters.length - end - 1
  if (free.length && rest) {
    const fits = rest <= free.length * usual * 1.3
    spread(end + 1, fits ? chapters.length : cut(end + 1 + free.length * usual), free)
  }
  return out
}

/** Cuántos elementos tiene {{Numbered list|start=N|a|b|c}}: las barras de primer nivel, sin contar las de sus plantillas. */
function numberedListCount(text, from) {
  let depth = 0, bars = 0
  for (let i = from; i < text.length - 1; i++) {
    const two = text.slice(i, i + 2)
    if (two === '{{' || two === '[[') { depth++; i++ } else if (two === '}}' || two === ']]') {
      if (--depth < 0) break
      i++
    } else if (text[i] === '|' && depth === 0) bars++
  }
  return bars
}

/** Listas de capítulos de Wikipedia ({{Graphic novel list}}). Cada página numera a su manera: {{Numbered list|start=N}},
 *  "* 001. Título", "*Mission: 1–5" o una lista sin números, que sigue la cuenta. Las obras derivadas, que vuelven a
 *  empezar por el tomo 1, se ignoran. */
function parseWikiVolumes(text) {
  const map = {}, seen = new Set()
  let next = 1
  for (const block of text.split(/\{\{\s*Graphic novel list(?![\w/ ]*(?:header|\/))/i).slice(1)) {
    const vol = volKey(/\|\s*VolumeNumber\s*=\s*([^\n|<]*)/i.exec(block)?.[1])
    if (!vol) continue
    if (seen.has(vol)) break
    seen.add(vol)
    const fields = [...block.matchAll(/\|\s*ChapterList(?:Col\d)?\s*=/gi)]
    if (!fields.length) continue
    const add = n => { map[String(n)] = vol; next = Math.max(next, n + 1) }
    for (const f of fields) {
      const start = f.index + f[0].length
      const end = block.slice(start).search(/\n\s*\|\s*(?:ChapterList|LicensedTitle|Summary|LineColor|OriginalRelDate|OriginalISBN|LicensedRelDate|LicensedISBN|Volume\w*|Title)\w*\s*=/i)
      const body = block.slice(start, end < 0 ? undefined : start + end)
      const numbered = [...body.matchAll(/\{\{\s*(?:Numbered|Ordered) list\s*\|\s*start\s*=\s*(\d+)/gi)]
      if (numbered.length) {
        for (const m of numbered) {
          const first = parseInt(m[1], 10)
          for (let k = 0, c = numberedListCount(body, m.index + m[0].length); k < c; k++) add(first + k)
        }
        continue
      }
      const range = /^\s*\*?\s*(?:[\p{L} ]+:)?\s*(\d+)\s*[–-]\s*(\d+)\s*$/mu.exec(body)
      if (range) {
        for (let n = parseInt(range[1], 10), e = parseInt(range[2], 10); n <= e && e - n < 500; n++) add(n)
        continue
      }
      for (const line of body.split('\n')) {
        if (!/^\s*[*#]/.test(line)) continue
        const own = /^\s*[*#]+\s*(?:Chapter\s*)?(\d+)\s*[.:]/i.exec(line)
        add(own ? parseInt(own[1], 10) : next)
      }
    }
  }
  return map
}

/** El título de la obra sin la edición: "One Piece Full Color" es One Piece, con los mismos tomos. */
function workTitle(title) {
  const t = String(title || '').trim()
  const base = t
    .replace(/\s*[([{]\s*(?:(?:full|fan|official|digital(?:ly)?|a todo|a|todo)\s+)?colou?r(?:ed|ized|eado)?(?:\s+edition)?\s*[)\]}]\s*$/i, '')
    .replace(/\s*[-–:]?\s*(?:full|fan|official|digital(?:ly)?)\s+colou?r(?:ed|ized)?(?:\s+edition)?\s*$/i, '')
    .replace(/\s*[-–:]?\s*(?:a todo color|a color)\s*$/i, '')
  return base.length >= 3 ? base : t
}

/** Manhwa y manhua no se publican por tomos: se leen por capítulos. */
const hasNoVolumes = (type, original) => ['manhwa', 'manhua', 'webtoon'].includes(String(type || '').toLowerCase()) || ['ko', 'zh', 'zh-hk'].includes(original)

// Palabras de un título para comparar con nombres de archivo: sin tildes ni vocales largas («Sōsō» y «Sousou» son «soso»).
const LOGO_STOP = new Set(['the', 'and', 'wa', 'no', 'ga', 'wo', 'ni', 'de', 'to'])
const LOGO_EXTRA = new Set(['logo', 'logotype', 'wordmark', 'manga', 'anime', 'series', 'title', 'english', 'japanese', 'png', 'svg', 'webp', 'file', 'the', 'and', 'tv', 'version', 'new', 'old', 'int', 'international', 'with', 'colour', 'color', 'gradient', 'variant', 'alt', 'alternative', 'text', 'black', 'white', 'transparent', 'vector', 'official'])
const logoWords = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o').split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2 && !LOGO_STOP.has(w) && !/^\d+$/.test(w))
/** El archivo que mejor encaja con algún nombre de la obra: tiene «logo», casi todas las palabras del nombre y nada más que relleno. */
function pickLogo(files, names) {
  let best = null, bestScore = 0
  files.forEach((file, i) => {
    if (!/\.(png|svg|webp)$/i.test(file)) return
    const fw = logoWords(file.replace(/^File:/, ''))
    if (!fw.includes('logo')) return
    names.forEach((name, k) => {
      const nw = logoWords(name)
      if (!nw.length || nw.join('').length < 4) return
      const hit = nw.filter(w => fw.includes(w)).length / nw.length
      const stray = fw.filter(w => !nw.includes(w) && !LOGO_EXTRA.has(w))
      const score = hit + (k ? 0 : 0.05) - i * 0.001 // el nombre principal manda
      if (hit >= 0.66 && !stray.length && score > bestScore) { best = file; bestScore = score }
    })
  })
  return best
}
const wikiKey = t => String(t).toLowerCase().replace(/×/g, 'x').replace(/[^\p{L}\p{N}]/gu, '')


// Títulos comparables (de app/meta.js): sin acentos, mayúsculas, signos ni espacios; «parecidos» si comparten el 90 % de bigramas.
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '')
const bigrams = s => { const b = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); b.set(k, (b.get(k) || 0) + 1) } return b }
function similar(a, b) {
  a = norm(a); b = norm(b)
  if (!a || !b) return false
  if (a === b) return true
  if (Math.min(a.length, b.length) < 6) return false
  const A = bigrams(a), B = bigrams(b)
  let hit = 0
  for (const [k, n] of A) hit += Math.min(n, B.get(k) || 0)
  return (2 * hit) / (a.length - 1 + b.length - 1) >= 0.9
}

module.exports = { volKey, titleKey, ndlVolume, isbn10, pickIsbns, pickEnglishIsbns, pickCovers, strayNums, cleanVolMap, volMapsAgree, mergeVolMaps, parseMuVolumes, orderedMuMap, fillVolGaps, ownVolMap, numbersRestart, assignVolumes, dropMisplaced, placeLoose, parseWikiVolumes, workTitle, hasNoVolumes, logoWords, pickLogo, wikiKey, numKey, volOrder, imageKind, MAX_IMAGE, MIN_IMAGE, VOL, MD_ID, similar, norm }
