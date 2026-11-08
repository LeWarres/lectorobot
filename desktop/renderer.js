const library = document.querySelector('#library')
const viewer = document.querySelector('#viewer')
const error = document.querySelector('#error')
const image = document.querySelector('#page')
const canvas = document.querySelector('#pdf-page')
const shelfElement = document.querySelector('#shelf')
const bookHost = document.querySelector('#book3d')
const peek = document.querySelector('#peek')
const params = new URLSearchParams(location.search)
const isWallpaper = params.has('wallpaper')
let wallpaperCollection = params.get('collection') || 'all'
const collectionSelect = document.querySelector('#collection')
const displaySelect = document.querySelector('#display')
let current, total, page, imageUrl, pdf, shelf, coverUrls = [], book3d, bookUrls = new Map(), pendingPageUrls = new Map(), generation = 0, pageRequest = 0, zoom = 1
let flatPan = { x: 0, y: 0 }, flatDrag = null
let managing = false, selectedItem = null, openRequest = 0
let readingDirection = 'rtl'
try { if (window.localStorage?.getItem('lectorobot-reading-direction') === 'ltr') readingDirection = 'ltr' } catch {}
const translations = window.LectorobotI18n || { resolveLocale: () => 'es', translate: (_locale, source, params = {}) => source.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '') }
let currentLocale = 'es', languagePreference = 'auto', systemLanguage = typeof navigator === 'undefined' ? 'es' : navigator.language
const tr = (source, params) => translations.translate(currentLocale, source, params)
const listLabel = name => ['Colección 1', 'Favoritos', 'Juegos', 'Toda la biblioteca'].includes(name) ? tr(name) : name
function translateInterface(settings) {
  languagePreference = settings.preference
  systemLanguage = settings.system
  currentLocale = translations.resolveLocale(languagePreference, systemLanguage)
  if (document.documentElement) document.documentElement.lang = currentLocale
  document.title = tr('Biblioteca')
  for (const element of document.querySelectorAll?.('[data-i18n]') || []) element.textContent = tr(element.dataset.i18n)
  for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
    for (const element of document.querySelectorAll?.(`[data-i18n-${attr}]`) || []) element.setAttribute(attr, tr(element.getAttribute(`data-i18n-${attr}`)))
  }
  document.querySelector('#language').value = languagePreference
  updateDesktopMenu()
}
const attempt = async action => {
  try {
    error.textContent = ''
    document.querySelector('dialog[open] .dialog-error')?.remove?.()
    await action()
  } catch (err) {
    const description = String(err.message || err).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    const active = document.querySelector('dialog[open]')
    if (active) {
      let message = active.querySelector('.dialog-error')
      if (!message) { message = document.createElement('p'); message.className = 'dialog-error'; message.setAttribute('role', 'alert'); active.append(message) }
      message.textContent = tr(description)
    } else error.textContent = tr(description)
  }
}
async function loadPdf(pdfjs, source, id, reportError = () => {}) {
  if (!source.ranged) return pdfjs.getDocument({ data: source.data }).promise
  const transport = new pdfjs.PDFDataRangeTransport(source.size, new Uint8Array(0), true)
  let stopped = false, failure, task
  transport.requestDataRange = (begin, end) => {
    window.reader.pdfRange(id, begin, end, { size: source.size, mtimeMs: source.mtimeMs }).then(bytes => {
      if (!stopped) transport.onDataRange(begin, new Uint8Array(bytes))
    }).catch(err => {
      if (!stopped) { failure = err; reportError(err); task?.destroy().catch(() => {}) }
    })
  }
  transport.abort = () => { stopped = true }
  task = pdfjs.getDocument({ range: transport, disableStream: true, disableAutoFetch: true })
  try { return await task.promise } catch (err) { throw failure || err }
}
async function mapLimited(items, limit, callback) {
  const result = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await callback(items[index]) }
  }))
  return result
}
async function showLibrary() {
  openRequest++
  const loadGeneration = ++generation
  pageRequest++
  zoom = 1
  flatPan = { x: 0, y: 0 }
  flatDrag = null
  image.style.transform = ''; canvas.style.transform = ''
  image.style.cursor = ''; canvas.style.cursor = ''
  book3d?.destroy(); book3d = null; bookHost.hidden = true
  if (pdf) { const previousPdf = pdf; pdf = null; previousPdf.loadingTask.destroy().catch(() => {}) }
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; image.src = '' }
  canvas.width = 0; canvas.height = 0
  for (const url of bookUrls.values()) URL.revokeObjectURL(url)
  bookUrls.clear()
  pendingPageUrls.clear()
  viewer.hidden = true
  updateDesktopMenu()
  peek.hidden = true
  shelf?.destroy(); shelf = null
  shelfElement.hidden = true
  coverUrls.forEach(url => URL.revokeObjectURL(url)); coverUrls = []
  library.hidden = false
  library.replaceChildren()
  const selected = isWallpaper ? wallpaperCollection : collectionSelect.value
  const books = selected ? await window.reader.library(selected) : []
  if (generation !== loadGeneration) return
  if (!books.length && !isWallpaper) library.textContent = tr('Esta lista está vacía. Añade archivos para empezar.')
  for (const book of books) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'book'
    button.dataset.id = book.id
    button.textContent = book.title
    const openBook = () => attempt(async () => {
      if (managing && !isWallpaper) { selectManagedItem(book); return }
      if (book.type === 'steam') { await window.reader.launchGame(book.id); return }
      const request = ++openRequest
      const result = await window.reader.open(book.id)
      if (request !== openRequest) return
      let openedPdf = null, nextTotal = result.total, nextPage = result.page
      if (result.type === 'pdf') {
        const pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
        openedPdf = await loadPdf(pdfjs, result, book.id, err => { if (request === openRequest) error.textContent = err.message })
        if (request !== openRequest) { await openedPdf.loadingTask.destroy(); return }
        nextTotal = openedPdf.numPages
        nextPage = Math.min(nextPage, nextTotal - 1)
      }
      current = book.id; total = nextTotal; page = nextPage; pdf = openedPdf
      document.querySelector('#title').textContent = result.title
      library.hidden = true; peek.hidden = true; shelfElement.hidden = true; shelf?.destroy(); shelf = null; viewer.hidden = false
      zoom = 1; updateDesktopMenu()
      try { await startBook(); await showPage() } catch (err) { await showLibrary(); throw err }
    })
    button.addEventListener('click', openBook)
    const card = document.createElement('div')
    card.append(button)
    library.append(card)
  }
  const newUrls = []
  try {
    const [lib, mod] = await Promise.all([import('./book3d.js'), import('./shelf3d.js')])
    if (generation !== loadGeneration) return
    const works = await mapLimited(books, 3, async book => {
      if (generation !== loadGeneration) return null
      let data = await window.reader.cover(book.id).catch(() => null)
      if (generation !== loadGeneration) return null
      if (!data && book.type === 'pdf') {
        try {
          const bytes = await window.reader.pdfCover(book.id)
          if (bytes) {
            const pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
            pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
            const doc = await loadPdf(pdfjs, bytes, book.id)
            try {
              const first = await doc.getPage(1), viewport = first.getViewport({ scale: 0.5 })
              const surface = document.createElement('canvas')
              surface.width = viewport.width; surface.height = viewport.height
              await first.render({ canvas: surface, viewport }).promise
              data = await new Promise(resolve => surface.toBlob(resolve, 'image/png'))
            } finally { await doc.loadingTask.destroy() }
          }
        } catch (err) { console.warn('No se pudo cargar la portada:', err) }
      }
      const cover = data ? URL.createObjectURL(data instanceof Blob ? data : new Blob([data])) : null
      if (cover) newUrls.push(cover)
      return { ...book, cover }
    })
    if (generation !== loadGeneration) { newUrls.forEach(url => URL.revokeObjectURL(url)); return }
    shelfElement.hidden = false
    const openWork = work => {
      const index = books.findIndex(book => book.id === work.id)
      library.querySelectorAll('.book')[index]?.click()
    }
    shelf = mod.createShelf3D(shelfElement, lib, { works, onOpen: ({ work }) => openWork(work), onPeek: info => {
      peek.hidden = !info
      if (!info) return
      document.querySelector('#peek-title').textContent = info.work.title
      document.querySelector('#peek-read').textContent = tr(info.work.type === 'steam' ? 'Abrir juego' : 'Leer')
      document.querySelector('#peek-read').onclick = () => openWork(info.work)
    }, onManage: work => selectManagedItem(work) })
    document.querySelector('#peek-close').onclick = () => shelf?.unpeek()
    if (!shelf) { shelfElement.hidden = true; newUrls.forEach(url => URL.revokeObjectURL(url)) }
    else { coverUrls.push(...newUrls); if (books.length || isWallpaper) library.hidden = true; shelf.setManage(managing && !isWallpaper); if (zoom !== 1) shelf.setZoom(zoom) }
  } catch (err) {
    newUrls.forEach(url => URL.revokeObjectURL(url))
    if (generation === loadGeneration) { shelfElement.hidden = true; console.error('No se pudo abrir el estante:', err) }
  }
}
async function pageUrl(i, allowPrompt = false) {
  if (bookUrls.has(i)) {
    const url = bookUrls.get(i)
    bookUrls.delete(i); bookUrls.set(i, url)
    return url
  }
  if (pendingPageUrls.has(i)) {
    const version = generation
    const pending = pendingPageUrls.get(i)
    const url = await pending.task
    if (version !== generation) return null
    if (url || !allowPrompt || pending.allowPrompt) return url
    if (pendingPageUrls.get(i) === pending) pendingPageUrls.delete(i)
    return pageUrl(i, true)
  }
  const version = generation, activePdf = pdf, bookId = current
  const task = loadPageUrl(i, version, activePdf, bookId, allowPrompt)
  const pending = { task, allowPrompt }
  pendingPageUrls.set(i, pending)
  try { return await task } finally { if (pendingPageUrls.get(i) === pending) pendingPageUrls.delete(i) }
}
async function loadPageUrl(i, version, activePdf, bookId, allowPrompt) {
  let blob
  if (activePdf) {
    const p = await activePdf.getPage(i + 1), viewport = p.getViewport({ scale: 1.5 })
    const surface = document.createElement('canvas')
    surface.width = viewport.width; surface.height = viewport.height
    await p.render({ canvas: surface, viewport }).promise
    blob = await new Promise(resolve => surface.toBlob(resolve, 'image/png'))
  } else {
    const result = await window.reader.page(bookId, i, false, allowPrompt)
    if (result.deferred) return null
    blob = new Blob([result.data])
  }
  const url = URL.createObjectURL(blob)
  if (version !== generation) { URL.revokeObjectURL(url); throw new Error('El libro ya se cerró.') }
  bookUrls.set(i, url)
  while (bookUrls.size > 16) {
    const oldest = bookUrls.keys().next().value
    URL.revokeObjectURL(bookUrls.get(oldest)); bookUrls.delete(oldest)
  }
  return url
}
async function startBook() {
  const version = ++generation
  const mod = await import('./book3d.js')
  bookHost.hidden = false
  book3d = mod.createBook3D(bookHost, {
    total,
    src: () => '',
    whenReady: (i, callback) => pageUrl(i).then(url => { if (version === generation) callback(url) }).catch(err => { if (version === generation) { error.textContent = err.message; callback(null) } }),
    spreadOf: i => i === 0 ? [0] : [i % 2 ? i : i - 1, i % 2 ? i + 1 : i].filter(n => n < total),
    isWide: () => false,
    dir: () => readingDirection,
    paper: () => [0.96, 0.94, 0.88],
    double: () => false
  })
  if (!book3d) bookHost.hidden = true
}
async function showPage(direction = 0) {
  const request = ++pageRequest, version = generation, bookId = current, selected = page, activePdf = pdf
  const stale = () => request !== pageRequest || version !== generation
  if (book3d) {
    try { await pageUrl(selected, true) } catch (err) { if (stale()) return; throw err }
    if (stale()) return
    image.hidden = true; canvas.hidden = true
    if (direction) window.turnSound('low', direction)
    book3d.show([selected], direction)
  } else {
    image.hidden = Boolean(activePdf)
    canvas.hidden = !activePdf
    if (activePdf) {
      const pdfPage = await activePdf.getPage(selected + 1)
      const viewport = pdfPage.getViewport({ scale: 1.5 })
      const surface = document.createElement('canvas')
      surface.width = viewport.width; surface.height = viewport.height
      await pdfPage.render({ canvas: surface, viewport }).promise
      if (stale()) return
      canvas.width = surface.width; canvas.height = surface.height
      canvas.getContext('2d').drawImage(surface, 0, 0)
    } else {
      const result = await window.reader.page(bookId, selected, false)
      if (stale()) return
      if (imageUrl) URL.revokeObjectURL(imageUrl)
      imageUrl = URL.createObjectURL(new Blob([result.data]))
      image.src = imageUrl
    }
  }
  if (stale()) return
  await window.reader.progress(bookId, selected)
  if (stale()) return
  document.querySelector('#counter').textContent = `${selected + 1} / ${total}`
  document.querySelector('#previous').disabled = selected === 0
  document.querySelector('#next').disabled = selected === total - 1
  updateDesktopMenu()
}
function updateDesktopMenu() {
  document.querySelector('#reader-direction').value = readingDirection
  document.querySelector('#menu-direction').value = readingDirection
  const readerLevel = document.querySelector('#reader-zoom-level')
  if (readerLevel) readerLevel.textContent = `${Math.round(zoom * 100)} %`
  const readerZoomOut = document.querySelector('#reader-zoom-out'), readerZoomIn = document.querySelector('#reader-zoom-in')
  if (readerZoomOut) readerZoomOut.disabled = zoom <= 1
  if (readerZoomIn) readerZoomIn.disabled = zoom >= 3
  if (!isWallpaper) return
  const reading = !viewer.hidden
  document.querySelector('#menu-direction').hidden = !reading
  const leftIsNext = readingDirection === 'rtl'
  document.querySelector('#menu-back').hidden = !reading
  document.querySelector('#menu-left').disabled = reading ? (leftIsNext ? page >= total - 1 : page <= 0) : zoom <= 1
  document.querySelector('#menu-right').disabled = reading ? (leftIsNext ? page <= 0 : page >= total - 1) : zoom <= 1
  document.querySelector('#menu-left').title = tr(reading ? (leftIsNext ? 'Página siguiente' : 'Página anterior') : 'Mover estante a la izquierda (acerca para desplazar)')
  document.querySelector('#menu-right').title = tr(reading ? (leftIsNext ? 'Página anterior' : 'Página siguiente') : 'Mover estante a la derecha (acerca para desplazar)')
  document.querySelector('#menu-zoom-level').textContent = `${Math.round(zoom * 100)} %`
  document.querySelector('#menu-zoom-out').disabled = zoom <= 1
  document.querySelector('#menu-zoom-in').disabled = zoom >= 3
}
function setReadingDirection(direction, persist = true) {
  if (direction !== 'rtl' && direction !== 'ltr') return
  readingDirection = direction
  if (persist) { try { window.localStorage?.setItem('lectorobot-reading-direction', direction) } catch {} }
  if (!viewer.hidden && book3d) book3d.show([page])
  updateDesktopMenu()
}
function setDesktopZoom(next) {
  const previous = zoom
  zoom = Math.max(1, Math.min(3, Math.round(next * 100) / 100))
  if (viewer.hidden) shelf?.setZoom(zoom)
  else if (book3d) book3d.setZoom(zoom, 0, 0)
  else {
    flatPan = zoom === 1 ? { x: 0, y: 0 } : { x: flatPan.x * zoom / previous, y: flatPan.y * zoom / previous }
    drawFlatZoom()
  }
  updateDesktopMenu()
}
function drawFlatZoom() {
  for (const element of [image, canvas]) {
    element.style.transform = `translate(${flatPan.x}px, ${flatPan.y}px) scale(${zoom})`
    element.style.cursor = zoom > 1 ? (flatDrag ? 'grabbing' : 'grab') : ''
  }
}
for (const element of [image, canvas]) {
  element.addEventListener('pointerdown', event => {
    if (book3d || zoom <= 1 || event.button !== 0) return
    flatDrag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, ...flatPan }
    element.setPointerCapture(event.pointerId)
    drawFlatZoom()
    event.preventDefault()
  })
  element.addEventListener('pointermove', event => {
    if (!flatDrag || event.pointerId !== flatDrag.id) return
    flatPan = { x: flatDrag.x + event.clientX - flatDrag.x0, y: flatDrag.y + event.clientY - flatDrag.y0 }
    drawFlatZoom()
  })
  const end = event => { if (flatDrag && event.pointerId === flatDrag.id) { flatDrag = null; drawFlatZoom() } }
  element.addEventListener('pointerup', end)
  element.addEventListener('pointercancel', end)
}
async function showMenuCollections() {
  const panel = document.querySelector('#menu-lists'), toggle = document.querySelector('#menu-collections')
  if (!panel.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); return }
  const lists = await window.reader.collections()
  panel.replaceChildren()
  for (const list of lists) {
    const button = document.createElement('button')
    button.textContent = listLabel(list.name)
    button.setAttribute('aria-current', String(list.id === wallpaperCollection))
    button.onclick = () => attempt(async () => {
      await window.reader.switchWallpaperCollection(list.id)
      wallpaperCollection = list.id
      panel.hidden = true; toggle.setAttribute('aria-expanded', 'false')
      document.querySelector('#menu-current').textContent = listLabel(list.name)
      await showLibrary()
    })
    panel.append(button)
  }
  panel.hidden = false; toggle.setAttribute('aria-expanded', 'true')
}
async function refreshCollections(selected = collectionSelect.value || 'all') {
  const lists = (await window.reader.collections()).filter(list => list.id !== 'all')
  collectionSelect.replaceChildren()
  for (const list of lists) { const option = document.createElement('option'); option.value = list.id; option.textContent = listLabel(list.name); option.dataset.listName = list.name; collectionSelect.append(option) }
  collectionSelect.value = lists.some(list => list.id === selected) ? selected : lists[0]?.id || ''
  document.querySelector('#collection-delete-open').disabled = !collectionSelect.value
  document.querySelector('#add').disabled = !collectionSelect.value
  document.querySelector('#steam-refresh').hidden = lists.find(list => list.id === collectionSelect.value)?.name.toLocaleLowerCase() !== 'juegos'
}
async function refreshStatus() {
  const active = displaySelect.value ? await window.reader.wallpaperActive(displaySelect.value) : null
  const lists = await window.reader.collections()
  document.querySelector('#display-status').textContent = active ? tr('Mostrando: {name}', { name: listLabel(lists.find(list => list.id === active.collectionId)?.name || tr('Lista')) }) : tr('Sin estante activo')
  document.querySelector('#wallpaper-remove').disabled = !active
}
async function refreshDisplays() {
  const selected = displaySelect.value, displays = await window.reader.displays()
  displaySelect.replaceChildren()
  for (const display of displays) { const option = document.createElement('option'); option.value = display.id; option.textContent = display.label; displaySelect.append(option) }
  if (displays.some(display => display.id === selected)) displaySelect.value = selected
  await refreshStatus()
}
function selectManagedItem(item) {
  selectedItem = item
  document.querySelector('#file-manage-question').textContent = tr('¿Qué deseas hacer con «{name}»?', { name: item.title })
  document.querySelector('#file-manage-dialog').showModal()
}
function setManaging(value) {
  managing = value
  document.querySelector('#file-manage-open').setAttribute('aria-pressed', String(value))
  shelf?.setManage(value)
  document.body.classList.toggle('managing', value)
}
document.addEventListener('click', event => {
  const close = event.target.closest?.('[data-dialog-close]')
  if (close) close.closest('dialog')?.close()
})
document.querySelector('#collection-create-open').onclick = () => document.querySelector('#collection-create-dialog').showModal()
document.querySelector('#collection-delete-open').onclick = () => {
  document.querySelector('#collection-delete-question').textContent = tr('¿Quieres eliminar «{name}»? Los elementos que no estén en otra lista pasarán a la primera disponible. Los archivos originales no se borrarán.', { name: collectionSelect.selectedOptions[0]?.textContent || tr('esta lista') })
  document.querySelector('#collection-delete-dialog').showModal()
}
document.querySelector('#collection-delete-confirm').onclick = () => attempt(async () => {
  await window.reader.deleteCollection(collectionSelect.value)
  document.querySelector('#collection-delete-dialog').close()
  setManaging(false); await refreshCollections(); await showLibrary()
})
document.querySelector('#file-manage-open').onclick = () => setManaging(!managing)
document.querySelector('#file-delete-open').onclick = () => {
  document.querySelector('#file-manage-dialog').close()
  document.querySelector('#file-delete-question').textContent = tr('¿Quieres quitar «{name}» de tu biblioteca? El archivo original y los juegos instalados no se borrarán del equipo.', { name: selectedItem.title })
  document.querySelector('#file-delete-dialog').showModal()
}
document.querySelector('#file-delete-confirm').onclick = () => attempt(async () => {
  if (selectedItem.type === 'steam') await window.reader.removeItem(collectionSelect.value, selectedItem.id)
  else await window.reader.remove(selectedItem.id)
  document.querySelector('#file-delete-dialog').close()
  selectedItem = null; await showLibrary()
})
document.querySelector('#file-move-open').onclick = () => attempt(async () => {
  const destination = document.querySelector('#file-move-destination')
  destination.replaceChildren()
  for (const list of await window.reader.collections()) {
    if (list.id === 'all' || list.id === collectionSelect.value) continue
    const option = document.createElement('option'); option.value = list.id; option.textContent = listLabel(list.name); destination.append(option)
  }
  document.querySelector('#file-move-confirm').disabled = !destination.value
  document.querySelector('#file-manage-dialog').close()
  document.querySelector('#file-move-dialog').showModal()
})
document.querySelector('#file-move-confirm').onclick = () => attempt(async () => {
  await window.reader.moveItem(collectionSelect.value, document.querySelector('#file-move-destination').value, selectedItem.id)
  document.querySelector('#file-move-dialog').close()
  selectedItem = null; await showLibrary()
})
document.querySelector('#wallpaper-open').onclick = () => attempt(async () => {
  const select = document.querySelector('#wallpaper-collection')
  select.replaceChildren()
  for (const list of await window.reader.collections()) {
    if (list.id === 'all') continue
    const option = document.createElement('option'); option.value = list.id; option.textContent = listLabel(list.name); select.append(option)
  }
  select.value = collectionSelect.value
  await refreshDisplays()
  document.querySelector('#wallpaper-dialog').showModal()
})
document.querySelector('#add').onclick = () => attempt(async () => { if (!collectionSelect.value) throw new Error('Crea una lista primero.'); await window.reader.add(collectionSelect.value); await showLibrary() })
document.querySelector('#collection-create').onclick = () => attempt(async () => {
  const input = document.querySelector('#collection-name'), list = await window.reader.createCollection(input.value)
  input.value = ''; document.querySelector('#collection-create-dialog').close(); setManaging(false); await refreshCollections(list.id); await showLibrary()
})
collectionSelect.onchange = () => attempt(async () => {
  setManaging(false)
  const isGames = collectionSelect.selectedOptions[0]?.dataset.listName?.toLocaleLowerCase() === 'juegos'
  document.querySelector('#steam-refresh').hidden = !isGames
  if (isGames) await window.reader.refreshSteam()
  await showLibrary()
})
document.querySelector('#steam-refresh').onclick = () => attempt(async () => { await window.reader.refreshSteam(true); await showLibrary() })
displaySelect.onchange = () => attempt(refreshStatus)
document.querySelector('#wallpaper').onclick = () => attempt(async () => {
  const button = document.querySelector('#wallpaper'); button.disabled = true
  try { await window.reader.wallpaper(displaySelect.value, document.querySelector('#wallpaper-collection').value, document.querySelector('#wallpaper-format').value); await refreshStatus(); document.querySelector('#wallpaper-dialog').close() } finally { button.disabled = false }
})
document.querySelector('#wallpaper-remove').onclick = () => attempt(async () => { await window.reader.removeWallpaper(displaySelect.value); await refreshStatus() })
document.querySelector('#back').onclick = () => attempt(showLibrary)
async function movePage(direction) {
  const previous = page, target = page + direction, version = generation
  if (target < 0 || target >= total) return
  page = target
  const task = showPage(direction), request = pageRequest
  try { await task } catch (err) {
    if (version === generation && request === pageRequest) { page = previous; updateDesktopMenu() }
    throw err
  }
}
document.querySelector('#previous').onclick = () => attempt(() => movePage(-1))
document.querySelector('#next').onclick = () => attempt(() => movePage(1))
function navigateSide(left) { document.querySelector(left === (readingDirection === 'rtl') ? '#next' : '#previous').click() }
bookHost.onclick = event => navigateSide(event.clientX < innerWidth / 2)
document.addEventListener('keydown', event => {
  if (viewer.hidden || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target?.isContentEditable || event.target?.closest?.('input, select, textarea')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') navigateSide(event.key === 'ArrowLeft')
})
document.querySelector('#reader-direction').onchange = event => setReadingDirection(event.target.value)
document.querySelector('#menu-direction').onchange = event => setReadingDirection(event.target.value)
window.addEventListener?.('storage', event => { if (event.key === 'lectorobot-reading-direction') setReadingDirection(event.newValue, false) })
document.querySelector('#menu-collections').onclick = () => attempt(showMenuCollections)
document.querySelector('#menu-add').onclick = () => attempt(async () => { await window.reader.add(wallpaperCollection); if (viewer.hidden) await showLibrary() })
document.querySelector('#menu-refresh').onclick = () => attempt(async () => { await window.reader.refreshSteam(); await showLibrary() })
document.querySelector('#menu-back').onclick = () => attempt(showLibrary)
document.querySelector('#menu-left').onclick = () => { if (viewer.hidden) shelf?.moveHorizontal(-0.5); else navigateSide(true) }
document.querySelector('#menu-right').onclick = () => { if (viewer.hidden) shelf?.moveHorizontal(0.5); else navigateSide(false) }
document.querySelector('#menu-zoom-in').onclick = () => setDesktopZoom(zoom + 0.25)
document.querySelector('#menu-zoom-out').onclick = () => setDesktopZoom(zoom - 0.25)
document.querySelector('#menu-zoom-reset').onclick = () => setDesktopZoom(1)
document.querySelector('#reader-zoom-in').onclick = () => setDesktopZoom(zoom + 0.25)
document.querySelector('#reader-zoom-out').onclick = () => setDesktopZoom(zoom - 0.25)
document.querySelector('#reader-zoom-reset').onclick = () => setDesktopZoom(1)
async function refreshLanguage(settings, redraw = true) {
  translateInterface(settings)
  if (!isWallpaper) {
    await refreshCollections()
    await refreshDisplays()
  } else {
    const lists = await window.reader.collections()
    document.querySelector('#menu-current').textContent = listLabel(lists.find(list => list.id === wallpaperCollection)?.name || tr('Lista'))
  }
  if (redraw && viewer.hidden) await showLibrary()
}
document.querySelector('#language').onchange = () => attempt(async () => {
  const value = document.querySelector('#language').value
  try { await window.reader.languageSet(value) } catch (err) { document.querySelector('#language').value = languagePreference; throw err }
})
window.reader.onLanguageChanged?.(settings => { attempt(() => refreshLanguage(settings)) })
attempt(async () => {
  const settings = await window.reader.languageGet?.() || { preference: 'auto', system: systemLanguage }
  await refreshLanguage(settings, false)
  await showLibrary()
})
window.reader.onLibraryChanged(() => { if (viewer.hidden) attempt(showLibrary) })
window.reader.onDisplaysChanged(() => { if (!isWallpaper) attempt(refreshDisplays) })
window.reader.onWallpaperChanged(() => { if (!isWallpaper) attempt(refreshStatus) })
window.reader.onWallpaperCollectionChanged?.(id => { if (isWallpaper) { wallpaperCollection = id; attempt(async () => { const lists = await window.reader.collections(); document.querySelector('#menu-current').textContent = listLabel(lists.find(list => list.id === id)?.name || tr('Lista')); await showLibrary() }) } })
if (isWallpaper) {
  document.querySelector('header').hidden = true
  document.body.classList.add('wallpaper')
  if (params.get('format') === 'centered') document.body.classList.add('centered')
  document.querySelector('#desktop-menu').hidden = false
}
