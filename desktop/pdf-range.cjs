const fs = require('node:fs/promises')

async function readPdfRange(file, begin, end, expected) {
  if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || !expected || !Number.isSafeInteger(expected.size) || end > expected.size || !Number.isFinite(expected.mtimeMs)) throw new Error('Rango de PDF inválido.')
  const handle = await fs.open(file, 'r')
  try {
    const matches = info => info.size === expected.size && info.mtimeMs === expected.mtimeMs
    if (!matches(await handle.stat())) throw new Error('El PDF cambió; vuelve a abrirlo.')
    const data = Buffer.allocUnsafe(end - begin)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, begin + offset)
      if (!bytesRead) throw new Error('No se pudo leer el rango completo del PDF.')
      offset += bytesRead
    }
    if (!matches(await handle.stat())) throw new Error('El PDF cambió; vuelve a abrirlo.')
    return data
  } finally { await handle.close() }
}
module.exports = { readPdfRange }
