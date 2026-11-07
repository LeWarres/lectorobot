const test = require('node:test')
const assert = require('node:assert/strict')
const { storeDetails, decodeHtml } = require('./steamstore.cjs')

test('limpia el HTML de la descripción', () => {
  assert.equal(decodeHtml('Uno<br>dos &amp; <b>tres</b> &quot;&#161;ya!&quot;'), 'Uno dos & tres "¡ya!"')
})

test('lee la descripción y hasta tres capturas de la tienda', async () => {
  let asked
  const fetchImpl = async url => { asked = url; return { ok: true, json: async () => ({ 42: { success: true, data: { short_description: 'Hola &amp; adiós', developers: [' Dev ', 7], publishers: [], header_image: 'http://x',
    screenshots: [1, 2, 3, 4].map(n => ({ path_thumbnail: `https://cdn/${n}.jpg` })).concat({ path_thumbnail: 'http://inseguro.jpg' }) } } }) } }
  assert.deepEqual(await storeDetails('42', { fetchImpl, gapMs: 1 }), { name: '', type: '', description: 'Hola & adiós', screenshots: ['https://cdn/1.jpg', 'https://cdn/2.jpg', 'https://cdn/3.jpg'], developers: ['Dev'], publishers: [], header: null })
  assert.match(asked, /appids=42&l=spanish/)
  assert.deepEqual(await storeDetails('42', { gapMs: 1, fetchImpl: async () => ({ ok: true, json: async () => ({ 42: { success: false } }) }) }), { name: '', type: '', description: '', screenshots: [], developers: [], publishers: [], header: null })
  await assert.rejects(storeDetails('../x'))
})

test('espera y reintenta cuando la tienda limita las consultas', async () => {
  let calls = 0
  const fetchImpl = async () => (++calls < 3 ? { status: 429, ok: false } : { status: 200, ok: true, json: async () => ({ 7: { success: false } }) })
  assert.equal((await storeDetails('7', { fetchImpl, gapMs: 1, retryMs: 1 })).name, '')
  assert.equal(calls, 3)
})
