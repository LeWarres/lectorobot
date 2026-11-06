const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('la ventana principal administra archivos sin crear el estante 3D', async () => {
  const nodes = new Map()
  function element(tag = 'div') {
    return { tag, hidden: false, style: {}, dataset: {}, children: [], classList: { add() {} },
      append(...items) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      addEventListener() {}, querySelectorAll() { return [] } }
  }
  const document = {
    querySelector(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key) },
    createElement: element, addEventListener() {}, body: element()
  }
  const reader = { library: async () => [{ id: '1', title: 'Manga', type: 'cbz' }],
    collections: async () => [{ id: 'all', name: 'Toda la biblioteca' }], displays: async () => [],
    wallpaperActive: async () => null, onLibraryChanged() {}, onDisplaysChanged() {}, onWallpaperChanged() {} }
  const context = { document, window: { reader }, location: { search: '' }, URLSearchParams, URL, Blob, console }
  vm.runInNewContext(fs.readFileSync(require.resolve('./renderer.js'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(nodes.get('#shelf').hidden, true)
  assert.equal(nodes.get('#library').children[0].children[0].tag, 'div')
  assert.equal(nodes.get('#library').children[0].children[1].textContent, 'Quitar Manga de la biblioteca')
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
    collections: async () => [{ id: 'all', name: 'Todo' }], displays: async () => [],
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
  vm.runInContext("current = 'book'; total = 3; page = 0; viewer.hidden = false; book3d = { show() {} }", context)
  await assert.rejects(context.movePage(1), /cancelada/)
  assert.equal(vm.runInContext('page', context), 0)
})
