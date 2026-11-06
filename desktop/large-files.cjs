const FILE_WARNING_BYTES = 128 * 1024 * 1024
const PAGE_WARNING_BYTES = 64 * 1024 * 1024

function createLargeFileGuard({ stat, confirm }) {
  const approved = new Set(), pending = new Map()
  async function risks(book, pageBytes) {
    const info = await stat(book.path)
    const fingerprint = `${book.id}\0${info.size}\0${info.mtimeMs}`
    const items = []
    if (info.size > FILE_WARNING_BYTES) items.push({ key: `file\0${fingerprint}`, kind: 'archivo', bytes: info.size, title: book.title })
    if (pageBytes > PAGE_WARNING_BYTES) items.push({ key: `page\0${fingerprint}`, kind: 'página', bytes: pageBytes, title: book.title })
    return items
  }
  async function request(item) {
    if (approved.has(item.key)) return
    if (!pending.has(item.key)) {
      const task = Promise.resolve().then(() => confirm(item)).then(accepted => {
        if (accepted) approved.add(item.key)
        return accepted
      }).finally(() => pending.delete(item.key))
      pending.set(item.key, task)
    }
    if (!await pending.get(item.key)) throw new Error('Apertura cancelada.')
  }
  return {
    async ensure(book, pageBytes = 0) { for (const item of await risks(book, pageBytes)) await request(item) },
    async canPreview(book, pageBytes = 0) { return (await risks(book, pageBytes)).every(item => approved.has(item.key)) }
  }
}
module.exports = { createLargeFileGuard, FILE_WARNING_BYTES, PAGE_WARNING_BYTES }
