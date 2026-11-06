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
let current, total, page, imageUrl, pdf, shelf, coverUrls = [], book3d, bookUrls = new Map(), generation = 0, zoom = 1
const attempt = async action => { try { error.textContent = ''; await action() } catch (err) { error.textContent = err.message } }
async function showLibrary() {
  const loadGeneration = ++generation
  zoom = 1
  image.style.transform = ''; canvas.style.transform = ''
  book3d?.destroy(); book3d = null; bookHost.hidden = true
  for (const url of bookUrls.values()) URL.revokeObjectURL(url)
  bookUrls.clear()
  viewer.hidden = true
  updateDesktopMenu()
  peek.hidden = true
  shelf?.destroy(); shelf = null
  shelfElement.hidden = true
  coverUrls.forEach(url => URL.revokeObjectURL(url)); coverUrls = []
  library.hidden = false
  library.replaceChildren()
  const selected = isWallpaper ? wallpaperCollection : collectionSelect.value || 'all'
  const books = await window.reader.library(isWallpaper ? selected : 'all')
  if (generation !== loadGeneration) return
  const members = !isWallpaper && selected !== 'all' ? new Set(await window.reader.members(selected)) : null
  if (generation !== loadGeneration) return
  if (!isWallpaper) document.querySelector('#membership-help').textContent = members ? 'Marca los libros que pertenecen a esta lista.' : 'Toda la biblioteca incluye todos los libros. Crea una lista para organizar un mueble.'
  if (!books.length) { library.textContent = 'Añade tus archivos CBZ, CBR o PDF para empezar.'; if (!isWallpaper) return }
  for (const book of books) {
    const button = document.createElement(isWallpaper ? 'button' : 'div')
    button.className = 'book'
    button.dataset.id = book.id
    button.textContent = book.title
    const openBook = () => attempt(async () => {
      const result = await window.reader.open(book.id)
      current = book.id; total = result.total; page = result.page
      pdf = null
      if (result.type === 'pdf') {
        const pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
        pdf = await pdfjs.getDocument({ data: result.data }).promise
        total = pdf.numPages
        page = Math.min(page, total - 1)
      }
      document.querySelector('#title').textContent = result.title
      library.hidden = true; peek.hidden = true; shelfElement.hidden = true; shelf?.destroy(); shelf = null; viewer.hidden = false
      zoom = 1; updateDesktopMenu()
      await startBook()
      await showPage()
    })
    if (isWallpaper) button.addEventListener('click', openBook)
    const card = document.createElement('div')
    const remove = document.createElement('button')
    remove.className = 'remove'
    remove.textContent = `Quitar ${book.title} de la biblioteca`
    remove.onclick = () => attempt(async () => { await window.reader.remove(book.id); await showLibrary() })
    card.append(button)
    if (members) {
      const label = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span')
      label.className = 'membership'; checkbox.type = 'checkbox'; checkbox.checked = members.has(book.id)
      text.textContent = 'En esta lista'
      checkbox.onchange = () => attempt(async () => {
        const checked = checkbox.checked
        try { await window.reader.setMembership(selected, book.id, checked) } catch (err) { checkbox.checked = !checked; throw err }
      })
      label.append(checkbox, text); card.append(label)
    }
    card.append(remove)
    library.append(card)
  }
  if (!isWallpaper) return
  try {
    const [lib, mod] = await Promise.all([import('./book3d.js'), import('./shelf3d.js')])
    if (generation !== loadGeneration) return
    const newUrls = []
    const works = await Promise.all(books.map(async book => {
      let data = await window.reader.cover(book.id).catch(() => null)
      if (!data && book.type === 'pdf') {
        try {
          const pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
          pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
          const doc = await pdfjs.getDocument({ data: (await window.reader.open(book.id)).data }).promise
          const first = await doc.getPage(1), viewport = first.getViewport({ scale: 0.5 })
          const surface = document.createElement('canvas')
          surface.width = viewport.width; surface.height = viewport.height
          await first.render({ canvas: surface, viewport }).promise
          data = await new Promise(resolve => surface.toBlob(resolve, 'image/png'))
          await doc.destroy()
        } catch (err) { console.warn('No se pudo cargar la portada:', err) }
      }
      const cover = data ? URL.createObjectURL(data instanceof Blob ? data : new Blob([data])) : null
      if (cover) newUrls.push(cover)
      return { ...book, cover }
    }))
    if (generation !== loadGeneration) { newUrls.forEach(url => URL.revokeObjectURL(url)); return }
    coverUrls.push(...newUrls)
    shelfElement.hidden = false
    const openWork = work => {
      const index = books.findIndex(book => book.id === work.id)
      library.querySelectorAll('.book')[index]?.click()
    }
    shelf = mod.createShelf3D(shelfElement, lib, { works, onOpen: ({ work }) => openWork(work), onPeek: info => {
      peek.hidden = !info
      if (!info) return
      document.querySelector('#peek-title').textContent = info.work.title
      document.querySelector('#peek-read').onclick = () => openWork(info.work)
    } })
    document.querySelector('#peek-close').onclick = () => shelf?.unpeek()
    if (!shelf) shelfElement.hidden = true
    else if (zoom !== 1) shelf.setZoom(zoom)
  } catch (err) { shelfElement.hidden = true; console.error('No se pudo abrir el estante:', err) }
}
async function pageUrl(i) {
  if (bookUrls.has(i)) return bookUrls.get(i)
  const version = generation, activePdf = pdf, bookId = current
  let blob
  if (activePdf) {
    const p = await activePdf.getPage(i + 1), viewport = p.getViewport({ scale: 1.5 })
    const surface = document.createElement('canvas')
    surface.width = viewport.width; surface.height = viewport.height
    await p.render({ canvas: surface, viewport }).promise
    blob = await new Promise(resolve => surface.toBlob(resolve, 'image/png'))
  } else {
    const result = await window.reader.page(bookId, i, false)
    blob = new Blob([result.data])
  }
  const url = URL.createObjectURL(blob)
  if (version !== generation) { URL.revokeObjectURL(url); throw new Error('El libro ya se cerró.') }
  bookUrls.set(i, url)
  return url
}
async function startBook() {
  const version = ++generation
  const mod = await import('./book3d.js')
  bookHost.hidden = false
  book3d = mod.createBook3D(bookHost, {
    total,
    src: () => '',
    whenReady: (i, callback) => pageUrl(i).then(url => { if (version === generation) callback(url) }).catch(err => { error.textContent = err.message }),
    spreadOf: i => i === 0 ? [0] : [i % 2 ? i : i - 1, i % 2 ? i + 1 : i].filter(n => n < total),
    isWide: () => false,
    dir: () => 'rtl',
    paper: () => [0.96, 0.94, 0.88],
    double: () => false
  })
  if (!book3d) bookHost.hidden = true
}
async function showPage(direction = 0) {
  if (book3d) {
    image.hidden = true; canvas.hidden = true
    if (direction) window.turnSound('low', direction)
    book3d.show([page], direction)
    await window.reader.progress(current, page)
  } else {
  image.hidden = Boolean(pdf)
  canvas.hidden = !pdf
  if (pdf) {
    const pdfPage = await pdf.getPage(page + 1)
    const viewport = pdfPage.getViewport({ scale: 1.5 })
    canvas.width = viewport.width; canvas.height = viewport.height
    await pdfPage.render({ canvas, viewport }).promise
    await window.reader.progress(current, page)
  } else {
    const result = await window.reader.page(current, page)
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    imageUrl = URL.createObjectURL(new Blob([result.data]))
    image.src = imageUrl
  }
  }
  document.querySelector('#counter').textContent = `${page + 1} / ${total}`
  document.querySelector('#previous').disabled = page === 0
  document.querySelector('#next').disabled = page === total - 1
  updateDesktopMenu()
}
function updateDesktopMenu() {
  if (!isWallpaper) return
  const reading = !viewer.hidden
  document.querySelector('#menu-back').hidden = !reading
  document.querySelector('#menu-left').disabled = reading ? page >= total - 1 : zoom <= 1
  document.querySelector('#menu-right').disabled = reading ? page <= 0 : zoom <= 1
  document.querySelector('#menu-left').title = reading ? 'Página siguiente' : 'Mover estante a la izquierda (acerca para desplazar)'
  document.querySelector('#menu-right').title = reading ? 'Página anterior' : 'Mover estante a la derecha (acerca para desplazar)'
  document.querySelector('#menu-zoom-level').textContent = `${Math.round(zoom * 100)} %`
  document.querySelector('#menu-zoom-out').disabled = zoom <= 1
  document.querySelector('#menu-zoom-in').disabled = zoom >= 3
}
function setDesktopZoom(next) {
  zoom = Math.max(1, Math.min(3, Math.round(next * 100) / 100))
  if (viewer.hidden) shelf?.setZoom(zoom)
  else if (book3d) book3d.setZoom(zoom, 0, 0)
  else { image.style.transform = `scale(${zoom})`; canvas.style.transform = `scale(${zoom})` }
  updateDesktopMenu()
}
async function showMenuCollections() {
  const panel = document.querySelector('#menu-lists'), toggle = document.querySelector('#menu-collections')
  if (!panel.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); return }
  const lists = await window.reader.collections()
  panel.replaceChildren()
  for (const list of lists) {
    const button = document.createElement('button')
    button.textContent = list.name
    button.setAttribute('aria-current', String(list.id === wallpaperCollection))
    button.onclick = () => attempt(async () => {
      await window.reader.switchWallpaperCollection(list.id)
      wallpaperCollection = list.id
      panel.hidden = true; toggle.setAttribute('aria-expanded', 'false')
      document.querySelector('#menu-current').textContent = list.name
      await showLibrary()
    })
    panel.append(button)
  }
  panel.hidden = false; toggle.setAttribute('aria-expanded', 'true')
}
async function refreshCollections(selected = collectionSelect.value || 'all') {
  const lists = await window.reader.collections()
  collectionSelect.replaceChildren()
  for (const list of lists) { const option = document.createElement('option'); option.value = list.id; option.textContent = list.name; collectionSelect.append(option) }
  collectionSelect.value = lists.some(list => list.id === selected) ? selected : 'all'
}
async function refreshStatus() {
  const active = displaySelect.value ? await window.reader.wallpaperActive(displaySelect.value) : null
  const lists = await window.reader.collections()
  document.querySelector('#display-status').textContent = active ? `Mostrando: ${lists.find(list => list.id === active.collectionId)?.name || 'Lista'}` : 'Sin estante activo'
  document.querySelector('#wallpaper-remove').disabled = !active
}
async function refreshDisplays() {
  const selected = displaySelect.value, displays = await window.reader.displays()
  displaySelect.replaceChildren()
  for (const display of displays) { const option = document.createElement('option'); option.value = display.id; option.textContent = display.label; displaySelect.append(option) }
  if (displays.some(display => display.id === selected)) displaySelect.value = selected
  await refreshStatus()
}
document.querySelector('#add').onclick = () => attempt(async () => { await window.reader.add(collectionSelect.value || 'all'); await showLibrary() })
document.querySelector('#collection-create').onclick = () => attempt(async () => {
  const input = document.querySelector('#collection-name'), list = await window.reader.createCollection(input.value)
  input.value = ''; await refreshCollections(list.id); await showLibrary()
})
collectionSelect.onchange = () => attempt(showLibrary)
displaySelect.onchange = () => attempt(refreshStatus)
document.querySelector('#wallpaper').onclick = () => attempt(async () => {
  const button = document.querySelector('#wallpaper'); button.disabled = true
  try { await window.reader.wallpaper(displaySelect.value, collectionSelect.value); await refreshStatus() } finally { button.disabled = false }
})
document.querySelector('#wallpaper-remove').onclick = () => attempt(async () => { await window.reader.removeWallpaper(displaySelect.value); await refreshStatus() })
document.querySelector('#back').onclick = () => attempt(showLibrary)
document.querySelector('#previous').onclick = () => attempt(async () => { if (page > 0) { page--; await showPage(-1) } })
document.querySelector('#next').onclick = () => attempt(async () => { if (page < total - 1) { page++; await showPage(1) } })
bookHost.onclick = event => { if (event.clientX < innerWidth / 2) document.querySelector('#next').click(); else document.querySelector('#previous').click() }
document.addEventListener('keydown', event => { if (!viewer.hidden && event.key === 'ArrowLeft') document.querySelector('#next').click(); if (!viewer.hidden && event.key === 'ArrowRight') document.querySelector('#previous').click() })
document.querySelector('#menu-collections').onclick = () => attempt(showMenuCollections)
document.querySelector('#menu-refresh').onclick = () => attempt(showLibrary)
document.querySelector('#menu-back').onclick = () => attempt(showLibrary)
document.querySelector('#menu-left').onclick = () => { if (viewer.hidden) shelf?.moveHorizontal(-0.5); else document.querySelector('#next').click() }
document.querySelector('#menu-right').onclick = () => { if (viewer.hidden) shelf?.moveHorizontal(0.5); else document.querySelector('#previous').click() }
document.querySelector('#menu-zoom-in').onclick = () => setDesktopZoom(zoom + 0.25)
document.querySelector('#menu-zoom-out').onclick = () => setDesktopZoom(zoom - 0.25)
if (isWallpaper) attempt(showLibrary)
else attempt(async () => { await refreshCollections(); await refreshDisplays(); await showLibrary() })
window.reader.onLibraryChanged(() => { if (viewer.hidden) attempt(showLibrary) })
window.reader.onDisplaysChanged(() => { if (!isWallpaper) attempt(refreshDisplays) })
window.reader.onWallpaperChanged(() => { if (!isWallpaper) attempt(refreshStatus) })
if (isWallpaper) {
  document.querySelector('header').hidden = true
  document.body.classList.add('wallpaper')
  document.querySelector('#desktop-menu').hidden = false
  attempt(async () => { const lists = await window.reader.collections(); document.querySelector('#menu-current').textContent = lists.find(list => list.id === wallpaperCollection)?.name || 'Lista' })
}
