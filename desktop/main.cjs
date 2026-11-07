const { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu, shell, nativeImage, protocol } = require('electron')
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
const { createLargeFileGuard, FILE_WARNING_BYTES } = require('./large-files.cjs')
const { readPdfRange } = require('./pdf-range.cjs')
const { installedGames, localArt, steamUsers, playedApps, appInfo, isTool } = require('./steam.cjs')
const { ownedGames, validApiKey, SteamApiKeyError } = require('./steamapi.cjs')
const { findArt, download, checkKey, validKey, SteamGridDbKeyError } = require('./steamgriddb.cjs')
const { updateIndex, loadIndex, lookup, imageUrl, normalizeName } = require('./launchbox.cjs')
const { companyLogoUrl, HEADERS: WIKI_HEADERS } = require('./companies.cjs')
const { describe: describeComic, scanFolder, groupWorks, COMIC } = require('./comics.cjs')
const { createTomes } = require('./tomes.cjs')
const { imageKind } = require('./tomes-pure.cjs')
// tome://md/<id de MangaDex>/<tomo>/<thumb|art|front|back>: las caras de los tomos, descargadas una vez. Con CORS, para
// que el estante pueda subirlas a WebGL.
protocol.registerSchemesAsPrivileged([{ scheme: 'tome', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
let tomes = null
const { storeDetails } = require('./steamstore.cjs')

async function pdfSource(book) {
  const { size, mtimeMs } = await fs.stat(book.path)
  return size > FILE_WARNING_BYTES ? { ranged: true, size, mtimeMs } : { data: await fs.readFile(book.path) }
}

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
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const artDir = () => path.join(app.getPath('userData'), 'steam-art')
const SPINE_STYLES = ['banda', 'color', 'arte', 'envolvente'] // la primera, por defecto
let settings = { steamGridDbKey: '', steamWebApiKey: '', spineStyle: SPINE_STYLES[0], folders: [] }
let settingsWrites = Promise.resolve()
function saveSettings() {
  const contents = JSON.stringify(settings, null, 2)
  settingsWrites = settingsWrites.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
    await fs.writeFile(settingsPath() + '.tmp', contents)
    await fs.rename(settingsPath() + '.tmp', settingsPath())
  })
  return settingsWrites
}
// Imágenes de los juegos, en steam-art/: se descargan una vez y las peticiones simultáneas comparten la descarga.
const artMisses = new Set(), artTasks = new Map()
const readArt = name => fs.readFile(path.join(artDir(), name)).catch(() => null)
// Reduce una imagen descargada antes de guardarla: los logos y escaneos llegan a varios MB y se ven igual más pequeños.
// «png» conserva la transparencia (logos); lo demás pasa a JPEG.
function shrink(bytes, { max, png = false }) {
  if (!bytes) return bytes
  try {
    let image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) return bytes
    const { width, height } = image.getSize()
    if (Math.max(width, height) > max) image = image.resize(width >= height ? { width: max, quality: 'best' } : { height: max, quality: 'best' })
    const out = png ? image.toPNG() : image.toJPEG(90)
    return out.length && out.length < bytes.length ? out : bytes
  } catch { return bytes }
}
async function cachedArt(name, produce) {
  const hit = await readArt(name)
  if (hit) return hit
  if (!artTasks.has(name)) artTasks.set(name, (async () => {
    const bytes = await produce()
    if (!bytes) return null
    const file = path.join(artDir(), name)
    await fs.mkdir(artDir(), { recursive: true })
    await fs.writeFile(file + '.tmp', bytes)
    await fs.rename(file + '.tmp', file)
    return bytes
  })().finally(() => artTasks.delete(name)))
  return artTasks.get(name)
}
// SteamGridDB: «cover» (portada 600×900), «logo» y «hero» (banner ancho).
async function gridArt(book, kind) {
  const name = `${book.appid}-${kind}`, key = settings.steamGridDbKey, tag = `${kind}:${book.appid}:${key}`
  if (!key || artMisses.has(tag)) return readArt(name)
  try {
    const bytes = await cachedArt(name, async () => {
      const url = await findArt({ cover: 'grids', logo: 'logos', hero: 'heroes' }[kind], book.appid, key)
      return url ? shrink(await download(url), kind === 'cover' ? { max: 900 } : { max: 900, png: true }) : null
    })
    if (!bytes) artMisses.add(tag)
    return bytes
  } catch (error) {
    if (error instanceof SteamGridDbKeyError) artMisses.add(tag)
    console.warn(`SteamGridDB (${book.title}):`, error.message)
    return null
  }
}
// LaunchBox: escaneos de cajas reales. El índice se descarga desde Ajustes.
let launchbox = null, launchboxLoaded = false, launchboxTask = null
async function boxIndex() {
  if (!launchboxLoaded) { launchbox = await loadIndex(app.getPath('userData')); launchboxLoaded = true }
  return launchbox
}
async function realBox(book) { return lookup(await boxIndex(), book.appid, book.title) }
async function boxArt(book, side) {
  const box = await realBox(book)
  if (!box?.[side]) return null
  try { return await cachedArt(`lb-${box[side]}`, async () => shrink(await download(imageUrl(box[side])), { max: 1400 })) } catch (error) {
    console.warn(`LaunchBox (${book.title}):`, error.message)
    return null
  }
}
// La CDN de la tienda de Steam: tiene la portada, el banner y el logo de casi cualquier juego, sin clave.
const CDN = 'https://shared.steamstatic.com/store_item_assets/steam/apps'
const CDN_FILES = { cover: ['library_600x900_2x.jpg', 'library_600x900.jpg'], hero: ['library_hero.jpg'], logo: ['logo.png'] }
async function cdnArt(book, kind, keep = true) {
  for (const file of CDN_FILES[kind] || []) {
    const tag = `cdn:${book.appid}:${file}`, url = `${CDN}/${book.appid}/${file}`
    if (artMisses.has(tag)) continue
    try {
      const bytes = keep ? await cachedArt(`${book.appid}-cdn-${file}`, async () => shrink(await download(url), { max: 900, png: kind === 'logo' })) : await download(url)
      if (bytes) return bytes
    } catch { artMisses.add(tag) }
  }
  return null
}
// Portada, logo o banner, de la fuente más fiel a la que haya: la caja real completa (para que case con su lomo y su
// contraportada), SteamGridDB, la caché del cliente de Steam, la CDN de la tienda y, para la portada, una compuesta aquí.
async function steamArt(book, kind) {
  if (kind === 'cover' && (await realBox(book))?.back) { const real = await boxArt(book, 'front'); if (real) return real }
  return await gridArt(book, kind) || await localArt(book.appid, kind) || await cdnArt(book, kind) || (kind === 'cover' ? readArt(generatedName(book, 'cover')) : null)
}
// El arte ancho del juego (el «hero» de la biblioteca de Steam; el mismo que enseña SteamDB): para la contraportada, el
// lomo y el manual, que luego se guardan compuestos, así que no se conserva. Primero el de la caché del cliente.
async function heroArt(book, { preferGrid = true } = {}) {
  const key = settings.steamGridDbKey
  const grid = async () => { if (!key) return null; try { const url = await findArt('heroes', book.appid, key); return url ? await download(url) : null } catch { return null } }
  const local = async () => await localArt(book.appid, 'hero') || cdnArt(book, 'hero', false)
  const bytes = preferGrid ? await grid() || await local() : await local() || await grid()
  return shrink(bytes, { max: 1600 })
}
const NO_STORE = { name: '', type: '', description: '', screenshots: [], developers: [], publishers: [], header: null }
async function storeInfo(book) {
  try {
    const bytes = await cachedArt(`${book.appid}-store3.json`, async () => Buffer.from(JSON.stringify(await storeDetails(book.appid))))
    return { ...NO_STORE, ...JSON.parse(bytes) }
  } catch (error) {
    console.warn(`Tienda de Steam (${book.title}):`, error.message)
    return { ...NO_STORE, failed: true } // pasajero: no se guarda nada compuesto con esto
  }
}
// Logos de empresas (Wikidata). Lo que de verdad no existe se recuerda; un fallo pasajero (sin red, límite) no,
// y la cara compuesta sin ese logo tampoco se guarda («final: false»), para rehacerla la próxima vez.
async function companyLogo(name) {
  const key = normalizeName(name)
  if (!key) return { logo: null, final: true }
  const file = `company-${key}.png`, none = `company-${key}.none`
  const hit = await readArt(file)
  if (hit) return { logo: hit, final: true }
  if (await readArt(none)) return { logo: null, final: true }
  try {
    const logo = await cachedArt(file, async () => { const url = await companyLogoUrl(name); return url ? shrink(await download(url, fetch, WIKI_HEADERS), { max: 400, png: true }) : null })
    if (!logo) await cachedArt(none, async () => Buffer.from('1'))
    return { logo, final: true }
  } catch (error) {
    console.warn(`Logo de ${name}:`, error.message)
    return { logo: null, final: false }
  }
}
// Nombre, tipo, desarrolladora y editora de los juegos de la biblioteca, de la caché del cliente (sin red).
let appInfoCache = { at: 0, map: new Map() }
async function localAppInfo(appid) {
  if (!appInfoCache.map.has(appid) && Date.now() - appInfoCache.at > 60000) {
    const wanted = new Set(library.filter(book => book.type === 'steam').map(book => book.appid))
    appInfoCache = { at: Date.now(), map: await appInfo(wanted) }
  }
  return appInfoCache.map.get(appid) || null
}
// La editora primero (es la que va al pie del lomo) y la desarrolladora si es otra. Los nombres salen de la caché del
// cliente y, si no está ahí, de la tienda; la ficha de la tienda (descripción, capturas) solo se pide si hace falta.
async function companiesOf(book, { withStore = false } = {}) {
  const local = await localAppInfo(book.appid)
  const info = withStore || !local?.publishers?.length && !local?.developers?.length ? await storeInfo(book) : { ...NO_STORE }
  const publishers = local?.publishers?.length ? local.publishers : info.publishers, developers = local?.developers?.length ? local.developers : info.developers
  const seen = new Set(), names = []
  for (const name of [...publishers.slice(0, 1), ...developers.slice(0, 1)]) if (!seen.has(normalizeName(name))) { seen.add(normalizeName(name)); names.push(name) }
  const found = await Promise.all(names.map(async name => ({ name, ...await companyLogo(name) })))
  return { info: { ...info, publishers, developers }, complete: !info.failed && found.every(item => item.final), companies: found.map(({ name, logo }) => ({ name, logo })) }
}
// Las caras compuestas en la ventana se guardan aquí: la próxima vez la caja sale al instante.
const GENERATED = 'v6' // sube al cambiar el diseño de las caras generadas
const generatedName = (book, kind) => `${book.appid}-gen-${kind}-${GENERATED}.jpg`
// Al arrancar: fuera las caras compuestas con diseños anteriores (otra versión).
async function dropOldGenerated() {
  for (const file of await fs.readdir(artDir()).catch(() => [])) if (file.includes('-gen-') && (!file.endsWith(`-${GENERATED}.jpg`) || /-gen-spine-v\d+\.jpg$/.test(file))) await fs.rm(path.join(artDir(), file), { force: true }) // también los lomos sin estilo en el nombre
}
async function clearGenerated() {
  for (const file of await fs.readdir(artDir()).catch(() => [])) if (file.includes('-gen-')) await fs.rm(path.join(artDir(), file), { force: true })
}
// Qué juegos están instalados ahora mismo (se instalan y desinstalan sin pasar por la app): se mira cada pocos segundos.
let installedCache = { at: 0, set: new Set() }
async function installedSet() {
  if (Date.now() - installedCache.at > 10000) installedCache = { at: Date.now(), set: new Set((await installedGames()).map(game => game.appid)) }
  return installedCache.set
}
// Los juegos de las cuentas de este PC, instalados o no. Con clave de la Web API, la biblioteca completa; sin ella
// (o si las cuentas son privadas), los que se han jugado alguna vez, con nombre y tipo de la caché del cliente.
async function ownedSteamGames() {
  const games = new Map()
  if (settings.steamWebApiKey) {
    let hidden = 0
    for (const user of await steamUsers()) {
      const result = await ownedGames(settings.steamWebApiKey, user.steamid)
      if (result.private) hidden++
      for (const game of result.games) if (!games.has(game.appid) && !isTool(game.appid, game.name)) games.set(game.appid, game.name)
    }
    if (games.size || !hidden) return { source: 'api', games }
  }
  const played = await playedApps(), known = await appInfo(new Set(played))
  // Las apps que el cliente ya no tiene en su caché suelen ser retiradas o no ser juegos: se omiten (consultarlas en la tienda
  // de una en una haría esperar la importación).
  for (const appid of played) {
    const app = known.get(appid)
    if (app?.type === 'game' && app.name && !isTool(appid, app.name)) games.set(appid, app.name)
  }
  return { source: 'local', games }
}
// ----- Mangas y cómics locales: archivos sueltos y carpetas de la biblioteca -----
// Agrega (o completa) los libros de estos archivos con lo que dicen su ComicInfo.xml, su nombre y su carpeta.
async function addComics(files, { folder = null, collectionId = ALL } = {}) {
  let added = 0
  for (const file of files) {
    let book = library.find(item => item.path === file)
    if (!book) {
      book = { id: crypto.randomUUID(), title: path.basename(file, path.extname(file)), path: file, type: path.extname(file).toLowerCase().slice(1), page: 0 }
      library.push(book); added++
    }
    if (folder && !book.folder) book.folder = folder
    if (!book.described) {
      const info = await describeComic(file).catch(() => null)
      if (info) Object.assign(book, { title: info.title, series: info.series, number: info.number, volume: info.volume, pages: info.pages, rtl: info.rtl, described: true })
    }
    if (collectionId !== ALL) setMembership(collections, collectionId, book.id, true)
  }
  return added
}
function dropBooks(ids) {
  if (!ids.size) return
  library = library.filter(book => !ids.has(book.id))
  for (const collection of collections) collection.bookIds = collection.bookIds.filter(id => !ids.has(id))
}
// Revisa las carpetas: lo nuevo entra, lo que ya no está (o es de una carpeta quitada) sale.
let scanning = null
function scanFolders() {
  scanning ??= (async () => {
    let added = 0
    const found = new Set()
    for (const folder of settings.folders) {
      const files = await scanFolder(folder)
      files.forEach(file => found.add(file))
      added += await addComics(files, { folder })
    }
    const gone = new Set(library.filter(book => book.folder && (!settings.folders.includes(book.folder) || !found.has(book.path))).map(book => book.id))
    dropBooks(gone)
    if (added || gone.size) { await save(); await saveCollections(); notifyWallpapers() }
    return { added, removed: gone.size, total: library.filter(book => book.folder).length }
  })().finally(() => { scanning = null })
  return scanning
}
function launchSteam(appid, action = 'rungameid') {
  const url = `steam://${action}/${appid}`
  return shell.openExternal(url).catch(() => {
    const child = spawn(process.platform === 'win32' ? 'steam.exe' : 'steam', [url], { detached: true, stdio: 'ignore' })
    child.on('error', error => console.error('No se pudo abrir Steam:', error))
    child.unref()
  })
}
const noSteam = book => { if (book.type === 'steam') throw new Error('Los juegos de Steam no tienen páginas.') }
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
  try {
    const stored = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    if (typeof stored?.steamGridDbKey === 'string') settings.steamGridDbKey = stored.steamGridDbKey
    if (typeof stored?.steamWebApiKey === 'string') settings.steamWebApiKey = stored.steamWebApiKey
    if (SPINE_STYLES.includes(stored?.spineStyle)) settings.spineStyle = stored.spineStyle
    if (Array.isArray(stored?.folders)) settings.folders = stored.folders.filter(folder => typeof folder === 'string' && path.isAbsolute(folder))
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Ajustes ignorados:', error.message) }
  dropOldGenerated().catch(() => {})
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
  tomes = createTomes({ dir: path.join(app.getPath('userData'), 'tomes') })
  protocol.handle('tome', async request => {
    const url = new URL(request.url), [mdId, vol, side] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const bytes = url.host === 'md' ? await tomes.face(mdId, vol, side).catch(() => null) : null
    if (!bytes) return new Response(null, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
    return new Response(bytes, { headers: { 'Content-Type': imageKind(bytes) || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=2592000' } })
  })
  await win.loadFile(path.join(__dirname, 'index.html'))
  if (settings.folders.length) scanFolders().then(() => { if (!win.isDestroyed()) win.webContents.send('library-changed') }).catch(error => console.warn('Carpetas:', error.message))
}).catch(error => { dialog.showErrorBox('No se pudo iniciar Manga Desktop', error.message); app.quit() })
app.on('window-all-closed', () => app.quit())
ipcMain.handle('library', async (_event, collectionId = ALL) => {
  const installed = library.some(book => book.type === 'steam') ? await installedSet() : new Set()
  return booksFor(library, collections, collectionId).map(({ id, title, page, type, appid }) => ({ id, title, page, type, ...(type === 'steam' && { installed: installed.has(appid) }) }))
})
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
  await addComics(result.filePaths.filter(file => COMIC.test(file)), { collectionId })
  await save()
  if (collectionId !== ALL) await saveCollections()
  notifyWallpapers()
})
ipcMain.handle('settings', () => ({ ...settings }))
// Solo cambia lo que llega: el estilo de los lomos se guarda solo, sin tocar las claves.
ipcMain.handle('settings-save', async (_event, value) => {
  if (value?.spineStyle !== undefined && !SPINE_STYLES.includes(value.spineStyle)) throw new Error('Estilo de lomo desconocido.')
  const key = typeof value?.steamGridDbKey === 'string' ? value.steamGridDbKey.trim() : settings.steamGridDbKey
  let warning = null
  if (key && key !== settings.steamGridDbKey) {
    if (!validKey(key)) throw new Error('La clave de SteamGridDB debe tener 32 caracteres hexadecimales.')
    try { if (!await checkKey(key)) throw new SteamGridDbKeyError('SteamGridDB rechazó la clave.') } catch (error) {
      if (error instanceof SteamGridDbKeyError) throw error
      warning = 'No se pudo comprobar la clave con SteamGridDB; se guardó igualmente.'
    }
  }
  const apiKey = typeof value?.steamWebApiKey === 'string' ? value.steamWebApiKey.trim() : settings.steamWebApiKey
  if (apiKey && !validApiKey(apiKey)) throw new Error('La clave de la Web API de Steam debe tener 32 caracteres hexadecimales.')
  if (settings.steamGridDbKey !== key) await clearGenerated() // las caras compuestas usaban las imágenes de la clave anterior
  settings.steamGridDbKey = key
  settings.steamWebApiKey = apiKey
  if (value?.spineStyle) settings.spineStyle = value.spineStyle // cada estilo tiene su caché: los lomos de este se componen al volver a cargar
  artMisses.clear()
  await saveSettings(); notifyWallpapers()
  return { warning }
})
ipcMain.handle('steam-import', async (_event, collectionId = ALL) => {
  booksFor(library, collections, collectionId)
  const games = await installedGames()
  let owned = { source: null, games: new Map() }
  try { owned = await ownedSteamGames() } catch (error) {
    if (error instanceof SteamApiKeyError) throw error
    console.warn('Biblioteca de Steam:', error.message)
  }
  if (!games.length && !owned.games.size) throw new Error('No se encontraron juegos de Steam en las rutas por defecto.')
  installedCache = { at: Date.now(), set: new Set(games.map(game => game.appid)) }
  let added = 0
  const add = (appid, title, file) => {
    let book = library.find(item => item.type === 'steam' && item.appid === appid)
    if (!book) { book = { id: crypto.randomUUID(), title, path: file, type: 'steam', appid, page: 0 }; library.push(book); added++ }
    else if (file && !book.path) book.path = file
    if (collectionId !== ALL) setMembership(collections, collectionId, book.id, true)
  }
  for (const game of games) add(game.appid, game.name, game.path)
  let missing = 0
  for (const [appid, name] of owned.games) if (!installedCache.set.has(appid)) { add(appid, name, ''); missing++ }
  await save()
  if (collectionId !== ALL) await saveCollections()
  notifyWallpapers()
  return { added, installed: games.length, missing, source: owned.source }
})
ipcMain.handle('logo', async (_event, id) => {
  const book = getBook(id)
  return book.type === 'steam' ? steamArt(book, 'logo') : null
})
// Las caras de la caja de un juego: las reales de LaunchBox y, para generar las que falten, logo, banner, capturas y descripción.
ipcMain.handle('game-box', async (_event, id) => {
  const book = getBook(id)
  if (book.type !== 'steam') return null
  // Contraportada e interior (la bandeja con el disco): lo real de LaunchBox, lo ya compuesto o lo necesario para componerlo.
  const [back, disc, generatedBack, generatedInside] = await Promise.all([boxArt(book, 'back'), boxArt(book, 'disc'), readArt(generatedName(book, 'back')), readArt(generatedName(book, 'inside'))])
  const result = { back, disc, generatedBack: back ? null : generatedBack, generatedInside }
  const needBack = !back && !generatedBack
  if (!needBack && generatedInside) return result
  const [logo, { info, companies, complete }] = await Promise.all([steamArt(book, 'logo'), companiesOf(book, { withStore: needBack })])
  Object.assign(result, { logo, companies, complete, description: info.description, developers: info.developers, publishers: info.publishers, hero: null, shots: [] })
  result.art = await heroArt(book, { preferGrid: false }) // para el manual del interior
  if (needBack) {
    result.hero = await heroArt(book)
    result.shots = (await Promise.all(info.screenshots.map(url => download(url).catch(() => null)))).filter(Boolean)
  }
  return result
})
// fresh: los datos para componerlo aunque ya haya uno guardado (para cambiar de estilo o comparar).
ipcMain.handle('game-spine', async (_event, id, fresh = false) => {
  const book = getBook(id)
  if (book.type !== 'steam') return null
  const spine = fresh === true ? null : await boxArt(book, 'spine')
  if (spine) return { spine }
  const style = settings.spineStyle, generated = fresh === true ? null : await readArt(generatedName(book, `spine-${style}`))
  if (generated) return { generated }
  const [logo, art, { companies, complete }] = await Promise.all([steamArt(book, 'logo'), heroArt(book, { preferGrid: false }), companiesOf(book)])
  return { logo, art, companies, complete, style }
})
// Lo necesario para componer una portada cuando ninguna fuente la tiene.
ipcMain.handle('game-header', async (_event, id) => {
  const book = getBook(id)
  if (book.type !== 'steam') return null
  const header = await localArt(book.appid, 'header') || await storeInfo(book).then(info => info.header && download(info.header)).catch(() => null)
  return { header, logo: await steamArt(book, 'logo') }
})
ipcMain.handle('game-art-save', async (_event, id, kind, bytes) => {
  const book = getBook(id)
  if (book.type !== 'steam' || !(['cover', 'back', 'inside'].includes(kind) || SPINE_STYLES.some(style => kind === `spine-${style}`))) throw new Error('Imagen de caja inválida.')
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Imagen de caja inválida.')
  await cachedArt(generatedName(book, kind), async () => Buffer.from(bytes))
})
ipcMain.handle('launchbox-status', async () => {
  const index = await boxIndex()
  return { updated: index?.updated || null, count: index?.count || 0, running: Boolean(launchboxTask) }
})
ipcMain.handle('launchbox-update', async () => {
  if (!launchboxTask) launchboxTask = (async () => {
    let last = 0
    const index = await updateIndex(app.getPath('userData'), { onProgress: progress => {
      const now = Date.now()
      if (now - last < 250) return
      last = now
      if (win && !win.isDestroyed()) win.webContents.send('launchbox-progress', progress)
    } })
    launchbox = index; launchboxLoaded = true
    await clearGenerated()
    artMisses.clear(); notifyWallpapers()
    return index
  })().finally(() => { launchboxTask = null })
  const index = await launchboxTask
  return { updated: index.updated, count: index.count }
})
ipcMain.handle('folders', () => [...settings.folders])
ipcMain.handle('folder-add', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Carpetas de mangas y cómics', properties: ['openDirectory', 'multiSelections'] })
  if (result.canceled) return null
  for (const folder of result.filePaths) if (!settings.folders.includes(folder)) settings.folders.push(folder)
  await saveSettings()
  return scanFolders()
})
ipcMain.handle('folder-remove', async (_event, folder) => {
  if (!settings.folders.includes(folder)) throw new Error('Esa carpeta no está en la biblioteca.')
  settings.folders = settings.folders.filter(item => item !== folder)
  await saveSettings()
  return scanFolders()
})
ipcMain.handle('folders-scan', () => scanFolders())
// Las obras del estante: los capítulos de una misma serie juntos, con sus tomos.
ipcMain.handle('shelf-works', (_event, collectionId = ALL) => groupWorks(booksFor(library, collections, collectionId)))
// El capítulo siguiente (o anterior) de la misma obra, para seguir leyendo al acabar uno.
ipcMain.handle('neighbor', (_event, id, step) => {
  const book = getBook(id)
  if (step !== 1 && step !== -1) throw new Error('Paso inválido.')
  const work = groupWorks(library).find(item => item.kind === 'series' && item.chapters.includes(book.id))
  if (!work) return null
  const next = work.chapters[work.chapters.indexOf(book.id) + step]
  return next ? { id: next, title: getBook(next).title } : null
})
// Los tomos de una obra como en manga-reader: reparto de sus capítulos locales (Wikipedia, MangaDex) y sus caras. Los
// capítulos que aún no tienen tomo siguen como tomos finos. null si no se encuentra nada (sin red, obra desconocida).
const seriesOf = id => groupWorks(library).find(item => item.kind === 'series' && item.id === id)
ipcMain.handle('series-tomes', async (_event, id) => {
  const work = seriesOf(id)
  if (!work) return null
  const books = work.chapters.map(getBook), result = await tomes.list(work.title, books.map(book => ({ id: book.id, num: book.number, volume: book.volume })))
  if (!result.mdId || !result.vols.length) return null
  const pagesOf = ids => { let n = 0; for (const bookId of ids) { const p = getBook(bookId).pages; if (!(p > 0)) return null; n += p } return n }
  const face = (vol, side) => `tome://md/${result.mdId}/${encodeURIComponent(vol)}/${side}`
  const vols = result.vols.map(v => ({ vol: v.vol, label: `Tomo ${v.vol}`, chapters: v.chapters, pages: pagesOf(v.chapters), thumb: v.cover ? face(v.vol, 'thumb') : null, art: v.cover ? face(v.vol, 'art') : null, front: face(v.vol, 'front'), back: face(v.vol, 'back') }))
  for (const bookId of result.loose) { const book = getBook(bookId); vols.push({ vol: String(book.number ?? ''), label: `Capítulo ${book.number}`, chapters: [bookId], pages: book.pages || null }) }
  return { vols, key: result.key }
})
ipcMain.handle('series-logo', async (_event, id) => {
  const work = seriesOf(id)
  if (!work) return null
  const books = work.chapters.map(getBook), result = await tomes.list(work.title, books.map(book => ({ id: book.id, num: book.number, volume: book.volume })))
  return tomes.logo(result.key, result.names).catch(() => null)
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
  // Un juego sin instalar abre el instalador de Steam.
  if (book.type === 'steam') { const installed = (await installedSet()).has(book.appid); await launchSteam(book.appid, installed ? 'rungameid' : 'install'); return { title: book.title, type: book.type, launched: true, installed } }
  await largeFiles.ensure(book)
  if (book.type === 'pdf') return { title: book.title, type: book.type, page: book.page, ...await pdfSource(book) }
  const entries = book.type === 'cbr' ? await rar(book.path) : await pages(book.path)
  if (!entries.length) throw new Error('El archivo no contiene páginas de imagen.')
  return { title: book.title, type: book.type, total: entries.length, page: Math.min(book.page, entries.length - 1) }
})
ipcMain.handle('cover', async (_event, id) => {
  const book = getBook(id)
  if (book.type === 'steam') return steamArt(book, 'cover')
  if (book.type === 'pdf') return null
  if (!await largeFiles.canPreview(book)) return null
  const entries = book.type === 'cbr' ? await rar(book.path) : await pages(book.path)
  const entry = entries[0]
  if (!entry || !await largeFiles.canPreview(book, entry.header?.size ?? entry.unpSize)) return null
  return book.type === 'cbr' ? await rar(book.path, entry.name) : await entry.getData()
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
  noSteam(book)
  if (allowPrompt) await largeFiles.ensure(book)
  else if (!await largeFiles.canPreview(book)) return { deferred: true }
  const entries = book.type === 'cbr' ? await rar(book.path) : await pages(book.path)
  if (!Number.isInteger(number) || number < 0 || number >= entries.length) throw new Error('Página fuera de rango.')
  const entry = entries[number]
  const size = entry.header?.size ?? entry.unpSize
  if (allowPrompt) await largeFiles.ensure(book, size)
  else if (!await largeFiles.canPreview(book, size)) return { deferred: true }
  const data = book.type === 'cbr' ? await rar(book.path, entry.name) : await entry.getData()
  if (remember) { book.page = number; book.readAt = Date.now(); await save() }
  return { data, name: entry.entryName || entry.name }
})
ipcMain.handle('progress', async (_event, id, number) => {
  if (!Number.isInteger(number) || number < 0) throw new Error('Página inválida.')
  const book = getBook(id)
  book.page = number
  book.readAt = Date.now() // el último leído de una obra va de frente en el estante
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
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('El fondo de escritorio solo está disponible en Windows y Linux.')
  const display = screen.getAllDisplays().find(item => String(item.id) === String(displayId))
  if (!display) throw new Error('La pantalla seleccionada ya no está conectada.')
  booksFor(library, collections, collectionId)
  const key = String(display.id), previous = wallpapers.get(key)
  const linux = process.platform === 'linux'
  const wallpaper = new BrowserWindow({ ...display.bounds, frame: false, skipTaskbar: true, show: false, ...(linux ? { type: 'desktop', title: 'Manga Desktop - Estante', resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false } : {}), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  secureWindow(wallpaper)
  if (linux) wallpaper.on('page-title-updated', event => event.preventDefault())
  const item = { window: wallpaper, collectionId, mouseForwarder: null }
  wallpaper.on('closed', () => { item.mouseForwarder?.kill(); if (wallpapers.get(key) === item) wallpapers.delete(key) })
  try {
    await wallpaper.loadFile(path.join(__dirname, 'index.html'), { query: { wallpaper: '1', collection: collectionId } })
    if (linux) {
      // En Linux la ventana de tipo «desktop» (_NET_WM_WINDOW_TYPE_DESKTOP) queda bajo las demás y recibe el ratón directamente.
      wallpaper.setBounds(display.bounds)
      wallpaper.showInactive()
      if (previous && !previous.window.isDestroyed()) previous.window.destroy()
      wallpapers.set(key, item)
      return { collectionId }
    }
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
