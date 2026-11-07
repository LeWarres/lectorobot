const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { parseComicInfo, guessFromName, describe, scanFolder, groupWorks } = require('./comics.cjs')

test('lee el ComicInfo.xml', () => {
  const info = parseComicInfo('<ComicInfo><Series>Frieren &amp; Co</Series><Number>12</Number><Volume>2</Volume><Manga>YesAndRightToLeft</Manga><PageCount>20</PageCount></ComicInfo>')
  assert.deepEqual(info, { series: 'Frieren & Co', number: '12', volume: '2', title: null, rtl: true, pages: 20 })
})

test('saca obra, capítulo y tomo del nombre del archivo', () => {
  const cases = {
    '/m/Sousou no Frieren/Capitulo 0012.cbz': ['Sousou no Frieren', '12', null],
    '/m/x/One Piece v03 c021.cbz': ['One Piece', '21', '3'],
    '/m/x/Berserk Vol. 2.cbr': ['Berserk', null, '2'],
    '/m/x/Naruto - 015.cbz': ['Naruto', '15', null],
    '/m/Cómics/Saga #3 (2012).cbz': ['Saga', '3', null],
    '/m/Akira/Akira Tomo 1.cbr': ['Akira', null, '1']
  }
  for (const [file, [series, number, volume]] of Object.entries(cases)) assert.deepEqual(guessFromName(file), { series, number, volume }, file)
})

test('describe un CBZ con lo de su ComicInfo y cuenta sus páginas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comic-'))
  try {
    const zip = new AdmZip()
    for (const n of [1, 2, 3]) zip.addFile(`${n}.jpg`, Buffer.from('x'))
    zip.addFile('ComicInfo.xml', Buffer.from('<ComicInfo><Series>Obra</Series><Number>7</Number><Title>El viaje</Title></ComicInfo>'))
    const file = path.join(dir, 'cualquier nombre.cbz')
    zip.writeZip(file)
    assert.deepEqual(await describe(file), { series: 'Obra', number: '7', volume: null, pages: 3, rtl: null, title: 'Obra · Capítulo 7 — El viaje' })
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('recorre las carpetas sin entrar en las ocultas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lib-'))
  try {
    await fs.mkdir(path.join(dir, 'Obra', '.hd'), { recursive: true })
    for (const f of ['Obra/Capitulo 10.cbz', 'Obra/Capitulo 2.cbz', 'Obra/.hd/Capitulo 2.cbz', 'Obra/cover.jpg', 'suelto.pdf']) await fs.writeFile(path.join(dir, f), '')
    assert.deepEqual((await scanFolder(dir)).map(f => path.relative(dir, f)), [path.join('Obra', 'Capitulo 2.cbz'), path.join('Obra', 'Capitulo 10.cbz'), 'suelto.pdf'])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('agrupa los capítulos de una obra en tomos y deja sueltos los demás', () => {
  const books = [
    { id: 'p', title: 'Libro', type: 'pdf' },
    { id: 'f2', type: 'cbz', series: 'Frieren', number: '2', title: 'F2' },
    { id: 'f1', type: 'cbz', series: 'Frieren', number: '1', title: 'F1', readAt: 5 },
    { id: 'f3', type: 'cbz', series: 'frieren', number: '3', title: 'F3', readAt: 9 },
    { id: 'o', type: 'cbz', series: 'Otra', number: '1', title: 'O1' },
    { id: 'b1', type: 'cbz', series: 'Berserk', volume: '1', number: '1', title: 'B1' },
    { id: 'b2', type: 'cbz', series: 'Berserk', volume: '1', number: '2', title: 'B2' },
    { id: 'b3', type: 'cbz', series: 'Berserk', volume: '2', number: '3', title: 'B3' },
    { id: 's', type: 'steam', series: 'X', title: 'Juego' }
  ]
  const works = groupWorks(books)
  assert.deepEqual(works.map(w => w.kind === 'book' ? w.id : w.title), ['p', 'Frieren', 'o', 'Berserk', 's'])
  const frieren = works[1]
  assert.deepEqual(frieren.chapters, ['f1', 'f2', 'f3'])
  assert.equal(frieren.chapterId, 'f3') // el último leído
  assert.deepEqual(frieren.vols.map(v => [v.vol, v.label, v.chapters]), [['1', 'Capítulo 1', ['f1']], ['2', 'Capítulo 2', ['f2']], ['3', 'Capítulo 3', ['f3']]])
  assert.deepEqual(works[3].vols.map(v => [v.label, v.chapters]), [['Tomo 1', ['b1', 'b2']], ['Tomo 2', ['b3']]])
})
