const ALL = 'all'
function createCollection(collections, name, id) {
  name = typeof name === 'string' ? name.trim() : ''
  if (!name || name.length > 80) throw new Error('Escribe un nombre de hasta 80 caracteres.')
  if (collections.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Ya existe una lista con ese nombre.')
  const item = { id, name, bookIds: [] }
  collections.push(item)
  return item
}
function setMembership(collections, collectionId, bookId, checked) {
  const collection = collections.find(item => item.id === collectionId)
  if (!collection) throw new Error('La lista ya no existe.')
  const ids = new Set(collection.bookIds)
  if (checked) ids.add(bookId); else ids.delete(bookId)
  collection.bookIds = [...ids]
}
function booksFor(library, collections, collectionId) {
  if (collectionId === ALL) return library
  const collection = collections.find(item => item.id === collectionId)
  if (!collection) throw new Error('La lista ya no existe.')
  const ids = new Set(collection.bookIds)
  return library.filter(book => ids.has(book.id))
}
module.exports = { ALL, createCollection, setMembership, booksFor }
