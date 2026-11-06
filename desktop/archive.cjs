const yauzl = require('yauzl')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createExtractorFromFile } = require('node-unrar-js')
const supportedImage = /\.(jpe?g|png|webp|gif|bmp)$/i
let cachedZip = null
let rarQueue = Promise.resolve()
function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => err ? reject(err) : resolve(zip)))
}
async function zipData(file, entry) {
  const zip = await openZip(file)
  try {
    const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (err, value) => err ? reject(err) : resolve(value)))
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
  } finally { zip.close() }
}
async function pages(file) {
  const stat = await fs.stat(file)
  const key = `${file}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`
  if (cachedZip?.key === key) return cachedZip.entries
  const zip = await openZip(file)
  const entries = []
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', entry => {
        if (!entry.fileName.endsWith('/') && supportedImage.test(entry.fileName)) entries.push({ entryName: entry.fileName, header: { size: entry.uncompressedSize }, getData: () => zipData(file, entry) })
        zip.readEntry()
      })
      zip.readEntry()
    })
  } finally { zip.close() }
  entries.sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: 'base' }))
  cachedZip = { key, entries }
  return entries
}
function rar(file, name) {
  const task = rarQueue.then(async () => {
    if (name === undefined) {
      const extractor = await createExtractorFromFile({ filepath: file })
      return [...extractor.getFileList().fileHeaders].filter(item => !item.flags.directory && supportedImage.test(item.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    }
    const tempRoot = path.resolve(os.tmpdir())
    const directory = await fs.mkdtemp(path.join(tempRoot, 'lectorobot-page-'))
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('lectorobot-page-')) throw new Error('Directorio temporal inválido.')
    try {
      const extractor = await createExtractorFromFile({ filepath: file, targetPath: resolved, filenameTransform: () => 'page' })
      const files = [...extractor.extract({ files: [name] }).files]
      if (files.length !== 1) throw new Error('No se pudo extraer la página del archivo CBR.')
      return await fs.readFile(path.join(resolved, 'page'))
    } finally { await fs.rm(resolved, { recursive: true, force: true }) }
  })
  rarQueue = task.catch(() => {})
  return task
}
module.exports = { pages, rar }
