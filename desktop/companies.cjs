// Logos de desarrolladoras y editoras: de Wikidata (propiedad P154, «logo», en Commons) y, si no está ahí (los logos
// no libres no suben a Commons), del campo «logo» de la ficha de la empresa en la Wikipedia en inglés.
const API = 'https://www.wikidata.org/w/api.php'
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php'
// Wikimedia pide identificar a los clientes automáticos.
const HEADERS = { 'User-Agent': 'LectorObot/0.1 (https://github.com/LeWarres/lectorobot)' }
const COMPANY = /(video ?game|game|company|publisher|developer|studio|entertainment|software|interactive|corporation|distribut)/i

// Wikidata limita las peticiones seguidas (429): van de una en una, separadas, y se reintentan con espera.
let queue = Promise.resolve()
const throttled = (task, gapMs) => {
  const run = queue.then(task, task)
  queue = run.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, gapMs)))
  return run
}
async function json(url, fetchImpl, { gapMs = 250, retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await throttled(() => fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) }), gapMs)
    if (response.status === 429 && attempt < retries) {
      const wait = Number(response.headers?.get?.('retry-after')) * 1000 || 2000 * (attempt + 1)
      await new Promise(resolve => setTimeout(resolve, Math.min(wait, 30000)))
      continue
    }
    if (!response.ok) throw new Error(`Wikidata respondió ${response.status}.`)
    return response.json()
  }
}

// El archivo del campo «logo» de la ficha, en el primer apartado del artículo.
function infoboxLogo(wikitext) {
  const m = String(wikitext || '').match(/\|\s*logo\s*=\s*(?:\[\[)?\s*(?:File:|Image:)?\s*([^|\]\n}{<]+?\.(?:svg|png|jpe?g|gif|webp))/i)
  return m ? m[1].trim() : null
}
async function wikipediaLogoUrl(term, fetchImpl, options, width) {
  const data = await json(`${WIKIPEDIA}?action=parse&page=${encodeURIComponent(term)}&redirects=1&prop=wikitext&section=0&format=json&formatversion=2`, fetchImpl, options)
  const file = infoboxLogo(data?.parse?.wikitext)
  return file ? `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}` : null
}

// La dirección del logo de una empresa, o null si no se encuentra.
// Sin forma jurídica ni aclaraciones: «PlayStation Publishing LLC (excluding China)» → «PlayStation Publishing».
const cleanName = name => String(name || '').replace(/\([^)]*\)/g, ' ')
  .replace(/[,.\s]+(co\.?,?\s*ltd|pte\.?\s*ltd|ltd|limited|inc|llc|l\.l\.c|corp|corporation|gmbh|s\.?a\.?|s\.?r\.?l|k\.?k|ab|oy|plc)\.?\s*$/i, '')
  .replace(/[,.\s]+(co\.?,?\s*ltd|inc|llc|ltd)\.?\s*$/i, '').replace(/\s+/g, ' ').trim()

// La dirección del logo de una empresa, o null si no se encuentra.
async function companyLogoUrl(name, { fetchImpl = fetch, width = 320, gapMs, retries } = {}) {
  const term = cleanName(name)
  if (!term) return null
  const options = { gapMs, retries }
  const { url, title } = await wikidataLogo(term, fetchImpl, options, width)
  if (url) return url
  // El artículo que enlaza Wikidata (con sus mayúsculas exactas) o, si no hay, el nombre tal cual.
  return wikipediaLogoUrl(title || term, fetchImpl, options, width)
}
async function wikidataLogo(term, fetchImpl, options, width) {
  const found = await json(`${API}?action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&type=item&limit=6&format=json`, fetchImpl, options)
  const ids = (found.search || []).map(item => item.id).filter(id => /^Q\d+$/.test(id))
  if (!ids.length) return {}
  const data = await json(`${API}?action=wbgetentities&ids=${ids.join('|')}&props=claims|descriptions|sitelinks&sitefilter=enwiki&languages=en&format=json`, fetchImpl, options)
  // En el orden de la búsqueda: la primera empresa con logo; si ninguna lo tiene, el artículo de la primera empresa.
  let title = null
  for (const id of ids) {
    const entity = data.entities?.[id]
    if (!COMPANY.test(entity?.descriptions?.en?.value || '')) continue
    const file = entity.claims?.P154?.[0]?.mainsnak?.datavalue?.value
    if (typeof file === 'string') return { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}` }
    title ??= entity.sitelinks?.enwiki?.title || null
  }
  return { title }
}

module.exports = { companyLogoUrl, infoboxLogo, cleanName, HEADERS }
