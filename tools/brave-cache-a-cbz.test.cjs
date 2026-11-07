const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { exportCache } = require('./brave-cache-a-cbz.cjs')

// Una entrada de la caché simple de Chromium: cabecera, URL, cuerpo y registro EOF.
function entry(dir, name, url, body) {
  const header = Buffer.alloc(24)
  Buffer.from('305c72a71b6dfbfc', 'hex').copy(header)
  header.writeUInt32LE(5, 8); header.writeUInt32LE(Buffer.byteLength(url), 12)
  fs.writeFileSync(path.join(dir, `${name}_0`), Buffer.concat([header, Buffer.from(url), Buffer.from(body), Buffer.from('d8410d97456ffaf4', 'hex'), Buffer.alloc(16)]))
}
const JPG = n => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`pagina ${n}`)])

test('exporta los capítulos guardados a CBZ, en orden y avisando de lo que falta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'cbz-'))
  try {
    const O = 'https://manga.test', id = 'lc~x~obra'
    entry(dir, 'a', `${O}/api/manga/${id}?lang=es`, JSON.stringify({ manga: { title: 'Obra: Uno' }, chapters: [{ id: `${id}~1`, num: '1', title: 'Inicio' }] }))
    entry(dir, 'b', `${O}/api/chapter/${id}~1?saver=0`, JSON.stringify({ pages: [0, 1, 2].map(n => `/api/local/${id}~1/${n}`) }))
    entry(dir, 'c', `${O}/api/local/${id}~1/2`, JPG(2))
    entry(dir, 'd', `${O}/api/local/${id}~1/0`, JPG(0))
    entry(dir, 'e', `https://otro.test/api/local/${id}~1/1`, JPG(9))
    const report = exportCache([dir], out, O)
    assert.deepEqual(report, [{ title: 'Obra: Uno', num: '1', pages: 2, missing: [1] }])
    const zip = new AdmZip(path.join(out, 'Obra Uno', 'Capitulo 0001.cbz'))
    assert.deepEqual(zip.getEntries().map(e => e.entryName), ['001.jpg', '002.jpg', 'ComicInfo.xml'])
    assert.match(zip.readAsText('ComicInfo.xml'), /<Title>Inicio<\/Title>/)
    assert.equal(String(zip.readFile('002.jpg').subarray(4)), 'pagina 2')
    assert.ok(fs.existsSync(path.join(out, 'Obra Uno', 'cover.jpg')))
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }) }
})
