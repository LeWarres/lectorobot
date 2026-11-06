const { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu } = require('electron')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { pages, rar } = require('./archive.cjs')
const { ALL, createCollection, setMembership, booksFor } = require('./collections.cjs')
const { secureWindow } = require('./window-security.cjs')
const { waitForReady } = require('./process-ready.cjs')
const { validLibrary, validCollections } = require('./storage-validation.cjs')
const { createLargeFileGuard } = require('./large-files.cjs')

let library = []
let win
const wallpapers = new Map()
let collections = []
let collectionWrites = Promise.resolve()
let libraryWrites = Promise.resolve()
let tray
let quitting = false
const largeFiles = createLargeFileGuard({
  stat: file => fs.stat(file),
  confirm: async ({ kind, bytes, title }) => {
    const size = (bytes / (1024 * 1024)).toFixed(1)
    const result = await dialog.showMessageBox({
      type: 'warning', title: 'Contenido grande',
      message: `${kind === 'página' ? 'La' : 'El'} ${kind} de «${title}» ocupa aproximadamente ${size} MiB.`,
      detail: 'Procesarlo puede usar mucha memoria y tardar. Puedes continuar si tu equipo tiene recursos suficientes.',
      buttons: ['Continuar', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true
    })
    return result.response === 0
  }
})
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } })
const indexPath = () => path.join(app.getPath('userData'), 'library.json')
const collectionsPath = () => path.join(app.getPath('userData'), 'collections.json')
function notifyWallpapers() { for (const item of wallpapers.values()) if (!item.window.isDestroyed()) item.window.webContents.send('library-changed') }
function saveCollections() {
  const contents = JSON.stringify(collections, null, 2)
  collectionWrites = collectionWrites.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(collectionsPath()), { recursive: true })
    await fs.writeFile(collectionsPath() + '.tmp', contents)
    await fs.rename(collectionsPath() + '.tmp', collectionsPath())
  })
  return collectionWrites
}
const getBook = id => {
  const book = library.find(item => item.id === id)
  if (!book) throw new Error('El libro ya no está en la biblioteca.')
  return book
}
function save() {
  const contents = JSON.stringify(library, null, 2)
  libraryWrites = libraryWrites.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(indexPath()), { recursive: true })
    const tmp = indexPath() + '.tmp'
    await fs.writeFile(tmp, contents)
    await fs.rename(tmp, indexPath())
  })
  return libraryWrites
}
app.whenReady().then(async () => {
  try {
    library = JSON.parse(await fs.readFile(indexPath(), 'utf8'))
    if (!validLibrary(library)) throw new Error('Formato de biblioteca inválido')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox('No se pudo abrir la biblioteca', `${error.message}\nLos datos originales se conservaron.`)
      app.quit()
      return
    }
  }
  try {
    collections = JSON.parse(await fs.readFile(collectionsPath(), 'utf8'))
    if (!validCollections(collections)) throw new Error('Formato de listas inválido')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox('No se pudieron abrir las listas', `${error.message}\nLos datos originales se conservaron.`)
      app.quit(); return
    }
  }
  win = new BrowserWindow({ width: 1200, height: 800, minWidth: 700, minHeight: 500, backgroundColor: '#171411', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  secureWindow(win)
  tray = new Tray(path.join(__dirname, 'icon.png'))
  tray.setToolTip('Manga Desktop')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir biblioteca', click: () => { win.show(); win.focus() } },
    { label: 'Salir', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('double-click', () => { win.show(); win.focus() })
  win.on('close', event => { if (!quitting && wallpapers.size) { event.preventDefault(); win.hide() } })
  win.on('closed', () => { for (const item of wallpapers.values()) if (!item.window.isDestroyed()) item.window.destroy() })
  screen.on('display-removed', (_event, display) => {
    const item = wallpapers.get(String(display.id))
    if (item && !item.window.isDestroyed()) item.window.destroy()
    if (!win.isDestroyed()) win.webContents.send('displays-changed')
  })
  screen.on('display-added', () => { if (!win.isDestroyed()) win.webContents.send('displays-changed') })
  screen.on('display-metrics-changed', (_event, display) => {
    const item = wallpapers.get(String(display.id))
    if (item && !item.window.isDestroyed()) item.window.setBounds(display.bounds)
    if (!win.isDestroyed()) win.webContents.send('displays-changed')
  })
  await win.loadFile(path.join(__dirname, 'index.html'))
}).catch(error => { dialog.showErrorBox('No se pudo iniciar Manga Desktop', error.message); app.quit() })
app.on('window-all-closed', () => app.quit())
ipcMain.handle('library', (_event, collectionId = ALL) => booksFor(library, collections, collectionId).map(({ id, title, page, type }) => ({ id, title, page, type })))
ipcMain.handle('collections', () => [{ id: ALL, name: 'Toda la biblioteca' }, ...collections])
ipcMain.handle('collection-create', async (_event, name) => {
  const item = createCollection(collections, name, crypto.randomUUID())
  await saveCollections()
  return item
})
ipcMain.handle('collection-membership', async (_event, collectionId, bookId, checked) => {
  getBook(bookId)
  if (typeof checked !== 'boolean') throw new Error('Selección inválida.')
  setMembership(collections, collectionId, bookId, checked)
  await saveCollections(); notifyWallpapers()
})
ipcMain.handle('collection-members', (_event, collectionId) => booksFor(library, collections, collectionId).map(book => book.id))
ipcMain.handle('displays', () => screen.getAllDisplays().map((display, index) => ({ id: String(display.id), label: `Pantalla ${index + 1}${display.label ? ` · ${display.label}` : ''}${display.id === screen.getPrimaryDisplay().id ? ' (principal)' : ''} · ${display.size.width} × ${display.size.height}` })))
ipcMain.handle('add', async (_event, collectionId = ALL) => {
  booksFor(library, collections, collectionId)
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Cómics y documentos', extensions: ['cbz', 'cbr', 'zip', 'pdf'] }] })
  if (result.canceled) return
  for (const file of result.filePaths) {
    let book = library.find(item => item.path === file)
    if (!book) { book = { id: crypto.randomUUID(), title: path.basename(file, path.extname(file)), path: file, type: path.extname(file).toLowerCase().slice(1), page: 0 }; library.push(book) }
    if (collectionId !== ALL) setMembership(collections, collectionId, book.id, true)
  }
  await save()
  if (collectionId !== ALL) await saveCollections()
  notifyWallpapers()
})
ipcMain.handle('remove', async (_event, id) => {
  getBook(id)
  library = library.filter(book => book.id !== id)
  for (const collection of collections) collection.bookIds = collection.bookIds.filter(bookId => bookId !== id)
  await save()
  await saveCollections(); notifyWallpapers()
})
ipcMain.handle('open', async (_event, id) => {
  const book = getBook(id)
  await largeFiles.ensure(book)
  if (book.type === 'pdf') return { title: book.title, type: book.type, page: book.page, data: await fs.readFile(book.path) }
  const entries = book.type === 'cbr' ? await rar(book.path) : pages(book.path)
  if (!entries.length) throw new Error('El archivo no contiene páginas de imagen.')
  return { title: book.title, type: book.type, total: entries.length, page: Math.min(book.page, entries.length - 1) }
})
ipcMain.handle('cover', async (_event, id) => {
  const book = getBook(id)
  if (book.type === 'pdf') return null
  if (!await largeFiles.canPreview(book)) return null
  const entries = book.type === 'cbr' ? await rar(book.path) : pages(book.path)
  const entry = entries[0]
  if (!entry || !await largeFiles.canPreview(book, entry.header?.size ?? entry.unpSize)) return null
  return book.type === 'cbr' ? await rar(book.path, entry.name) : entry.getData()
})
ipcMain.handle('pdf-cover', async (_event, id) => {
  const book = getBook(id)
  if (book.type !== 'pdf') throw new Error('El archivo no es un PDF.')
  if (!await largeFiles.canPreview(book)) return null
  return fs.readFile(book.path)
})
ipcMain.handle('page', async (_event, id, number, remember = true, allowPrompt = true) => {
  const book = getBook(id)
  if (allowPrompt) await largeFiles.ensure(book)
  else if (!await largeFiles.canPreview(book)) return { deferred: true }
  const entries = book.type === 'cbr' ? await rar(book.path) : pages(book.path)
  if (!Number.isInteger(number) || number < 0 || number >= entries.length) throw new Error('Página fuera de rango.')
  const entry = entries[number]
  const size = entry.header?.size ?? entry.unpSize
  if (allowPrompt) await largeFiles.ensure(book, size)
  else if (!await largeFiles.canPreview(book, size)) return { deferred: true }
  const data = book.type === 'cbr' ? await rar(book.path, entry.name) : entry.getData()
  if (remember) { book.page = number; await save() }
  return { data, name: entry.entryName || entry.name }
})
ipcMain.handle('progress', async (_event, id, number) => {
  if (!Number.isInteger(number) || number < 0) throw new Error('Página inválida.')
  getBook(id).page = number
  await save()
})
ipcMain.handle('wallpaper-active', (_event, displayId) => {
  const item = wallpapers.get(String(displayId))
  return item && !item.window.isDestroyed() ? { collectionId: item.collectionId } : null
})
ipcMain.handle('wallpaper-switch-collection', (event, collectionId) => {
  const item = [...wallpapers.values()].find(entry => entry.window.webContents === event.sender)
  if (!item) throw new Error('El estante ya no está activo.')
  booksFor(library, collections, collectionId)
  item.collectionId = collectionId
  if (win && !win.isDestroyed()) win.webContents.send('wallpaper-changed')
})
ipcMain.handle('wallpaper-remove', (_event, displayId) => {
  const item = wallpapers.get(String(displayId))
  if (item) wallpapers.delete(String(displayId))
  if (item && !item.window.isDestroyed()) item.window.destroy()
})
ipcMain.handle('wallpaper', async (_event, displayId, collectionId) => {
  if (process.platform !== 'win32') throw new Error('El fondo de escritorio solo está disponible en Windows.')
  const display = screen.getAllDisplays().find(item => String(item.id) === String(displayId))
  if (!display) throw new Error('La pantalla seleccionada ya no está conectada.')
  booksFor(library, collections, collectionId)
  const key = String(display.id), previous = wallpapers.get(key)
  const wallpaper = new BrowserWindow({ ...display.bounds, frame: false, skipTaskbar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  secureWindow(wallpaper)
  const item = { window: wallpaper, collectionId, mouseForwarder: null }
  wallpaper.on('closed', () => { item.mouseForwarder?.kill(); if (wallpapers.get(key) === item) wallpapers.delete(key) })
  try {
    await wallpaper.loadFile(path.join(__dirname, 'index.html'), { query: { wallpaper: '1', collection: collectionId } })
    const handle = wallpaper.getNativeWindowHandle().readBigUInt64LE().toString()
    const script = path.join(__dirname, 'wallpaper.ps1').replace('app.asar', 'app.asar.unpacked')
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-WindowHandle', handle], { windowsHide: true, timeout: 10000 })
    wallpaper.setBounds(display.bounds)
    wallpaper.showInactive()
    const inputScript = path.join(__dirname, 'mouse-forward.ps1').replace('app.asar', 'app.asar.unpacked')
    const mouseForwarder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', inputScript, '-WindowHandle', handle], { windowsHide: true })
    item.mouseForwarder = mouseForwarder
    mouseForwarder.on('error', error => console.error('Error del control de interacción:', error))
    await waitForReady(mouseForwarder)
    if (previous && !previous.window.isDestroyed()) previous.window.destroy()
    wallpapers.set(key, item)
    return { collectionId }
  } catch (error) {
    if (!wallpaper.isDestroyed()) wallpaper.destroy()
    throw new Error(`No se pudo iniciar el fondo: ${error.message}`)
  }
})
