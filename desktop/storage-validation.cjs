function validLibrary(value) {
  if (!Array.isArray(value)) return false
  const ids = new Set()
  return value.every(book => {
    if (!book || typeof book.id !== 'string' || !book.id || ids.has(book.id) || typeof book.title !== 'string' || typeof book.path !== 'string' || typeof book.type !== 'string' || !Number.isInteger(book.page) || book.page < 0) return false
    ids.add(book.id)
    return true
  })
}
function validCollections(value) {
  if (!Array.isArray(value)) return false
  const ids = new Set()
  return value.every(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id === 'all' || ids.has(item.id) || typeof item.name !== 'string' || !Array.isArray(item.bookIds) || !item.bookIds.every(id => typeof id === 'string')) return false
    ids.add(item.id)
    return true
  })
}
module.exports = { validLibrary, validCollections }
