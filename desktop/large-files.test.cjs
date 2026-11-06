const test = require('node:test')
const assert = require('node:assert/strict')
const { createLargeFileGuard, FILE_WARNING_BYTES, PAGE_WARNING_BYTES } = require('./large-files.cjs')

test('permite archivos grandes después de confirmar y evita avisos duplicados', async () => {
  let prompts = 0, size = 1024 * 1024 * 1024 + 1
  const guard = createLargeFileGuard({ stat: async () => ({ size, mtimeMs: 1 }), confirm: async () => { prompts++; return true } })
  const book = { id: 'a', path: 'comic.cbr', title: 'Cómic' }
  assert.equal(await guard.canPreview(book), false)
  await Promise.all([guard.ensure(book), guard.ensure(book)])
  assert.equal(prompts, 1)
  assert.equal(await guard.canPreview(book), true)
  await guard.ensure(book, PAGE_WARNING_BYTES + 1)
  assert.equal(prompts, 2)
  size++
  assert.equal(await guard.canPreview(book), false)
})

test('cancelar no aprueba el archivo y permite decidir de nuevo', async () => {
  let answer = false
  const guard = createLargeFileGuard({ stat: async () => ({ size: FILE_WARNING_BYTES + 1, mtimeMs: 1 }), confirm: async () => answer })
  const book = { id: 'a', path: 'comic.cbr', title: 'Cómic' }
  await assert.rejects(guard.ensure(book), /cancelada/)
  assert.equal(await guard.canPreview(book), false)
  answer = true
  await guard.ensure(book)
  assert.equal(await guard.canPreview(book), true)
})
