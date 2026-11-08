const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const run = promisify(execFile)
const validId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff

function parseVdf(text) {
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}]|\/\/[^\r\n]*|[^\s{}"]+/g)?.filter(token => !token.startsWith('//')) || []
  let at = 0
  const read = token => token.startsWith('"') ? token.slice(1, -1).replace(/\\([\\"])/g, '$1') : token
  function object(nested = false) {
    const result = Object.create(null)
    while (at < tokens.length && tokens[at] !== '}') {
      const key = read(tokens[at++]).toLowerCase()
      if (at >= tokens.length || tokens[at] === '}') throw new Error('VDF incompleto')
      result[key] = tokens[at] === '{' ? (at++, object(true)) : read(tokens[at++])
    }
    if (nested) {
      if (tokens[at] !== '}') throw new Error('VDF incompleto')
      at++
    }
    return result
  }
  return object()
}

async function exists(file) { try { await fs.access(file); return true } catch { return false } }
async function directoryExists(file) { try { return (await fs.stat(file)).isDirectory() } catch { return false } }
async function readVdf(file) { try { return parseVdf(await fs.readFile(file, 'utf8')) } catch { return null } }

async function steamRoots() {
  if (process.platform !== 'win32') return []
  const registry = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']
  ]
  const found = await Promise.all(registry.map(async ([key, value]) => {
    try {
      const { stdout } = await run('reg.exe', ['query', key, '/v', value], { windowsHide: true, timeout: 3000 })
      return stdout.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i)?.[1].trim()
    } catch { return null }
  }))
  const defaults = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map(dir => path.join(dir, 'Steam'))
  const common = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap(letter => [`${letter}:\\SteamLibrary`, `${letter}:\\Steam`])
  const candidates = [...new Set([...found, ...defaults, ...common].filter(Boolean))]
  const available = await Promise.all(candidates.map(async dir => await exists(path.join(dir, 'steamapps')) ? dir : null))
  return available.filter(Boolean)
}

async function coverFor(id, roots) {
  const candidates = roots.flatMap(root => {
    const cache = path.join(root, 'appcache', 'librarycache')
    return [path.join(cache, id, 'library_600x900.jpg'), path.join(cache, `${id}_library_600x900.jpg`), path.join(cache, id, 'header.jpg'), path.join(cache, `${id}_header.jpg`)]
  })
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  return null
}

async function listSteamGames({ steamPaths } = {}) {
  const roots = [...new Set((steamPaths || await steamRoots()).filter(Boolean))]
  const libraries = new Set(roots)
  for (const root of roots) {
    const data = await readVdf(path.join(root, 'steamapps', 'libraryfolders.vdf'))
    const folders = data?.libraryfolders
    if (!folders || typeof folders !== 'object') continue
    for (const [key, item] of Object.entries(folders)) {
      if (!/^\d+$/.test(key)) continue
      const directory = typeof item === 'string' ? item : item?.path
      if (directory) libraries.add(directory)
    }
  }
  const games = new Map()
  for (const library of libraries) {
    const steamapps = path.join(library, 'steamapps')
    let files
    try { files = await fs.readdir(steamapps) } catch { continue }
    for (const file of files) {
      const match = /^appmanifest_([1-9]\d*)\.acf$/i.exec(file)
      if (!match || !validId(match[1]) || games.has(match[1])) continue
      const data = (await readVdf(path.join(steamapps, file)))?.appstate
      if (!data || data.appid !== match[1] || !data.name || !data.installdir || !(Number(data.stateflags) & 4)) continue
      if (data.installdir === '.' || data.installdir === '..' || /[\\/]/.test(data.installdir) || !await directoryExists(path.join(steamapps, 'common', data.installdir))) continue
      games.set(match[1], { id: match[1], name: data.name, coverPath: await coverFor(match[1], roots) })
    }
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

async function launchSteamGame(id, openExternal) {
  if (!validId(id)) throw new Error('ID de Steam inválido.')
  if (typeof openExternal !== 'function') throw new Error('No se puede abrir Steam.')
  await openExternal(`steam://run/${id}`)
}

module.exports = { listSteamGames, launchSteamGame, parseVdf }
