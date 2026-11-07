const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createTomes, parseWikiIsbns } = require('./tomes.cjs')

const MD = 'b0b721ff-c388-4486-aa0f-c2b0bb321512'
const WIKI = `{{Graphic novel list/header}}
{{Graphic novel list
| VolumeNumber = 1
| OriginalISBN = 978-4-09-850180-9
| LicensedISBN = 978-1-9747-2576-2
| ChapterList =
{{Numbered list|start=1|A|B|C}}
}}
{{Graphic novel list
| VolumeNumber = 2
| OriginalISBN = 978-4-09-850181-6
| ChapterList =
{{Numbered list|start=4|D|E}}
}}`
const jpeg = size => { const b = Buffer.alloc(size, 1); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b }
const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const image = bytes => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })
const GIF = Buffer.from('GIF89a') // la imagen vacía de Amazon cuando no tiene esa cara

function fakeWeb(log) {
  return async url => {
    log.push(url)
    const u = new URL(url)
    if (u.host === 'api.mangadex.org') {
      if (u.pathname === '/manga') return json({ data: [
        { id: 'otro', attributes: { title: { en: 'Obra (Doujinshi)' }, altTitles: [] } },
        { id: MD, attributes: { title: { 'ja-ro': 'Obra de prueba' }, altTitles: [{ en: 'Test Work: Subtitle' }] } }] })
      if (u.pathname.endsWith('/aggregate')) return json({ volumes: { 1: { volume: '1', chapters: { 1: { chapter: '1' } } } } })
      if (u.pathname === `/manga/${MD}`) return json({ data: { attributes: { title: { 'ja-ro': 'Obra de prueba' }, altTitles: [{ en: 'Test Work: Subtitle' }], originalLanguage: 'ja', year: 2020 } } })
      if (u.pathname === '/cover') return json({ total: 2, data: [{ attributes: { volume: '1', fileName: 'v1.jpg', locale: 'ja' } }, { attributes: { volume: '2', fileName: 'v2.jpg', locale: 'en' } }] })
    }
    if (u.host === 'en.wikipedia.org') {
      const titles = u.searchParams.get('titles') || ''
      return json({ query: { pages: titles.includes('List of Test Work chapters') ? [{ revisions: [{ slots: { main: { content: WIKI } } }] }] : [] } })
    }
    if (u.host === 'ndlsearch.ndl.go.jp') return { ok: true, status: 200, text: async () => '<rss><totalResults>0</totalResults></rss>' }
    if (u.host === 'openlibrary.org') return json({ docs: [] })
    if (u.host === 'uploads.mangadex.org') return image(jpeg(9000))
    if (u.host === 'm.media-amazon.com') return image(url.includes('1974725766.01.BACK') ? jpeg(12000) : GIF)
    return { ok: false, status: 404 }
  }
}

test('lee los ISBN de cada tomo en la lista de Wikipedia', () => {
  assert.deepEqual(parseWikiIsbns(WIKI), { 1: { original: ['4098501805'], licensed: ['1974725766'] }, 2: { original: ['4098501813'], licensed: [] } })
})

test('reparte los capítulos locales en tomos y baja sus caras una sola vez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomes-')), log = []
  try {
    const tomes = createTomes({ dir, fetchImpl: fakeWeb(log) })
    const chapters = [1, 2, 3, 4, 5, 6].map(n => ({ id: `c${n}`, num: String(n), volume: null }))
    const r = await tomes.list('Obra de prueba', chapters)
    assert.equal(r.mdId, MD) // el dōjinshi no cuenta
    assert.deepEqual(r.vols.map(v => [v.vol, v.chapters]), [['1', ['c1', 'c2', 'c3']], ['2', ['c4', 'c5']]])
    assert.deepEqual(r.loose, ['c6']) // aún sin tomo
    assert.ok(r.names.includes('Test Work')) // la parte antes de los dos puntos, para la lista de Wikipedia
    assert.equal((await tomes.face(MD, '1', 'thumb')).length, 9000)
    assert.equal((await tomes.face(MD, '1', 'back')).length, 12000) // por el ISBN en inglés de Wikipedia
    assert.equal(await tomes.face(MD, '2', 'back'), null)
    const asked = log.length
    assert.equal((await tomes.face(MD, '1', 'back')).length, 12000)
    assert.equal(log.length, asked) // ya estaba guardada
    assert.equal(await tomes.face('no-es-un-id', '1', 'front'), null)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
