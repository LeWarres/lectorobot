const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const i18n = require('./i18n.js')

test('elige idioma del sistema y actualiza interfaz al cambiar la preferencia', async () => {
  const nodes = new Map(), selected = [], label = { dataset: { i18n: 'Lista actual' }, textContent: '' }
  const element = () => ({ hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} }, append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelectorAll() { return [] } })
  const document = { documentElement: {}, querySelector(key) { if (key.startsWith('dialog[')) return null; if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    querySelectorAll(key) { return key === '[data-i18n]' ? [label] : [] }, createElement: element, addEventListener() {}, body: element() }
  let languageChanged
  const reader = { languageGet: async () => ({ preference: 'auto', system: 'ja-JP' }), languageSet: async value => { selected.push(value) }, onLanguageChanged: cb => { languageChanged = cb },
    library: () => new Promise(() => {}), collections: async () => [{ id: 'c1', name: 'Colección 1' }], displays: async () => [],
    onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = { document, window: { reader, LectorobotI18n: i18n }, location: { search: '' }, URLSearchParams, URL, Blob, console }
  vm.runInNewContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(document.documentElement.lang, 'ja')
  assert.equal(label.textContent, '現在のリスト')
  nodes.get('#language').value = 'pt'; nodes.get('#language').onchange()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(selected, ['pt'])
  languageChanged({ preference: 'pt', system: 'ja-JP' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(document.documentElement.lang, 'pt')
  assert.equal(label.textContent, 'Lista atual')
})

test('la ventana principal muestra la lista seleccionada en el estante', async () => {
  const nodes = new Map(), loaded = [], works = []
  function element(tag = 'div') {
    return { tag, hidden: false, style: {}, dataset: {}, children: [], classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      addEventListener() {}, querySelectorAll() { return [] } }
  }
  const document = {
    querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element()
  }
  const reader = { library: async id => { loaded.push(id); return [{ id: '1', title: 'Manga', type: 'cbz' }] }, cover: async () => null,
    collections: async () => [{ id: 'all', name: 'Toda la biblioteca' }, { id: 'c1', name: 'Colección 1' }], displays: async () => [],
    wallpaperActive: async () => null, onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const fakeShelf = { createShelf3D: (_host, _lib, options) => { works.push(...options.works); return { setManage() {}, destroy() {} } } }
  const context = { document, window: { reader }, location: { search: '' }, URLSearchParams, URL, Blob, console, fakeShelf }
  const source = fs.readFileSync(require.resolve('./renderer.js'), 'utf8').replace("Promise.all([import('./book3d.js'), import('./shelf3d.js')])", 'Promise.resolve([{}, fakeShelf])')
  vm.runInNewContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(loaded, ['c1'])
  assert.equal(nodes.get('#shelf').hidden, false)
  assert.equal(works[0].title, 'Manga')
})

test('abrir un libro en la aplicación inicia el lector 3D y sus controles de zoom', async () => {
  const nodes = new Map(), shown = [], scales = []
  function element(tag = 'div') {
    return { tag, hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      addEventListener(name, handler) { this[`on${name}`] = handler }, querySelectorAll() { return [] } }
  }
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element() }
  const reader = { library: async () => [{ id: '1', title: 'Manga', type: 'cbz' }],
    collections: async () => [{ id: 'c1', name: 'Colección 1' }], displays: async () => [],
    open: async () => ({ title: 'Manga', type: 'cbz', total: 2, page: 0 }),
    page: async () => ({ data: new Uint8Array([1]) }), progress: async () => {},
    onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const fakeBookModule = { createBook3D: () => ({ show: pages => shown.push(pages[0]), setZoom: scale => scales.push(scale), destroy() {} }) }
  const context = { document, window: { reader }, location: { search: '' }, URLSearchParams, URL: { createObjectURL: () => 'blob:page', revokeObjectURL() {} }, Blob, console, fakeBookModule }
  const source = fs.readFileSync(require.resolve('./renderer.js'), 'utf8').replace("await import('./book3d.js')", 'fakeBookModule')
  vm.runInNewContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  nodes.get('#library').children[0].children[0].onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(shown, [0])
  assert.equal(nodes.get('#book3d').hidden, false)
  assert.equal(nodes.get('#page').hidden, true)
  nodes.get('#reader-zoom-in').onclick()
  assert.deepEqual(scales, [1.25])
  assert.equal(nodes.get('#reader-zoom-level').textContent, '125 %')
})

test('el lector alternativo permite arrastrar una página ampliada', async () => {
  const nodes = new Map()
  function element(tag = 'div') {
    return { tag, hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      addEventListener(name, handler) { this[`on${name}`] = handler }, setPointerCapture() {}, querySelectorAll() { return [] } }
  }
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element() }
  const reader = { library: async () => [{ id: '1', title: 'Manga', type: 'cbz' }],
    collections: async () => [{ id: 'c1', name: 'Colección 1' }], displays: async () => [],
    open: async () => ({ title: 'Manga', type: 'cbz', total: 1, page: 0 }),
    page: async () => ({ data: new Uint8Array([1]) }), progress: async () => {},
    onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = { document, window: { reader }, location: { search: '' }, URLSearchParams, URL: { createObjectURL: () => 'blob:page', revokeObjectURL() {} }, Blob, console, fakeBookModule: { createBook3D: () => null } }
  const source = fs.readFileSync(require.resolve('./renderer.js'), 'utf8').replace("await import('./book3d.js')", 'fakeBookModule')
  vm.runInNewContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  nodes.get('#library').children[0].children[0].onclick()
  await new Promise(resolve => setImmediate(resolve))
  nodes.get('#reader-zoom-in').onclick()
  const page = nodes.get('#page')
  page.onpointerdown({ pointerId: 1, button: 0, clientX: 100, clientY: 50, preventDefault() {} })
  page.onpointermove({ pointerId: 1, clientX: 130, clientY: 70 })
  assert.equal(page.style.transform, 'translate(30px, 20px) scale(1.25)')
  page.onpointerup({ pointerId: 1 })
  assert.equal(page.style.cursor, 'grab')
})

test('el menú del escritorio cambia la lista y controla el zoom', async () => {
  const nodes = new Map()
  function element() {
    return { hidden: true, style: {}, dataset: {}, children: [], attributes: {}, classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      setAttribute(name, value) { this.attributes[name] = value }, addEventListener() {}, querySelectorAll() { return [] } }
  }
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element() }
  let selected = null
  const reader = { library: () => new Promise(() => {}), collections: async () => [{ id: 'all', name: 'Todo' }, { id: 'm', name: 'Manga' }],
    switchWallpaperCollection: async id => { selected = id }, onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = { document, window: { reader }, location: { search: '?wallpaper=1&collection=all' }, URLSearchParams, URL, Blob, console }
  vm.runInNewContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(nodes.get('#desktop-menu').hidden, false)
  nodes.get('#menu-zoom-in').onclick()
  assert.equal(nodes.get('#menu-zoom-level').textContent, '125 %')
  nodes.get('#menu-collections').onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(nodes.get('#menu-lists').children.length, 2)
  nodes.get('#menu-lists').children[1].onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(selected, 'm')
  assert.equal(nodes.get('#menu-current').textContent, 'Manga')
})

test('eliminar un elemento requiere pasar por dos diálogos y confirmar', async () => {
  const nodes = new Map(), removed = []
  function element() {
    return { hidden: true, style: {}, dataset: {}, children: [], attributes: {}, classList: { add() {}, toggle() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      setAttribute(key, value) { this.attributes[key] = value }, addEventListener() {}, querySelectorAll() { return [] },
      showModal() { this.open = true }, close() { this.open = false } }
  }
  const document = { querySelector(key) { if (key.startsWith('dialog[')) return null; if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element() }
  const reader = { library: () => new Promise(() => {}), collections: async () => [], remove: async id => { removed.push(id) },
    onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = vm.createContext({ document, window: { reader }, location: { search: '?wallpaper=1' }, URLSearchParams, URL, Blob, console })
  vm.runInContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  context.selectManagedItem({ id: 'book', title: 'Manga', type: 'cbz' })
  assert.equal(nodes.get('#file-manage-dialog').open, true)
  nodes.get('#file-delete-open').onclick()
  assert.equal(nodes.get('#file-delete-dialog').open, true)
  assert.deepEqual(removed, [])
  nodes.get('#file-delete-confirm').onclick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(removed, ['book'])
})

test('una actualización anterior no reemplaza la biblioteca más reciente', async () => {
  const nodes = new Map(), pending = []
  function element(tag = 'div') {
    return { tag, hidden: false, style: {}, dataset: {}, children: [], classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      addEventListener() {}, querySelectorAll() { return [] } }
  }
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element() }
  let changed
  const reader = { library: () => new Promise(resolve => pending.push(resolve)),
    collections: async () => [{ id: 'c1', name: 'Colección 1' }], displays: async () => [],
    wallpaperActive: async () => null, onLibraryChanged: cb => { changed = cb }, onDisplaysChanged() {}, onWallpaperChanged() {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), { document, window: { reader }, location: { search: '' }, URLSearchParams, URL, Blob, console })
  await new Promise(resolve => setImmediate(resolve))
  changed()
  pending[1]([{ id: 'new', title: 'Nuevo' }])
  await new Promise(resolve => setImmediate(resolve))
  pending[0]([{ id: 'old', title: 'Anterior' }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(nodes.get('#library').children[0].children[0].textContent, 'Nuevo')
})

test('un cambio rápido de página no guarda ni muestra una página anterior', async () => {
  const nodes = new Map(), pending = new Map(), shown = [], saved = []
  function element() {
    return { hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      setAttribute() {}, addEventListener() {}, querySelectorAll() { return [] } }
  }
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element() }
  const reader = { library: () => new Promise(() => {}), collections: async () => [],
    page: (_id, index) => new Promise(resolve => pending.set(index, resolve)),
    progress: async (_id, index) => { saved.push(index) }, onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const fakeUrl = { createObjectURL: () => 'blob:test', revokeObjectURL() {} }
  const context = vm.createContext({ document, window: { reader, turnSound() {} }, location: { search: '?wallpaper=1' }, URLSearchParams, URL: fakeUrl, Blob, console, showBook: pages => shown.push(pages[0]) })
  vm.runInContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  vm.runInContext("current = 'book'; total = 3; viewer.hidden = false; book3d = { show: showBook }", context)
  const older = vm.runInContext('page = 0; showPage(1)', context)
  const newer = vm.runInContext('page = 1; showPage(1)', context)
  pending.get(1)({ data: new Uint8Array([1]) }); await newer
  pending.get(0)({ data: new Uint8Array([0]) }); await older
  assert.deepEqual(shown, [1])
  assert.deepEqual(saved, [1])
  assert.equal(nodes.get('#counter').textContent, '2 / 3')
})

test('limita la carga simultánea de portadas sin alterar su orden', async () => {
  const nodes = new Map()
  const element = () => ({ hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} }, append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelectorAll() { return [] } })
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) }, createElement: element, addEventListener() {}, body: element() }
  const reader = { library: () => new Promise(() => {}), collections: async () => [], onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = vm.createContext({ document, window: { reader }, location: { search: '?wallpaper=1' }, URLSearchParams, URL, Blob, console })
  vm.runInContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  let active = 0, maximum = 0
  const result = await context.mapLimited([0, 1, 2, 3, 4, 5, 6], 3, async index => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    active--; return index * 2
  })
  assert.equal(maximum, 3)
  assert.deepEqual(Array.from(result), [0, 2, 4, 6, 8, 10, 12])
})

test('libera páginas antiguas y reutiliza solicitudes concurrentes', async () => {
  const nodes = new Map(), revoked = []
  const element = () => ({ hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} }, append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelectorAll() { return [] } })
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) }, createElement: element, addEventListener() {}, body: element() }
  let calls = 0, nextUrl = 0
  const reader = { library: () => new Promise(() => {}), collections: async () => [], page: async () => { calls++; return { data: new Uint8Array([1]) } }, onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const fakeUrl = { createObjectURL: () => `blob:${nextUrl++}`, revokeObjectURL: url => revoked.push(url) }
  const context = vm.createContext({ document, window: { reader }, location: { search: '?wallpaper=1' }, URLSearchParams, URL: fakeUrl, Blob, console })
  vm.runInContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await Promise.all([context.pageUrl(0), context.pageUrl(0)])
  assert.equal(calls, 1)
  for (let i = 1; i < 20; i++) await context.pageUrl(i)
  assert.equal(vm.runInContext('bookUrls.size', context), 16)
  assert.equal(revoked.length, 4)
})

test('una página grande pospuesta se solicita al elegirla para lectura', async () => {
  const nodes = new Map(), calls = []
  const element = () => ({ hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} }, append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelectorAll() { return [] } })
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) }, createElement: element, addEventListener() {}, body: element() }
  let finishPrefetch
  const reader = { library: () => new Promise(() => {}), collections: async () => [],
    page: (_id, _index, _remember, allowPrompt) => { calls.push(allowPrompt); return allowPrompt ? Promise.resolve({ data: new Uint8Array([1]) }) : new Promise(resolve => { finishPrefetch = resolve }) },
    onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const fakeUrl = { createObjectURL: () => 'blob:page', revokeObjectURL() {} }
  const context = vm.createContext({ document, window: { reader }, location: { search: '?wallpaper=1' }, URLSearchParams, URL: fakeUrl, Blob, console })
  vm.runInContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  const prefetch = context.pageUrl(3)
  const selected = context.pageUrl(3, true)
  finishPrefetch({ deferred: true })
  assert.equal(await prefetch, null)
  assert.equal(await selected, 'blob:page')
  assert.deepEqual(calls, [false, true])
})

test('cancelar la advertencia conserva la página actual', async () => {
  const nodes = new Map()
  const element = () => ({ hidden: true, style: {}, dataset: {}, children: [], classList: { add() {} }, append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelectorAll() { return [] } })
  const document = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) }, createElement: element, addEventListener() {}, body: element() }
  const reader = { library: () => new Promise(() => {}), collections: async () => [], page: async () => { throw new Error('Apertura cancelada.') }, onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = vm.createContext({ document, window: { reader }, location: { search: '?wallpaper=1' }, URLSearchParams, URL, Blob, console })
  vm.runInContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  vm.runInContext("current = 'book'; total = 3; page = 0; viewer.hidden = false; book3d = { show() {} }", context)
  await assert.rejects(context.movePage(1), /cancelada/)
  assert.equal(vm.runInContext('page', context), 0)
})
