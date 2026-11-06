const test = require('node:test')
const assert = require('node:assert/strict')
const { createCollection, setMembership, booksFor } = require('./collections.cjs')
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
