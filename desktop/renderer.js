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
const boxCache = new Map(), spineCache = new Map()
// Cómo abrir cada libro (por id) y los capítulos de al lado del que se lee, para seguir con el siguiente al acabar.
let openers = new Map(), neighbors = {}
let current, total, page, imageUrl, pdf, shelf, coverUrls = [], book3d, bookUrls = new Map(), pendingPageUrls = new Map(), generation = 0, pageRequest = 0, zoom = 1
const attempt = async action => { try { error.textContent = ''; await action() } catch (err) { error.textContent = err.message } }
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
  const loadGeneration = ++generation
  pageRequest++
  zoom = 1
  image.style.transform = ''; canvas.style.transform = ''
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
  coverUrls.forEach(url => URL.revokeObjectURL(url)); coverUrls = []; boxCache.clear(); spineCache.clear()
  library.hidden = false
  library.replaceChildren()
  const selected = isWallpaper ? wallpaperCollection : collectionSelect.value || 'all'
  const books = await window.reader.library(isWallpaper ? selected : 'all')
  if (generation !== loadGeneration) return
  const members = !isWallpaper && selected !== 'all' ? new Set(await window.reader.members(selected)) : null
  if (generation !== loadGeneration) return
  if (!isWallpaper) document.querySelector('#membership-help').textContent = members ? 'Marca los libros que pertenecen a esta lista.' : 'Toda la biblioteca incluye todos los libros. Crea una lista para organizar un mueble.'
  if (!books.length) { library.textContent = 'Añade tus archivos CBZ, CBR o PDF, o importa tus juegos de Steam, para empezar.'; if (!isWallpaper) return }
  openers = new Map()
  for (const book of books) {
    const button = document.createElement(isWallpaper ? 'button' : 'div')
    button.className = 'book'
    button.dataset.id = book.id
    button.textContent = book.title
    if (book.type === 'steam') { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = book.installed === false ? 'STEAM · NO INSTALADO' : 'STEAM'; button.append(tag) }
    // start: página donde empezar (0, 'last'); sin ella, donde se dejó.
    const openBook = ({ start } = {}) => attempt(async () => {
      if (book.type === 'steam') { await window.reader.open(book.id); peek.hidden = true; shelf?.unpeek(); return }
      const result = await window.reader.open(book.id)
      // Si ya había un libro abierto (se pasa al capítulo siguiente), se cierra el anterior.
      book3d?.destroy(); book3d = null
      if (pdf) { const previousPdf = pdf; previousPdf.loadingTask.destroy().catch(() => {}) }
      for (const url of bookUrls.values()) URL.revokeObjectURL(url)
      bookUrls.clear(); pendingPageUrls.clear()
      current = book.id; total = result.total; page = start === 0 ? 0 : result.page
      if (start === 'last' && total) page = total - 1
      neighbors = { next: await window.reader.neighbor(book.id, 1).catch(() => null), prev: await window.reader.neighbor(book.id, -1).catch(() => null) }
      pdf = null
      if (result.type === 'pdf') {
        const pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
        pdf = await loadPdf(pdfjs, result, book.id, err => { error.textContent = err.message })
        total = pdf.numPages
        page = start === 'last' ? total - 1 : Math.min(page, total - 1)
      }
      document.querySelector('#title').textContent = result.title
      library.hidden = true; peek.hidden = true; shelfElement.hidden = true; shelf?.destroy(); shelf = null; viewer.hidden = false
      zoom = 1; updateDesktopMenu()
      try { await startBook(); await showPage() } catch (err) { await showLibrary(); throw err }
    })
    openers.set(book.id, openBook)
    if (isWallpaper) button.addEventListener('click', () => openBook())
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
  const newUrls = []
  try {
    const [lib, mod] = await Promise.all([import('./book3d.js'), import('./shelf3d.js')])
    if (generation !== loadGeneration) return
    const bookWorks = await mapLimited(books, 3, async book => {
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
      // Un juego sin portada en ninguna fuente: se compone con la cabecera de la tienda y se guarda.
      if (!data && book.type === 'steam') data = await composedCover(book).catch(() => null)
      if (generation !== loadGeneration) return null
      const cover = data ? URL.createObjectURL(data instanceof Blob ? data : new Blob([data])) : null
      if (cover) newUrls.push(cover)
      return { ...book, cover, spineOut: book.type === 'steam' } // los juegos, de lomo, como cajas apiladas
    })
    if (generation !== loadGeneration) { newUrls.forEach(url => URL.revokeObjectURL(url)); return }
    // Los capítulos de una misma obra van juntos, como tomos de una serie: un pósit por obra y de frente el que se lee.
    const groups = await window.reader.shelfWorks(selected)
    if (generation !== loadGeneration) { newUrls.forEach(url => URL.revokeObjectURL(url)); return }
    const byId = new Map(bookWorks.filter(Boolean).map(work => [work.id, work]))
    const works = groups.map(item => item.kind === 'book' ? byId.get(item.id) : {
      id: item.id, type: 'series', title: item.title, chapterId: item.chapterId,
      cover: byId.get(item.vols[0].chapters[0])?.cover || null,
      vols: item.vols.map(vol => ({ vol: vol.vol, label: vol.label, chapters: vol.chapters, pages: vol.pages, thumb: byId.get(vol.chapters[0])?.cover || null }))
    }).filter(Boolean)
    // Los juegos sin instalar van al final, en su propia balda, envueltos en plástico y con un pósit encima.
    const loose = works.filter(work => work.type === 'steam' && work.installed === false)
    if (loose.length) {
      works.splice(0, works.length, ...works.filter(work => !loose.includes(work)), ...loose)
      loose.forEach(work => { work.wrapped = true })
      Object.assign(loose[0], { rowBreak: true, noteTitle: 'No instalados' })
    }
    shelfElement.hidden = false
    // Un tomo de una obra se abre por el capítulo que se estaba leyendo, si es suyo, o por el primero.
    const openWork = (work, vol) => {
      if (work.type !== 'series') return openers.get(work.id)?.()
      const tome = vol || work.vols[0]
      return openers.get(tome.chapters.includes(work.chapterId) ? work.chapterId : tome.chapters[0])?.()
    }
    shelf = mod.createShelf3D(shelfElement, lib, { works, boxArtOf: gameBoxArt, noteFor: work => work.type !== 'steam' || Boolean(work.noteTitle), onOpen: ({ work, vol }) => openWork(work, vol), onPeek: info => {
      // Los juegos no llevan pósit: la caja se gira con el ratón y se abre con un clic sobre ella.
      peek.hidden = !info || info.work.type === 'steam'
      if (peek.hidden) return
      document.querySelector('#peek-title').textContent = info.work.type === 'series' && info.vol?.label ? `${info.work.title} · ${info.vol.label}` : info.work.title
      document.querySelector('#peek-read').onclick = () => openWork(info.work, info.vol)
    } })
    document.querySelector('#peek-close').onclick = () => shelf?.unpeek()
    if (!shelf) { shelfElement.hidden = true; newUrls.forEach(url => URL.revokeObjectURL(url)) }
    else {
      coverUrls.push(...newUrls); if (zoom !== 1) shelf.setZoom(zoom)
      // Las obras de manga: sus tomos de verdad (reparto, portadas, contraportadas) y su logo, como en manga-reader.
      // Lo que no tenga portada en línea conserva la local (la primera página del capítulo).
      const series = works.filter(work => work.type === 'series')
      mapLimited(series, 2, async work => {
        const tomes = await window.reader.seriesTomes(work.id).catch(() => null)
        if (!tomes || generation !== loadGeneration || !shelf) return
        const local = new Map(work.vols.flatMap(vol => vol.chapters.map(id => [id, vol.thumb])))
        const vols = tomes.vols.map(vol => vol.thumb ? vol : { ...vol, thumb: local.get(vol.chapters[0]) || null })
        work.vols = vols
        shelf.setVolumes(work.id, vols)
        const logo = await window.reader.seriesLogo(work.id).catch(() => null)
        if (!logo || generation !== loadGeneration || !shelf) return
        const url = URL.createObjectURL(new Blob([logo])); coverUrls.push(url); shelf.setLogo(work.id, url)
      }).catch(() => {})
      // Cada juego, con su lomo: el escaneo real o uno compuesto con su portada y su logo.
      const games = works.filter(work => work.type === 'steam')
      mapLimited(games, 4, work => gameSpine(work).then(url => { if (generation === loadGeneration && shelf && url) shelf.setSpine(work.id, url) }).catch(() => {}))
        // Después, sin prisa, las contraportadas: al sacar una caja ya estará lista (y guardada para la próxima vez).
        .then(() => generation === loadGeneration && mapLimited(games, 2, work => generation === loadGeneration ? gameBoxArt(work)?.catch(() => null) : null)).catch(() => {})
    }
  } catch (err) {
    newUrls.forEach(url => URL.revokeObjectURL(url))
    if (generation === loadGeneration) { shelfElement.hidden = true; console.error('No se pudo abrir el estante:', err) }
  }
}
// Lomo y contraportada de la caja de un juego: los escaneos reales o, si faltan, compuestos aquí. Solo se piden al sacar la caja.
// Guarda en el disco una cara compuesta aquí, para no volver a componerla.
const keepArt = (id, kind, blob, keep = true) => {
  if (!keep) return blob
  blob.arrayBuffer().then(buffer => window.reader.saveGameArt(id, kind, new Uint8Array(buffer))).catch(err => console.warn('No se pudo guardar la caja:', err)); return blob }
async function composedCover(book) {
  const [parts, art] = await Promise.all([window.reader.gameHeader(book.id), import('./boxart.js')])
  const urls = [parts.header, parts.logo].map(bytes => bytes ? URL.createObjectURL(new Blob([bytes])) : null)
  try { return keepArt(book.id, 'cover', await art.composeCover({ title: book.title, header: urls[0], logo: urls[1] })) } finally { urls.forEach(url => url && URL.revokeObjectURL(url)) }
}
const ownUrl = (urls, data) => { const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); urls.push(url); return url }
function gameSpine(work) {
  if (!spineCache.has(work.id)) {
    const urls = coverUrls
    const task = (async () => {
      const [box, art] = await Promise.all([window.reader.gameSpine(work.id), import('./boxart.js')])
      if (box.spine || box.generated) return ownUrl(urls, box.spine || box.generated)
      const logo = box.logo ? ownUrl(urls, box.logo) : null, companies = box.companies.map(item => ({ name: item.name, logo: item.logo ? ownUrl(urls, item.logo) : null }))
      const hero = box.art ? ownUrl(urls, box.art) : null
      return ownUrl(urls, keepArt(work.id, `spine-${box.style}`, await art.composeSpine({ title: work.title, cover: work.cover, logo, art: hero, companies, style: box.style }), box.complete !== false))
    })()
    task.catch(err => { console.warn('No se pudo preparar el lomo:', err); if (spineCache.get(work.id) === task) spineCache.delete(work.id) })
    spineCache.set(work.id, task)
  }
  return spineCache.get(work.id)
}
function gameBoxArt(work) {
  if (work.type !== 'steam') return null
  if (!boxCache.has(work.id)) {
    const urls = coverUrls, own = data => ownUrl(urls, data)
    const task = (async () => {
      const [box, art] = await Promise.all([window.reader.gameBox(work.id), import('./boxart.js')])
      const compose = async () => {
        const logo = box.logo ? own(box.logo) : null, hero = box.hero ? own(box.hero) : null, shots = box.shots.map(own)
        const companies = box.companies.map(item => ({ name: item.name, logo: item.logo ? own(item.logo) : null }))
        const blob = await art.composeBack({ title: work.title, description: box.description, cover: work.cover, logo, hero, shots, companies, developers: box.developers, publishers: box.publishers })
        return own(keepArt(work.id, 'back', blob, box.complete !== false))
      }
      const inside = async () => {
        if (box.generatedInside) return own(box.generatedInside)
        const blob = await art.composeInside({ title: work.title, disc: box.disc ? own(box.disc) : null, cover: work.cover, logo: box.logo ? own(box.logo) : null, art: box.art ? own(box.art) : null })
        return own(keepArt(work.id, 'inside', blob))
      }
      const [spine, back, inner] = await Promise.all([gameSpine(work), box.back || box.generatedBack ? own(box.back || box.generatedBack) : compose(), inside()])
      return { spine, back, inside: inner }
    })()
    task.catch(err => { console.warn('No se pudo preparar la caja:', err); if (boxCache.get(work.id) === task) boxCache.delete(work.id) })
    boxCache.set(work.id, task)
  }
  return boxCache.get(work.id)
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
    dir: () => 'rtl',
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
  document.querySelector('#previous').disabled = selected === 0 && !neighbors.prev
  document.querySelector('#next').disabled = selected === total - 1 && !neighbors.next
  updateDesktopMenu()
}
function updateDesktopMenu() {
  if (!isWallpaper) return
  const reading = !viewer.hidden
  document.querySelector('#menu-back').hidden = !reading
  document.querySelector('#menu-left').disabled = reading ? page >= total - 1 && !neighbors.next : zoom <= 1
  document.querySelector('#menu-right').disabled = reading ? page <= 0 && !neighbors.prev : zoom <= 1
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
document.querySelector('#steam-import').onclick = () => attempt(async () => {
  const button = document.querySelector('#steam-import'); button.disabled = true
  try {
    const { added, installed, missing, source } = await window.reader.importSteam(collectionSelect.value || 'all')
    await showLibrary()
    const from = source === 'api' ? 'según la Web API' : 'jugados alguna vez en este PC'
    document.querySelector('#membership-help').textContent = `Steam: ${installed} instalados y ${missing} sin instalar (${from}); ${added} nuevos en la biblioteca.`
  } finally { button.disabled = false }
})
const launchboxText = status => status.updated ? `${status.count} cajas reales · actualizado ${new Date(status.updated).toLocaleDateString()}` : 'Sin descargar'
async function refreshLaunchbox() { document.querySelector('#launchbox-status').textContent = launchboxText(await window.reader.launchboxStatus()) }
document.querySelector('#launchbox-update').onclick = () => attempt(async () => {
  const button = document.querySelector('#launchbox-update'), status = document.querySelector('#launchbox-status')
  button.disabled = true; status.textContent = 'Descargando…'
  try { status.textContent = launchboxText(await window.reader.updateLaunchbox()) } catch (err) { await refreshLaunchbox().catch(() => {}); throw err } finally { button.disabled = false }
})
window.reader.onLaunchboxProgress?.(({ phase, done, total }) => {
  const pct = total ? ` ${Math.round((done / total) * 100)} %` : ` ${Math.round(done / 1048576)} MiB`
  document.querySelector('#launchbox-status').textContent = (phase === 'download' ? 'Descargando' : 'Indexando') + pct
})
// Carpetas de la biblioteca: se revisan al arrancar; lo que se agregue o quite en ellas entra o sale solo.
async function refreshFolders() {
  const list = document.querySelector('#folders')
  list.replaceChildren()
  for (const folder of await window.reader.folders()) {
    const row = document.createElement('div'), name = document.createElement('code'), drop = document.createElement('button')
    row.className = 'folder'; name.textContent = folder; drop.textContent = 'Quitar'; drop.className = 'remove'
    drop.onclick = () => attempt(async () => { const r = await window.reader.removeFolder(folder); await refreshFolders(); await showLibrary(); folderStatus(r) })
    row.append(name, drop); list.append(row)
  }
  if (!list.children.length) list.textContent = 'Ninguna carpeta todavía.'
}
const folderStatus = r => { if (r) document.querySelector('#folders-status').textContent = `${r.total} archivos de carpetas · ${r.added} nuevos · ${r.removed} quitados` }
const addFolder = () => attempt(async () => { const r = await window.reader.addFolder(); if (!r) return; await refreshFolders(); await showLibrary(); folderStatus(r) })
document.querySelector('#folder-add').onclick = addFolder
document.querySelector('#folder-add-settings').onclick = addFolder
document.querySelector('#folders-scan').onclick = () => attempt(async () => { folderStatus(await window.reader.scanFolders()); await showLibrary() })
document.querySelector('#spine-style').onchange = () => attempt(async () => {
  const status = document.querySelector('#settings-status')
  await window.reader.saveSettings({ spineStyle: document.querySelector('#spine-style').value })
  status.textContent = 'Estilo guardado: los lomos del estante se rehacen al recargarse.'
})
document.querySelector('#sgdb-save').onclick = () => attempt(async () => {
  const button = document.querySelector('#sgdb-save'), status = document.querySelector('#settings-status')
  button.disabled = true; status.textContent = 'Comprobando…'
  try {
    const { warning } = await window.reader.saveSettings({ steamGridDbKey: document.querySelector('#sgdb-key').value, steamWebApiKey: document.querySelector('#steam-api-key').value })
    status.textContent = warning || 'Guardado.'
  } catch (err) { status.textContent = ''; throw err } finally { button.disabled = false }
})
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
async function movePage(direction) {
  const previous = page, target = page + direction, version = generation
  if (target < 0 || target >= total) {
    // Al pasar de la última página (o antes de la primera), el capítulo siguiente (o el anterior) de la misma obra.
    const other = direction > 0 ? neighbors.next : neighbors.prev
    if (other && openers.has(other.id)) await openers.get(other.id)({ start: direction > 0 ? 0 : 'last' })
    return
  }
  page = target
  const task = showPage(direction), request = pageRequest
  try { await task } catch (err) {
    if (version === generation && request === pageRequest) { page = previous; updateDesktopMenu() }
    throw err
  }
}
document.querySelector('#previous').onclick = () => attempt(() => movePage(-1))
document.querySelector('#next').onclick = () => attempt(() => movePage(1))
bookHost.onclick = event => { if (event.clientX < innerWidth / 2) document.querySelector('#next').click(); else document.querySelector('#previous').click() }
document.addEventListener('keydown', event => { if (viewer.hidden && shelf?.peeked() && event.key === 'ArrowLeft') shelf.turnPeek(-1); if (viewer.hidden && shelf?.peeked() && event.key === 'ArrowRight') shelf.turnPeek(1); if (!viewer.hidden && event.key === 'ArrowLeft') document.querySelector('#next').click(); if (!viewer.hidden && event.key === 'ArrowRight') document.querySelector('#previous').click() })
document.querySelector('#menu-collections').onclick = () => attempt(showMenuCollections)
document.querySelector('#menu-refresh').onclick = () => attempt(showLibrary)
document.querySelector('#menu-back').onclick = () => attempt(showLibrary)
document.querySelector('#menu-left').onclick = () => { if (viewer.hidden) shelf?.moveHorizontal(-0.5); else document.querySelector('#next').click() }
document.querySelector('#menu-right').onclick = () => { if (viewer.hidden) shelf?.moveHorizontal(0.5); else document.querySelector('#previous').click() }
document.querySelector('#menu-zoom-in').onclick = () => setDesktopZoom(zoom + 0.25)
document.querySelector('#menu-zoom-out').onclick = () => setDesktopZoom(zoom - 0.25)
if (isWallpaper) attempt(showLibrary)
else {
  attempt(async () => { await refreshCollections(); await refreshDisplays(); await showLibrary() })
  window.reader.settings?.().then(value => { document.querySelector('#sgdb-key').value = value.steamGridDbKey; document.querySelector('#steam-api-key').value = value.steamWebApiKey || ''; document.querySelector('#spine-style').value = value.spineStyle || 'banda' }).catch(() => {})
  if (window.reader.launchboxStatus) refreshLaunchbox().catch(() => {})
  if (window.reader.folders) refreshFolders().catch(() => {})
}
window.reader.onLibraryChanged(() => { if (viewer.hidden) attempt(showLibrary) })
window.reader.onDisplaysChanged(() => { if (!isWallpaper) attempt(refreshDisplays) })
window.reader.onWallpaperChanged(() => { if (!isWallpaper) attempt(refreshStatus) })
if (isWallpaper) {
  document.querySelector('header').hidden = true
  document.body.classList.add('wallpaper')
  document.querySelector('#desktop-menu').hidden = false
  attempt(async () => { const lists = await window.reader.collections(); document.querySelector('#menu-current').textContent = lists.find(list => list.id === wallpaperCollection)?.name || 'Lista' })
}
