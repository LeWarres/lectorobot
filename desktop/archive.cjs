const AdmZip = require('adm-zip')
const fs = require('node:fs/promises')
const { createExtractorFromData } = require('node-unrar-js')
const supportedImage = /\.(jpe?g|png|webp|gif|bmp)$/i
function pages(file) {
  return new AdmZip(file).getEntries().filter(entry => !entry.isDirectory && supportedImage.test(entry.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: 'base' }))
}
async function rar(file, name) {
  const data = await fs.readFile(file)
  if (data.length > 512 * 1024 * 1024) throw new Error('El archivo CBR supera el límite de 512 MB.')
  const extractor = await createExtractorFromData({ data: Uint8Array.from(data).buffer })
  if (name === undefined) return [...extractor.getFileList().fileHeaders].filter(item => !item.flags.directory && supportedImage.test(item.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return [...extractor.extract({ files: [name] }).files][0]?.extraction
}
module.exports = { pages, rar }
