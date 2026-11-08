const { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu, shell } = require('electron')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { pages, rar } = require('./archive.cjs')
const { ALL, createCollection, setMembership, booksFor, seedCollections, moveItem } = require('./collections.cjs')
const { secureWindow } = require('./window-security.cjs')
const { waitForReady } = require('./process-ready.cjs')
const { validLibrary, validCollections } = require('./storage-validation.cjs')
const { createLargeFileGuard, FILE_WARNING_BYTES } = require('./large-files.cjs')
const { readPdfRange } = require('./pdf-range.cjs')
const { listSteamGames, launchSteamGame } = require('./steam.cjs')
const { extensions, supportedFile } = require('./file-types.cjs')
const i18n = require('./i18n.js')

async function pdfSource(book) {
  const { size, mtimeMs } = await fs.stat(book.path)
  return size > FILE_WARNING_BYTES ? { ranged: true, size, mtimeMs } : { data: await fs.readFile(book.path) }
}

let library = []
let win
const wallpapers = new Map()
let collections = []
let steamGames = []
let steamWrites = Promise.resolve()
const allItems = () => [...library, ...steamGames]
let collectionWrites = Promise.resolve()
let libraryWrites = Promise.resolve()
let tray
let quitting = false
let languagePreference = 'auto', languageWrites = Promise.resolve()
const locale = () => i18n.resolveLocale(languagePreference, app.getLocale())
const tr = (source, params) => i18n.translate(locale(), source, params)
function refreshTray() {
  if (!tray) return
  tray.setToolTip(tr('Biblioteca'))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tr('Abrir biblioteca'), click: () => { win.show(); win.focus() } },
    { label: tr('Salir'), click: () => { quitting = true; app.quit() } }
  ]))
}
function refreshAppMenu() {
  const item = (label, role) => ({ label: tr(label), role })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: tr('Archivo'), submenu: [item('Cerrar', 'close')] },
    { label: tr('Editar'), submenu: [item('Deshacer', 'undo'), item('Rehacer', 'redo'), { type: 'separator' }, item('Cortar', 'cut'), item('Copiar', 'copy'), item('Pegar', 'paste'), item('Seleccionar todo', 'selectAll')] },
    { label: tr('Ver'), submenu: [item('Recargar', 'reload'), item('Pantalla completa', 'togglefullscreen')] },
    { label: tr('Ventana'), submenu: [item('Minimizar', 'minimize'), item('Cerrar', 'close')] }
  ]))
}
const largeFiles = createLargeFileGuard({
  stat: file => fs.stat(file),
  confirm: async ({ kind, bytes, title }) => {
    const size = (bytes / (1024 * 1024)).toFixed(1)
    const result = await dialog.showMessageBox({
      type: 'warning', title: tr('Contenido grande'),
      message: tr(kind === 'página' ? 'La página de «{title}» ocupa aproximadamente {size} MiB.' : 'El archivo de «{title}» ocupa aproximadamente {size} MiB.', { title, size }),
      detail: tr('Procesarlo puede usar mucha memoria y tardar. Puedes continuar si tu equipo tiene recursos suficientes.'),
      buttons: [tr('Continuar'), tr('Cancelar')], defaultId: 1, cancelId: 1, noLink: true
    })
    return result.response === 0
  }
})
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
app.on('second-instance', () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } })
const indexPath = () => path.join(app.getPath('userData'), 'library.json')
const collectionsPath = () => path.join(app.getPath('userData'), 'collections.json')
const defaultsMarker = () => path.join(app.getPath('userData'), 'default-collections-v1')
const steamSeenPath = () => path.join(app.getPath('userData'), 'steam-seen.json')
const settingsPath = () => path.join(app.getPath('userData'), 'language-settings.json')
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
function refreshSteam(restore = false) {
  const task = steamWrites.catch(() => {}).then(async () => {
  const found = await listSteamGames()
  steamGames = found.map(game => ({ id: `steam:${game.id}`, steamId: game.id, title: game.name, type: 'steam', page: 0, coverPath: game.coverPath }))
  const gamesList = collections.find(item => item.name.toLocaleLowerCase() === 'juegos')
  if (!gamesList) return
  let seen = []
  try { seen = JSON.parse(await fs.readFile(steamSeenPath(), 'utf8')); if (!Array.isArray(seen) || !seen.every(id => typeof id === 'string')) throw new Error('Formato de juegos inválido.') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const known = new Set(seen)
  for (const game of steamGames) if (restore || !known.has(game.id)) { setMembership(collections, gamesList.id, game.id, true); known.add(game.id) }
  await saveCollections()
  await fs.writeFile(steamSeenPath() + '.tmp', JSON.stringify([...known]))
  await fs.rename(steamSeenPath() + '.tmp', steamSeenPath())
  })
  steamWrites = task
  return task
}
app.whenReady().then(async () => {
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    if (['auto', 'es', 'en', 'pt', 'ja'].includes(settings.language)) languagePreference = settings.language
  } catch (error) { if (error.code !== 'ENOENT') console.error('No se pudo leer la configuración de idioma:', error) }
  try {
    library = JSON.parse(await fs.readFile(indexPath(), 'utf8'))
    if (!validLibrary(library)) throw new Error('Formato de biblioteca inválido')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox(tr('No se pudo abrir la biblioteca'), `${tr(error.message)}\n${tr('Los datos originales se conservaron.')}`)
      app.quit()
      return
    }
  }
  try {
    collections = JSON.parse(await fs.readFile(collectionsPath(), 'utf8'))
    if (!validCollections(collections)) throw new Error('Formato de listas inválido')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox(tr('No se pudieron abrir las listas'), `${tr(error.message)}\n${tr('Los datos originales se conservaron.')}`)
      app.quit(); return
    }
  }
  try { await fs.access(defaultsMarker()) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    seedCollections(collections, library, () => crypto.randomUUID())
    await saveCollections()
    await fs.writeFile(defaultsMarker(), '1')
  }
  try { await refreshSteam() } catch (error) { console.error('No se pudo leer la biblioteca local de Steam:', error) }
  win = new BrowserWindow({ width: 1200, height: 800, minWidth: 700, minHeight: 500, backgroundColor: '#171411', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  secureWindow(win)
  refreshAppMenu()
  tray = new Tray(path.join(__dirname, 'icon.png'))
  refreshTray()
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
ipcMain.handle('library', (_event, collectionId = ALL) => booksFor(allItems(), collections, collectionId).map(({ id, title, page, type }) => ({ id, title, page, type })))
ipcMain.handle('language-get', () => ({ preference: languagePreference, system: app.getLocale() }))
ipcMain.handle('language-set', async (_event, preference) => {
  if (!['auto', 'es', 'en', 'pt', 'ja'].includes(preference)) throw new Error('Idioma inválido.')
  const task = languageWrites.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath() + '.tmp', JSON.stringify({ language: preference }))
    await fs.rename(settingsPath() + '.tmp', settingsPath())
    languagePreference = preference
    refreshAppMenu()
    refreshTray()
    const settings = { preference, system: app.getLocale() }
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('language-changed', settings)
    return settings
  })
  languageWrites = task
  return task
})
ipcMain.handle('collections', () => [{ id: ALL, name: 'Toda la biblioteca' }, ...collections])
ipcMain.handle('collection-create', async (_event, name) => {
  const item = createCollection(collections, name, crypto.randomUUID())
  await saveCollections()
  return item
})
ipcMain.handle('collection-delete', async (_event, id) => {
  const index = collections.findIndex(item => item.id === id)
  if (index < 0) throw new Error('La lista ya no existe.')
  const [removed] = collections.splice(index, 1)
  if (!collections.length) createCollection(collections, 'Colección 1', crypto.randomUUID())
  const retained = new Set(collections.flatMap(item => item.bookIds))
  for (const item of removed.bookIds) if (!retained.has(item)) collections[0].bookIds.push(item)
  await saveCollections()
  for (const [key, item] of wallpapers) {
    if (item.collectionId !== id || item.window.isDestroyed()) continue
    if (collections.length) { item.collectionId = collections[0].id; item.window.webContents.send('wallpaper-collection-changed', item.collectionId) }
    else { wallpapers.delete(key); item.window.destroy() }
  }
  notifyWallpapers()
  if (win && !win.isDestroyed()) win.webContents.send('wallpaper-changed')
})
ipcMain.handle('collection-move', async (_event, from, to, id) => {
  if (!allItems().some(item => item.id === id)) throw new Error('El elemento ya no está disponible.')
  moveItem(collections, from, to, id)
  await saveCollections(); notifyWallpapers()
})
ipcMain.handle('collection-remove-item', async (_event, collectionId, id) => {
  if (!allItems().some(item => item.id === id)) throw new Error('El elemento ya no está disponible.')
  setMembership(collections, collectionId, id, false)
  await saveCollections(); notifyWallpapers()
})
ipcMain.handle('collection-membership', async (_event, collectionId, bookId, checked) => {
  if (!allItems().some(item => item.id === bookId)) throw new Error('El elemento ya no está disponible.')
  if (typeof checked !== 'boolean') throw new Error('Selección inválida.')
  setMembership(collections, collectionId, bookId, checked)
  await saveCollections(); notifyWallpapers()
})
ipcMain.handle('collection-members', (_event, collectionId) => booksFor(allItems(), collections, collectionId).map(book => book.id))
ipcMain.handle('displays', () => screen.getAllDisplays().map((display, index) => ({ id: String(display.id), label: `${tr('Pantalla {number}', { number: index + 1 })}${display.label ? ` · ${display.label}` : ''}${display.id === screen.getPrimaryDisplay().id ? ` (${tr('principal')})` : ''} · ${display.size.width} × ${display.size.height}` })))
ipcMain.handle('add', async (event, collectionId = ALL) => {
  const wallpaper = [...wallpapers.values()].find(item => item.window.webContents === event.sender)
  if (wallpaper) collectionId = wallpaper.collectionId
  booksFor(allItems(), collections, collectionId)
  const options = { properties: ['openFile', 'multiSelections'], filters: [{ name: tr('Cómics y documentos'), extensions }] }
  const result = wallpaper ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options)
  if (result.canceled) return
  if (!result.filePaths.every(supportedFile)) throw new Error('Selecciona solo archivos CBZ, CBR o PDF.')
  booksFor(allItems(), collections, collectionId)
  for (const file of result.filePaths) {
    let book = library.find(item => item.path === file)
    if (!book) { book = { id: crypto.randomUUID(), title: path.basename(file, path.extname(file)), path: file, type: path.extname(file).toLowerCase().slice(1), page: 0 }; library.push(book) }
    if (collectionId !== ALL) setMembership(collections, collectionId, book.id, true)
  }
  await save()
  if (collectionId !== ALL) await saveCollections()
  notifyWallpapers()
  if (wallpaper && win && !win.isDestroyed()) win.webContents.send('library-changed')
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
  if (book.type === 'pdf') return { title: book.title, type: book.type, page: book.page, ...await pdfSource(book) }
  const entries = book.type === 'cbr' ? await rar(book.path) : await pages(book.path)
  if (!entries.length) throw new Error('El archivo no contiene páginas de imagen.')
  return { title: book.title, type: book.type, total: entries.length, page: Math.min(book.page, entries.length - 1) }
})
ipcMain.handle('cover', async (_event, id) => {
  const game = steamGames.find(item => item.id === id)
  if (game) return game.coverPath ? fs.readFile(game.coverPath).catch(() => null) : null
  const book = getBook(id)
  if (book.type === 'pdf') return null
  if (!await largeFiles.canPreview(book)) return null
  const entries = book.type === 'cbr' ? await rar(book.path) : await pages(book.path)
  const entry = entries[0]
  if (!entry || !await largeFiles.canPreview(book, entry.header?.size ?? entry.unpSize)) return null
  return book.type === 'cbr' ? await rar(book.path, entry.name) : await entry.getData()
})
ipcMain.handle('steam-launch', async (_event, id) => {
  const game = steamGames.find(item => item.id === id)
  if (!game) throw new Error('El juego ya no está instalado.')
  await launchSteamGame(game.steamId, url => shell.openExternal(url))
})
ipcMain.handle('steam-refresh', async (_event, restore = false) => {
  if (typeof restore !== 'boolean') throw new Error('Solicitud de Steam inválida.')
  await refreshSteam(restore)
  notifyWallpapers()
  if (win && !win.isDestroyed()) win.webContents.send('library-changed')
})
ipcMain.handle('pdf-cover', async (_event, id) => {
  const book = getBook(id)
  if (book.type !== 'pdf') throw new Error('El archivo no es un PDF.')
  if (!await largeFiles.canPreview(book)) return null
  return pdfSource(book)
})
ipcMain.handle('pdf-range', async (_event, id, begin, end, expected) => {
  const book = getBook(id)
  if (book.type !== 'pdf') throw new Error('El archivo no es un PDF.')
  if (!await largeFiles.canPreview(book)) throw new Error('Vuelve a abrir el PDF para autorizar su lectura.')
  return readPdfRange(book.path, begin, end, expected)
})
ipcMain.handle('page', async (_event, id, number, remember = true, allowPrompt = true) => {
  const book = getBook(id)
  if (allowPrompt) await largeFiles.ensure(book)
  else if (!await largeFiles.canPreview(book)) return { deferred: true }
  const entries = book.type === 'cbr' ? await rar(book.path) : await pages(book.path)
  if (!Number.isInteger(number) || number < 0 || number >= entries.length) throw new Error('Página fuera de rango.')
  const entry = entries[number]
  const size = entry.header?.size ?? entry.unpSize
  if (allowPrompt) await largeFiles.ensure(book, size)
  else if (!await largeFiles.canPreview(book, size)) return { deferred: true }
  const data = book.type === 'cbr' ? await rar(book.path, entry.name) : await entry.getData()
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
  booksFor(allItems(), collections, collectionId)
  item.collectionId = collectionId
  if (win && !win.isDestroyed()) win.webContents.send('wallpaper-changed')
})
ipcMain.handle('wallpaper-remove', (_event, displayId) => {
  const item = wallpapers.get(String(displayId))
  if (item) wallpapers.delete(String(displayId))
  if (item && !item.window.isDestroyed()) item.window.destroy()
})
ipcMain.handle('wallpaper', async (_event, displayId, collectionId, format = 'full') => {
  if (process.platform !== 'win32') throw new Error('El fondo de escritorio solo está disponible en Windows.')
  const display = screen.getAllDisplays().find(item => String(item.id) === String(displayId))
  if (!display) throw new Error('La pantalla seleccionada ya no está conectada.')
  booksFor(allItems(), collections, collectionId)
  if (!['full', 'centered'].includes(format)) throw new Error('Formato de pantalla inválido.')
  const key = String(display.id), previous = wallpapers.get(key)
  const wallpaper = new BrowserWindow({ ...display.bounds, frame: false, skipTaskbar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  secureWindow(wallpaper)
  const item = { window: wallpaper, collectionId, mouseForwarder: null }
  wallpaper.on('closed', () => { item.mouseForwarder?.kill(); if (wallpapers.get(key) === item) wallpapers.delete(key) })
  try {
    await wallpaper.loadFile(path.join(__dirname, 'index.html'), { query: { wallpaper: '1', collection: collectionId, format } })
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
