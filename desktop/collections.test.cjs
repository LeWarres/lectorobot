const test = require('node:test')
const assert = require('node:assert/strict')
const { createCollection, setMembership, booksFor, seedCollections, moveItem } = require('./collections.cjs')
test('las listas mantienen membresías independientes sin borrar libros', () => {
  const lists = [], books = [{ id: 'a' }, { id: 'b' }]
  createCollection(lists, 'Manga', 'm'); createCollection(lists, 'Cómics', 'c')
  setMembership(lists, 'm', 'a', true); setMembership(lists, 'c', 'a', true); setMembership(lists, 'c', 'b', true)
  setMembership(lists, 'c', 'a', false)
  assert.deepEqual(booksFor(books, lists, 'm'), [books[0]])
  assert.deepEqual(booksFor(books, lists, 'c'), [books[1]])
  assert.deepEqual(booksFor(books, lists, 'all'), books)
  assert.throws(() => createCollection(lists, 'manga', 'x'))
})
test('crea listas iniciales sin perder listas ni archivos existentes', () => {
  const lists = [{ id: 'old', name: 'Manga', bookIds: ['a'] }], books = [{ id: 'a' }, { id: 'b' }]
  let n = 0; seedCollections(lists, books, () => `default-${++n}`)
  assert.deepEqual(lists.map(item => item.name), ['Manga', 'Colección 1', 'Favoritos', 'Juegos'])
  assert.deepEqual(lists[0].bookIds, ['a'])
  assert.deepEqual(lists[1].bookIds, ['b'])
  moveItem(lists, lists[1].id, lists[2].id, 'b')
  assert.deepEqual(lists[1].bookIds, [])
  assert.deepEqual(lists[2].bookIds, ['b'])
  assert.throws(() => moveItem(lists, lists[1].id, lists[2].id, 'b'))
})
