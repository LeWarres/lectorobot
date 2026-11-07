const test = require('node:test')
const assert = require('node:assert/strict')
const { findArt, download, checkKey, SteamGridDbKeyError } = require('./steamgriddb.cjs')

const KEY = '0123456789abcdef0123456789abcdef'
const reply = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: name => headers[name.toLowerCase()] ?? null }, arrayBuffer: async () => new TextEncoder().encode(body).buffer })

test('elige la portada mejor valorada y envía la clave', async () => {
  let seen
  const fetchImpl = async (url, options) => { seen = { url, auth: options.headers.Authorization }; return reply(200, { success: true, data: [
    { url: 'https://cdn/a.png', upvotes: 1 }, { url: 'https://cdn/b.png', upvotes: 5, downvotes: 1 }, { url: 'http://inseguro/c.png', upvotes: 99 }] }) }
  assert.equal(await findArt('grids', '42', KEY, fetchImpl), 'https://cdn/b.png')
  assert.match(seen.url, /\/grids\/steam\/42\?dimensions=600x900/)
  assert.equal(seen.auth, `Bearer ${KEY}`)
})

test('prefiere los logos oficiales y devuelve null si no hay imágenes', async () => {
  const logos = async () => reply(200, { success: true, data: [{ url: 'https://cdn/fan.png', upvotes: 50 }, { url: 'https://cdn/oficial.png', style: 'official' }] })
  assert.equal(await findArt('logos', '42', KEY, logos), 'https://cdn/oficial.png')
  assert.equal(await findArt('grids', '42', KEY, async () => reply(404, { success: false })), null)
})

test('distingue una clave rechazada de un fallo de red', async () => {
  await assert.rejects(findArt('grids', '42', KEY, async () => reply(401, {})), SteamGridDbKeyError)
  await assert.rejects(findArt('grids', '42', 'corta', async () => reply(200, {})), SteamGridDbKeyError)
  assert.equal(await checkKey(KEY, async () => reply(401, {})), false)
  assert.equal(await checkKey(KEY, async () => reply(200, { success: true, data: [] })), true)
  await assert.rejects(checkKey(KEY, async () => { throw new Error('sin red') }), /sin red/)
})

test('solo descarga imágenes por https', async () => {
  assert.equal(String(await download('https://cdn/a.png', async () => reply(200, 'png', { 'content-type': 'image/png' }))), 'png')
  await assert.rejects(download('https://cdn/a.html', async () => reply(200, 'x', { 'content-type': 'text/html' })))
  await assert.rejects(download('file:///etc/passwd'))
})
