const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

// Lector del formato de texto KeyValues (VDF) de Valve: cadenas entre comillas, bloques con llaves y comentarios «//».
function parseVdf(text) {
  let i = 0
  const skip = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) i++
      else if (text[i] === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++ }
      else break
    }
  }
  const token = () => {
    skip()
    if (i >= text.length) return null
    const c = text[i]
    if (c === '{' || c === '}') { i++; return { brace: c } }
    if (c === '"') {
      let out = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) { const n = text[i + 1]; out += n === 'n' ? '\n' : n === 't' ? '\t' : n; i += 2 }
        else out += text[i++]
      }
      i++
      return { value: out }
    }
    let out = ''
    while (i < text.length && !/[\s{}"]/.test(text[i])) out += text[i++]
    return { value: out }
  }
  const object = nested => {
    const result = {}
    for (;;) {
      const key = token()
      if (!key) { if (nested) throw new Error('VDF incompleto.'); return result }
      if (key.brace === '}') { if (!nested) throw new Error('VDF inválido.'); return result }
      if (key.brace) throw new Error('VDF inválido.')
      const value = token()
      if (!value || value.brace === '}') throw new Error('VDF inválido.')
      result[key.value.toLowerCase()] = value.brace === '{' ? object(true) : value.value
      // Los «#include» y condicionales «[$WIN32]» no se usan en estos archivos; se ignoran.
      skip(); if (text[i] === '[') { while (i < text.length && text[i] !== ']') i++; i++ }
    }
  }
  return object(false)
}

// Rutas donde Steam se instala por defecto.
function defaultSteamRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const p = path.win32
    return [...new Set([
      p.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
      p.join(env.ProgramFiles || 'C:\\Program Files', 'Steam')
    ])]
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Steam')]
  const data = env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return [...new Set([
    path.join(data, 'Steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'), // Flatpak
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam') // Snap
  ])]
}

const real = async file => { try { return await fs.realpath(file) } catch { return null } }

// Las carpetas de biblioteca: la instalación y las que lista libraryfolders.vdf (formato nuevo y antiguo).
async function steamLibraries(roots = defaultSteamRoots()) {
  const found = new Map()
  const add = async dir => {
    const resolved = await real(path.join(dir, 'steamapps'))
    if (resolved && !found.has(resolved)) found.set(resolved, { root: dir, steamapps: resolved })
  }
  for (const root of roots) {
    if (!await real(root)) continue
    await add(root)
    for (const file of [path.join(root, 'steamapps', 'libraryfolders.vdf'), path.join(root, 'config', 'libraryfolders.vdf')]) {
      let data
      try { data = parseVdf(await fs.readFile(file, 'utf8')) } catch { continue }
      const folders = data.libraryfolders || {}
      for (const [key, value] of Object.entries(folders)) {
        if (!/^\d+$/.test(key)) continue
        const dir = typeof value === 'string' ? value : value?.path
        if (dir) await add(dir)
      }
    }
  }
  return [...found.values()]
}

// Herramientas que Steam instala como «apps» pero no son juegos.
const TOOL_IDS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100'])
const isTool = (appid, name) => TOOL_IDS.has(String(appid)) || /^(Proton\b|Steam Linux Runtime|Steamworks Common|SteamVR\b|Steam Audio)/i.test(name)

async function installedGames(roots = defaultSteamRoots()) {
  const libraries = await steamLibraries(roots)
  const games = new Map()
  for (const library of libraries) {
    let names
    try { names = await fs.readdir(library.steamapps) } catch { continue }
    for (const name of names) {
      if (!/^appmanifest_\d+\.acf$/i.test(name)) continue
      let state
      try { state = parseVdf(await fs.readFile(path.join(library.steamapps, name), 'utf8')).appstate } catch { continue }
      const appid = String(state?.appid || '')
      if (!/^\d+$/.test(appid) || !state.name || games.has(appid) || isTool(appid, state.name)) continue
      games.set(appid, { appid, name: state.name, path: path.join(library.steamapps, 'common', state.installdir || '') })
    }
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Las portadas y logos que el propio cliente de Steam guarda en su caché, por si no hay clave de SteamGridDB.
// Nombres de cada imagen en la caché de Steam; los clientes recientes usan «library_capsule.jpg» para la portada.
const LOCAL_FILES = {
  logo: ['logo.png'],
  hero: ['library_hero.jpg'],
  header: ['library_header.jpg', 'header.jpg'],
  cover: ['library_600x900_2x.jpg', 'library_600x900.jpg', 'library_capsule.jpg']
}
async function localArt(appid, kind, roots = defaultSteamRoots()) {
  const files = LOCAL_FILES[kind] || []
  for (const root of roots) {
    const dir = path.join(root, 'appcache', 'librarycache'), own = path.join(dir, String(appid))
    // Formato antiguo: «<appid>_<archivo>» o «<appid>/<archivo>»; el actual guarda cada imagen en una subcarpeta con nombre de hash.
    const folders = [own]
    try { for (const entry of await fs.readdir(own, { withFileTypes: true })) if (entry.isDirectory()) folders.push(path.join(own, entry.name)) } catch {}
    for (const file of files) {
      for (const candidate of [...folders.map(folder => path.join(folder, file)), path.join(dir, `${appid}_${file}`)]) {
        try { return await fs.readFile(candidate) } catch {}
      }
    }
  }
  return null
}

// Las cuentas que han iniciado sesión en este PC (config/loginusers.vdf), la más reciente primero.
async function steamUsers(roots = defaultSteamRoots()) {
  const users = new Map()
  for (const root of roots) {
    let data
    try { data = parseVdf(await fs.readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8')).users || {} } catch { continue }
    for (const [steamid, user] of Object.entries(data)) {
      if (!/^7656\d{13}$/.test(steamid) || users.has(steamid)) continue
      users.set(steamid, { steamid, name: user?.personaname || '', recent: user?.mostrecent === '1' })
    }
  }
  return [...users.values()].sort((a, b) => Number(b.recent) - Number(a.recent))
}
// Sin la Web API: los juegos que cada cuenta ha usado alguna vez, según su localconfig.vdf (userdata/<cuenta>/config).
async function playedApps(roots = defaultSteamRoots()) {
  const apps = new Set()
  for (const root of roots) {
    let accounts
    try { accounts = await fs.readdir(path.join(root, 'userdata')) } catch { continue }
    for (const account of accounts) {
      if (!/^\d+$/.test(account)) continue
      let data
      try { data = parseVdf(await fs.readFile(path.join(root, 'userdata', account, 'config', 'localconfig.vdf'), 'utf8')) } catch { continue }
      const list = data.userlocalconfigstore?.software?.valve?.steam?.apps || {}
      for (const appid of Object.keys(list)) if (/^\d+$/.test(appid) && appid !== '0') apps.add(appid)
    }
  }
  return [...apps]
}

// Nombre y tipo («game», «dlc», «tool»…) de cada app, de la caché binaria del cliente (appcache/appinfo.vdf).
// Formatos 0x07564427 (v27), 0x07564428 (v28) y 0x07564429 (v29, con las claves en una tabla de cadenas).
function parseAppInfo(buffer, wanted = null) {
  const magic = buffer.readUInt32LE(0), version = { 0x07564427: 27, 0x07564428: 28, 0x07564429: 29 }[magic]
  if (!version) throw new Error('Formato de appinfo.vdf desconocido.')
  let pos = 8, strings = null
  if (version >= 29) {
    const at = Number(buffer.readBigInt64LE(8)), count = buffer.readUInt32LE(at)
    strings = []
    let p = at + 4
    for (let i = 0; i < count; i++) { const end = buffer.indexOf(0, p); strings.push(buffer.toString('utf8', p, end)); p = end + 1 }
    pos = 16
  }
  const cstr = at => { const end = buffer.indexOf(0, at); return [buffer.toString('utf8', at, end), end + 1] }
  // Objeto binario: tipo (0 objeto, 1 texto, 2 entero, 7 entero de 64 bits, 8 fin), clave y valor.
  function object(at, end) {
    const out = {}
    while (at < end) {
      const type = buffer[at++]
      if (type === 8) return [out, at]
      let key
      if (strings) { key = strings[buffer.readUInt32LE(at)]; at += 4 } else [key, at] = cstr(at)
      key = String(key).toLowerCase()
      if (type === 0) [out[key], at] = object(at, end)
      else if (type === 1) [out[key], at] = cstr(at)
      else if (type === 2) { out[key] = buffer.readInt32LE(at); at += 4 }
      else if (type === 7) { out[key] = buffer.readBigUInt64LE(at).toString(); at += 8 }
      else if (type === 3) { out[key] = buffer.readFloatLE(at); at += 4 }
      else throw new Error(`Tipo ${type} desconocido en appinfo.vdf.`)
    }
    return [out, at]
  }
  const apps = new Map(), header = version >= 28 ? 60 : 40
  while (pos + 8 <= buffer.length) {
    const appid = buffer.readUInt32LE(pos)
    if (!appid) break
    const size = buffer.readUInt32LE(pos + 4), start = pos + 8, end = start + size
    if (!wanted || wanted.has(String(appid))) {
      try {
        const [data] = object(start + header, end)
        const common = data.appinfo?.common
        if (common?.name) {
          // Desarrolladora y editora, de «associations» (el cliente las guarda aquí; no hace falta la tienda).
          const links = Object.values(common.associations || {}), names = kind => links.filter(link => link?.type === kind && link.name).map(link => String(link.name)).slice(0, 2)
          apps.set(String(appid), { name: String(common.name), type: String(common.type || '').toLowerCase(), developers: names('developer'), publishers: names('publisher') })
        }
      } catch {}
    }
    pos = end
  }
  return apps
}
async function appInfo(wanted = null, roots = defaultSteamRoots()) {
  for (const root of roots) {
    let buffer
    try { buffer = await fs.readFile(path.join(root, 'appcache', 'appinfo.vdf')) } catch { continue }
    try { return parseAppInfo(buffer, wanted) } catch { continue }
  }
  return new Map()
}

module.exports = { parseVdf, defaultSteamRoots, steamLibraries, installedGames, isTool, localArt, steamUsers, playedApps, parseAppInfo, appInfo }
