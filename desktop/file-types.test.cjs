const test = require('node:test')
const assert = require('node:assert/strict')
const { extensions, supportedFile } = require('./file-types.cjs')

test('el explorador y la validación comparten formatos compatibles', () => {
  assert.deepEqual(extensions, ['cbz', 'cbr', 'pdf'])
  for (const ext of extensions) assert.equal(supportedFile(`tomo.${ext.toUpperCase()}`), true)
  for (const name of ['libro.zip', 'libro.ZIP', 'libro.exe', 'libro.pdf.exe', 'libro', '', null]) assert.equal(supportedFile(name), false)
})
