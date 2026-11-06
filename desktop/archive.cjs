const AdmZip = require('adm-zip')
const fs = require('node:fs/promises')
const { statSync } = require('node:fs')
const { createExtractorFromData } = require('node-unrar-js')
const supportedImage = /\.(jpe?g|png|webp|gif|bmp)$/i
const maxCachedZipBytes = 128 * 1024 * 1024
let cachedZip = null
let rarQueue = Promise.resolve()
function pages(file) {
  const stat = statSync(file)
  const key = `${file}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`
  if (cachedZip?.key === key) return cachedZip.entries
  const entries = new AdmZip(file).getEntries().filter(entry => !entry.isDirectory && supportedImage.test(entry.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: 'base' }))
  cachedZip = stat.size <= maxCachedZipBytes ? { key, entries } : null
  return entries
}
function rar(file, name) {
  const task = rarQueue.then(async () => {
    const data = await fs.readFile(file)
    const bytes = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    const extractor = await createExtractorFromData({ data: bytes })
    if (name === undefined) return [...extractor.getFileList().fileHeaders].filter(item => !item.flags.directory && supportedImage.test(item.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    const result = [...extractor.extract({ files: [name] }).files][0]?.extraction
    if (!result) throw new Error('No se pudo extraer la página del archivo CBR.')
    return result
  })
  rarQueue = task.catch(() => {})
  return task
}
module.exports = { pages, rar }
