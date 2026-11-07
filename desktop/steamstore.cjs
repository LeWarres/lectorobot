// Ficha de la tienda de Steam (sin clave): descripción corta y capturas, para componer la contraportada.
const STORE = 'https://store.steampowered.com/api/appdetails'

const decodeHtml = text => String(text || '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&(quot|amp|lt|gt|apos|nbsp|#\d+);/g, (_, e) => ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' }[e] ?? String.fromCodePoint(Number(e.slice(1)))))
  .replace(/\s+/g, ' ').trim()

// La tienda admite unas 200 consultas cada 5 minutos: van de una en una, espaciadas, y un 429 se reintenta con espera.
let queue = Promise.resolve()
const throttled = (task, gapMs) => {
  const run = queue.then(task, task)
  queue = run.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, gapMs)))
  return run
}
async function storeDetails(appid, { fetchImpl = fetch, language = 'spanish', gapMs = 1300, retries = 3, retryMs = 15000 } = {}) {
  if (!/^\d+$/.test(String(appid))) throw new Error('Juego de Steam inválido.')
  let response
  for (let attempt = 0; ; attempt++) {
    response = await throttled(() => fetchImpl(`${STORE}?appids=${appid}&l=${language}`, { signal: AbortSignal.timeout(15000) }), gapMs)
    if (response.status !== 429 || attempt >= retries) break
    await new Promise(resolve => setTimeout(resolve, retryMs * (attempt + 1)))
  }
  if (!response.ok) throw new Error(`La tienda de Steam respondió ${response.status}.`)
  const data = (await response.json())?.[appid]
  if (!data?.success) return { name: '', type: '', description: '', screenshots: [], developers: [], publishers: [], header: null }
  const https = url => typeof url === 'string' && url.startsWith('https://')
  const names = list => (Array.isArray(list) ? list : []).filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()).slice(0, 2)
  const shots = (data.data.screenshots || []).map(item => item.path_thumbnail).filter(https)
  return {
    name: typeof data.data.name === 'string' ? data.data.name.trim() : '',
    type: typeof data.data.type === 'string' ? data.data.type : '', // «game», «dlc», «demo», «application»…
    description: decodeHtml(data.data.short_description),
    screenshots: shots.slice(0, 3),
    developers: names(data.data.developers),
    publishers: names(data.data.publishers),
    header: https(data.data.header_image) ? data.data.header_image : null
  }
}

module.exports = { storeDetails, decodeHtml }
