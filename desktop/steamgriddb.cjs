const API = 'https://www.steamgriddb.com/api/v2'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const QUERY = {
  grids: 'dimensions=600x900&types=static&nsfw=false&humor=false', // portada vertical, como la caja del juego
  logos: 'types=static&nsfw=false&humor=false',
  heroes: 'types=static&nsfw=false&humor=false' // banner ancho, para la contraportada
}

class SteamGridDbKeyError extends Error {}

const validKey = key => typeof key === 'string' && /^[0-9a-f]{32}$/i.test(key.trim())
const rank = item => (item.style === 'official' ? 1000 : 0) + (item.score || 0) + (item.upvotes || 0) - (item.downvotes || 0)

async function request(url, key, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(15000) })
  if (response.status === 401 || response.status === 403) throw new SteamGridDbKeyError('La clave de SteamGridDB no es válida.')
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`SteamGridDB respondió ${response.status}.`)
  const body = await response.json()
  if (!body?.success) throw new Error(body?.errors?.join(' ') || 'Respuesta inválida de SteamGridDB.')
  return body.data
}

// La mejor imagen («grids» = portada 600×900, «logos» = logo) para un juego de Steam, o null si no hay.
async function findArt(kind, appid, key, fetchImpl = fetch) {
  if (!QUERY[kind]) throw new Error('Tipo de imagen desconocido.')
  if (!/^\d+$/.test(String(appid))) throw new Error('Juego de Steam inválido.')
  if (!validKey(key)) throw new SteamGridDbKeyError('La clave de SteamGridDB no es válida.')
  const data = await request(`${API}/${kind}/steam/${appid}?${QUERY[kind]}`, key, fetchImpl)
  if (!Array.isArray(data) || !data.length) return null
  const best = data.filter(item => typeof item?.url === 'string' && item.url.startsWith('https://')).sort((a, b) => rank(b) - rank(a))[0]
  return best?.url || null
}

async function download(url, fetchImpl = fetch, headers = {}) {
  if (!/^https:\/\//.test(url)) throw new Error('Dirección de imagen inválida.')
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`No se pudo descargar la imagen (${response.status}).`)
  if (!/^image\//.test(response.headers.get('content-type') || '')) throw new Error('La descarga no es una imagen.')
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande.')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande.')
  return bytes
}

// Comprueba una clave: true si SteamGridDB la acepta, false si la rechaza; los fallos de red se propagan.
async function checkKey(key, fetchImpl = fetch) {
  if (!validKey(key)) return false
  try { await request(`${API}/grids/steam/1016920?${QUERY.grids}`, key, fetchImpl); return true } catch (error) {
    if (error instanceof SteamGridDbKeyError) return false
    throw error
  }
}

module.exports = { findArt, download, checkKey, validKey, SteamGridDbKeyError }
