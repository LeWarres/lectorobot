const test = require('node:test')
const assert = require('node:assert/strict')
const { ownedGames, SteamApiKeyError } = require('./steamapi.cjs')

const KEY = '0123456789ABCDEF0123456789ABCDEF', ID = '76561198000000001'
const reply = (status, body) => ({ status, ok: status < 300, json: async () => body })

test('lee la biblioteca completa de la cuenta', async () => {
  let asked
  const games = await ownedGames(KEY, ID, async url => { asked = url; return reply(200, { response: { game_count: 2, games: [{ appid: 10, name: ' Juego ', playtime_forever: 5 }, { appid: 'x' }] } }) })
  assert.deepEqual(games, { private: false, games: [{ appid: '10', name: 'Juego', minutes: 5 }] })
  assert.match(asked, /include_appinfo=1/)
  assert.match(asked, new RegExp(`steamid=${ID}`))
})

test('distingue una cuenta privada de una clave rechazada', async () => {
  assert.deepEqual(await ownedGames(KEY, ID, async () => reply(200, { response: {} })), { private: true, games: [] })
  await assert.rejects(ownedGames(KEY, ID, async () => reply(403, {})), SteamApiKeyError)
  await assert.rejects(ownedGames('corta', ID), SteamApiKeyError)
  await assert.rejects(ownedGames(KEY, '123'), /SteamID/)
})
