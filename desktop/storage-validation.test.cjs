const test = require('node:test')
const assert = require('node:assert/strict')
const { validLibrary, validCollections } = require('./storage-validation.cjs')
test('valida datos guardados antes de utilizarlos', () => {
  const book = { id: 'a', title: 'Libro', path: 'C:/libro.cbz', type: 'cbz', page: 0 }
  assert.equal(validLibrary([book]), true)
  assert.equal(validLibrary([book, book]), false)
  assert.equal(validLibrary([{ ...book, page: -1 }]), false)
  assert.equal(validLibrary([null]), false)
  assert.equal(validCollections([{ id: 'm', name: 'Manga', bookIds: ['a'] }]), true)
  assert.equal(validCollections([{ id: 'all', name: 'Inválida', bookIds: [] }]), false)
  assert.equal(validCollections([{ id: 'm', name: 'Manga', bookIds: [null] }]), false)
})
