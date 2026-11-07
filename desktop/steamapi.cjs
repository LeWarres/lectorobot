// Steam Web API: la biblioteca completa de una cuenta (también lo no instalado). Necesita una clave de
// https://steamcommunity.com/dev/apikey; el SteamID sale de loginusers.vdf.
const OWNED = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'

class SteamApiKeyError extends Error {}
const validApiKey = key => typeof key === 'string' && /^[0-9A-F]{32}$/i.test(key.trim())

// { private: true } si la cuenta no deja ver sus juegos (Steam responde vacío).
async function ownedGames(key, steamid, fetchImpl = fetch) {
  if (!validApiKey(key)) throw new SteamApiKeyError('La clave de la Web API de Steam debe tener 32 caracteres hexadecimales.')
  if (!/^7656\d{13}$/.test(String(steamid))) throw new Error('SteamID inválido.')
  const url = `${OWNED}?key=${encodeURIComponent(key.trim())}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) })
  if (response.status === 401 || response.status === 403) throw new SteamApiKeyError('Steam rechazó la clave de la Web API.')
  if (!response.ok) throw new Error(`La Web API de Steam respondió ${response.status}.`)
  const body = (await response.json())?.response || {}
  if (!Array.isArray(body.games)) return { private: true, games: [] }
  const games = body.games
    .filter(game => Number.isInteger(game?.appid) && typeof game.name === 'string' && game.name.trim())
    .map(game => ({ appid: String(game.appid), name: game.name.trim(), minutes: Number(game.playtime_forever) || 0 }))
  return { private: false, games }
}

module.exports = { ownedGames, validApiKey, SteamApiKeyError }
