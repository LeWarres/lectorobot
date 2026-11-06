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
