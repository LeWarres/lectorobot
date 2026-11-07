const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { createIndexer, updateIndex, loadIndex, lookup, normalizeName, imageUrl } = require('./launchbox.cjs')

const XML = `<?xml version="1.0"?><LaunchBox>
  <Game><Name>Cyberpunk 2077</Name><DatabaseID>1</DatabaseID><SteamAppId>1091500</SteamAppId><Platform>Windows</Platform></Game>
  <Game><Name>Sekiro&#8482;: Shadows Die Twice</Name><DatabaseID>2</DatabaseID><Platform>Windows</Platform></Game>
  <Game><Name>Solo Frente</Name><DatabaseID>3</DatabaseID><SteamAppId>30</SteamAppId><Platform>Windows</Platform></Game>
  <Game><Name>Solo Disco</Name><DatabaseID>5</DatabaseID><SteamAppId>50</SteamAppId><Platform>Windows</Platform></Game>
  <Game><Name>Juego de consola</Name><DatabaseID>4</DatabaseID><Platform>Sony Playstation 2</Platform></Game>
  <GameAlternateName><DatabaseID>1</DatabaseID><Region>Asia</Region></GameAlternateName>
  <GameImage><DatabaseID>1</DatabaseID><FileName>jp-front.jpg</FileName><Type>Box - Front</Type><Region>Japan</Region></GameImage>
  <GameImage><DatabaseID>1</DatabaseID><FileName>na-front.jpg</FileName><Type>Box - Front</Type><Region>North America</Region></GameImage>
  <GameImage><DatabaseID>1</DatabaseID><FileName>back.png</FileName><Type>Box - Back - Reconstructed</Type></GameImage>
  <GameImage><DatabaseID>1</DatabaseID><FileName>spine.jpg</FileName><Type>Box - Spine</Type><Region>Europe</Region></GameImage>
  <GameImage><DatabaseID>2</DatabaseID><FileName>s-front.jpg</FileName><Type>Box - Front</Type></GameImage>
  <GameImage><DatabaseID>2</DatabaseID><FileName>s-spine.jpg</FileName><Type>Box - Spine</Type></GameImage>
  <GameImage><DatabaseID>3</DatabaseID><FileName>f.jpg</FileName><Type>Box - Front</Type></GameImage>
  <GameImage><DatabaseID>5</DatabaseID><FileName>disco.png</FileName><Type>Disc</Type></GameImage>
  <GameImage><DatabaseID>4</DatabaseID><FileName>ps2.jpg</FileName><Type>Box - Front</Type></GameImage>
  <GameImage><DatabaseID>4</DatabaseID><FileName>ps2b.jpg</FileName><Type>Box - Back</Type></GameImage>
  <GameImage><DatabaseID>1</DatabaseID><FileName>../malo.jpg"</FileName><Type>Box - Back</Type></GameImage>
</LaunchBox>`

test('indexa las cajas aunque el XML llegue en trozos pequeños', () => {
  const indexer = createIndexer()
  for (let i = 0; i < XML.length; i += 7) indexer.feed(XML.slice(i, i + 7))
  const index = indexer.finish()
  assert.equal(index.count, 3)
  assert.deepEqual(lookup(index, '50', ''), { disc: 'disco.png' })
  assert.deepEqual(lookup(index, '1091500', 'otro nombre'), { front: 'na-front.jpg', back: 'back.png', spine: 'spine.jpg' })
  assert.deepEqual(lookup(index, '999', 'SEKIRO: Shadows Die Twice™'), { front: 's-front.jpg', spine: 's-spine.jpg' })
  assert.equal(lookup(index, '30', 'Solo Frente'), null) // sin lomo ni contraportada no aporta nada
  assert.equal(lookup(index, '1', 'Juego de consola'), null) // solo juegos de PC
  assert.equal(lookup(null, '1', 'x'), null)
})

test('normaliza nombres y arma las direcciones de imagen', () => {
  assert.equal(normalizeName('Pokémon™ & Friends: Édition'), 'pokemonandfriendsedition')
  assert.equal(imageUrl('r2_a b.png'), 'https://images.launchbox-app.com/r2_a%20b.png')
})

test('descarga el zip, guarda el índice y borra la descarga', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'launchbox-'))
  try {
    const zip = new AdmZip(); zip.addFile('Metadata.xml', Buffer.from(XML)); zip.addFile('Mame.xml', Buffer.from('<x/>'))
    const bytes = zip.toBuffer(), progress = []
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => String(bytes.length) }, body: new Blob([bytes]).stream() })
    const index = await updateIndex(dir, { fetchImpl, onProgress: p => progress.push(p.phase) })
    assert.equal(index.count, 3)
    assert.ok(progress.includes('download') && progress.includes('index'))
    assert.deepEqual((await loadIndex(dir)).steam, index.steam)
    assert.deepEqual(await fs.readdir(dir), ['launchbox-index.json'])
    await assert.rejects(updateIndex(dir, { fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null } }) }), /503/)
    assert.equal((await loadIndex(path.join(dir, 'nada'))), null)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
