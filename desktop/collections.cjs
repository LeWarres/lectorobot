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
function seedCollections(collections, library, makeId) {
  for (const name of ['Colección 1', 'Favoritos', 'Juegos']) {
    if (!collections.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) createCollection(collections, name, makeId())
  }
  const first = collections.find(item => item.name.toLocaleLowerCase() === 'colección 1')
  const assigned = new Set(collections.flatMap(item => item.bookIds))
  for (const book of library) if (!assigned.has(book.id)) first.bookIds.push(book.id)
}
function moveItem(collections, from, to, id) {
  const source = collections.find(item => item.id === from), destination = collections.find(item => item.id === to)
  if (!source || !destination || source === destination) throw new Error('Selecciona otra lista válida.')
  if (!source.bookIds.includes(id)) throw new Error('El elemento ya no está en esta lista.')
  destination.bookIds = [...new Set([...destination.bookIds, id])]
  source.bookIds = source.bookIds.filter(item => item !== id)
}
module.exports = { ALL, createCollection, setMembership, booksFor, seedCollections, moveItem }
