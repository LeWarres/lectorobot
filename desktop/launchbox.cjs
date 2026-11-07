const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const yauzl = require('yauzl')

// Base de datos pública de LaunchBox: escaneos de cajas reales (frente, contraportada y lomo).
const METADATA_URL = 'https://gamesdb.launchbox-app.com/Metadata.zip'
const IMAGE_BASE = 'https://images.launchbox-app.com/'
const INDEX_FILE = 'launchbox-index.json'
const SIDES = { 'Box - Front': 'front', 'Box - Front - Reconstructed': 'front', 'Box - Back': 'back', 'Box - Back - Reconstructed': 'back', 'Box - Spine': 'spine', Disc: 'disc' }
const REGIONS = ['', 'North America', 'United States', 'World', 'Europe', 'Spain', 'United Kingdom']
const regionRank = region => { const i = REGIONS.indexOf(region || ''); return i < 0 ? REGIONS.length : i }

const decodeXml = text => text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
  const named = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()]
  if (named) return named
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
})
const field = (block, name) => { const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? decodeXml(m[1]).trim() : '' }
// Nombres comparables: sin tildes, marcas, mayúsculas ni signos.
const normalizeName = name => String(name).replace(/[™®©]/g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')

// Lee el XML por trozos, sin cargarlo entero: solo interesan <Game> y <GameImage>.
function createIndexer() {
  const games = new Map(), images = new Map()
  let rest = ''
  const block = /<(Game|GameImage)>([\s\S]*?)<\/\1>/g
  function feed(chunk) {
    rest += chunk
    block.lastIndex = 0
    let end = 0, m
    while ((m = block.exec(rest))) {
      end = block.lastIndex
      const body = m[2], id = field(body, 'DatabaseID')
      if (!id) continue
      if (m[1] === 'Game') {
        const steam = field(body, 'SteamAppId'), platform = field(body, 'Platform')
        if (steam || platform === 'Windows') games.set(id, { steam: /^\d+$/.test(steam) ? steam : '', name: field(body, 'Name'), windows: platform === 'Windows' })
        continue
      }
      const side = SIDES[field(body, 'Type')], file = field(body, 'FileName')
      if (!side || !/^[\w./-]+\.(png|jpe?g|webp)$/i.test(file)) continue
      const rank = regionRank(field(body, 'Region')) + (field(body, 'Type').includes('Reconstructed') ? 0.5 : 0)
      const sides = images.get(id) || {}
      if (!sides[side] || rank < sides[side].rank) sides[side] = { file, rank }
      images.set(id, sides)
    }
    // Lo que queda tras el último bloque completo puede ser el principio del siguiente.
    rest = rest.slice(end)
    if (rest.length > 4 * 1024 * 1024) rest = rest.slice(rest.lastIndexOf('<Game'))
  }
  function finish() {
    const steam = {}, names = {}
    let count = 0
    for (const [id, game] of games) {
      const sides = images.get(id)
      // Solo lo que aporta algo: contraportada, lomo o disco (el frente solo ya lo da SteamGridDB).
      if (!sides || !(sides.back || sides.spine || sides.disc)) continue
      const entry = {}
      for (const side of ['front', 'back', 'spine', 'disc']) if (sides[side]) entry[side] = sides[side].file
      if (game.steam && !steam[game.steam]) steam[game.steam] = entry
      const key = normalizeName(game.name)
      if (game.windows && key && !names[key]) names[key] = entry
      count++
    }
    return { version: 2, updated: new Date().toISOString(), count, steam, names }
  }
  return { feed, finish }
}

function openZipEntry(file, name) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      zip.on('error', reject)
      zip.on('end', () => reject(new Error(`El archivo de LaunchBox no contiene ${name}.`)))
      zip.on('entry', entry => {
        if (entry.fileName !== name) return zip.readEntry()
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err)
          stream.on('end', () => zip.close())
          resolve({ stream, size: entry.uncompressedSize })
        })
      })
      zip.readEntry()
    })
  })
}

async function updateIndex(dir, { fetchImpl = fetch, onProgress = () => {}, url = METADATA_URL } = {}) {
  await fsp.mkdir(dir, { recursive: true })
  const zip = path.join(dir, 'launchbox-metadata.zip.part')
  try {
    const response = await fetchImpl(url)
    if (!response.ok || !response.body) throw new Error(`No se pudo descargar la base de LaunchBox (${response.status}).`)
    const total = Number(response.headers.get('content-length')) || 0
    let done = 0
    const body = Readable.fromWeb(response.body)
    body.on('data', chunk => { done += chunk.length; onProgress({ phase: 'download', done, total }) })
    await pipeline(body, fs.createWriteStream(zip))
    const { stream, size } = await openZipEntry(zip, 'Metadata.xml')
    const indexer = createIndexer()
    let read = 0
    stream.setEncoding('utf8')
    for await (const chunk of stream) {
      indexer.feed(chunk)
      read += Buffer.byteLength(chunk)
      onProgress({ phase: 'index', done: read, total: size })
    }
    const index = indexer.finish()
    const target = path.join(dir, INDEX_FILE)
    await fsp.writeFile(target + '.tmp', JSON.stringify(index))
    await fsp.rename(target + '.tmp', target)
    return index
  } finally { await fsp.rm(zip, { force: true }) }
}

async function loadIndex(dir) {
  try {
    const index = JSON.parse(await fsp.readFile(path.join(dir, INDEX_FILE), 'utf8'))
    return [1, 2].includes(index?.version) && index.steam && index.names ? index : null
  } catch { return null }
}

// La caja de un juego: primero por su número de Steam y, si no, por el nombre.
function lookup(index, appid, name) {
  if (!index) return null
  return index.steam[String(appid)] || index.names[normalizeName(name)] || null
}
const imageUrl = file => IMAGE_BASE + encodeURIComponent(file)

module.exports = { createIndexer, updateIndex, loadIndex, lookup, imageUrl, normalizeName, METADATA_URL }
