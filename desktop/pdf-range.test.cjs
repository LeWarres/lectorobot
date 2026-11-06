const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { readPdfRange } = require('./pdf-range.cjs')

test('lee solo el rango solicitado y detecta cambios en el PDF', async () => {
  const root = path.resolve(os.tmpdir()), directory = await fs.mkdtemp(path.join(root, 'lectorobot-pdf-test-'))
  const resolved = path.resolve(directory)
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith('lectorobot-pdf-test-')) throw new Error('Directorio temporal inválido.')
  try {
    const file = path.join(resolved, 'test.pdf')
    await fs.writeFile(file, '0123456789')
    const { size, mtimeMs } = await fs.stat(file), expected = { size, mtimeMs }
    assert.equal((await readPdfRange(file, 2, 6, expected)).toString(), '2345')
    await assert.rejects(readPdfRange(file, 0, 11, expected), /Rango/)
    await fs.appendFile(file, 'x')
    await assert.rejects(readPdfRange(file, 0, 2, expected), /cambió/)
  } finally { await fs.rm(resolved, { recursive: true, force: true }) }
})
