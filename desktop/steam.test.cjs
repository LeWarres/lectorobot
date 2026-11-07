const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { parseVdf, defaultSteamRoots, installedGames, isTool, localArt, steamUsers, playedApps, parseAppInfo } = require('./steam.cjs')

test('lee el formato VDF de Steam con escapes y comentarios', () => {
  const data = parseVdf('// cabecera\n"LibraryFolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\t"D:\\\\Juegos"\n}\n')
  assert.equal(data.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam')
  assert.equal(data.libraryfolders['1'], 'D:\\Juegos')
  assert.throws(() => parseVdf('"a" { "b" "c"'))
})

test('conoce las rutas por defecto de Steam en Windows y Linux', () => {
  assert.deepEqual(defaultSteamRoots({ platform: 'win32', env: {} }), ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'])
  const linux = defaultSteamRoots({ platform: 'linux', env: {}, home: '/home/u' })
  assert.ok(linux.includes('/home/u/.local/share/Steam'))
  assert.ok(linux.includes('/home/u/.steam/steam'))
  assert.ok(linux.includes('/home/u/.var/app/com.valvesoftware.Steam/.local/share/Steam'))
})

test('encuentra los juegos de todas las bibliotecas y descarta las herramientas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-')), root = path.join(dir, 'Steam'), extra = path.join(dir, 'Otra')
  try {
    await fs.mkdir(path.join(root, 'steamapps'), { recursive: true })
    await fs.mkdir(path.join(extra, 'steamapps'), { recursive: true })
    await fs.writeFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "0" { "path" "${root}" } "1" { "path" "${extra}" } }`)
    const manifest = (folder, appid, name) => fs.writeFile(path.join(folder, 'steamapps', `appmanifest_${appid}.acf`), `"AppState" { "appid" "${appid}" "name" "${name}" "installdir" "${name}" }`)
    await manifest(root, '20', 'Zeta')
    await manifest(root, '1493710', 'Proton Experimental')
    await manifest(extra, '10', 'Alfa')
    await manifest(extra, '20', 'Zeta')
    const games = await installedGames([root, root, path.join(dir, 'no-existe')])
    assert.deepEqual(games.map(game => [game.appid, game.name]), [['10', 'Alfa'], ['20', 'Zeta']])
    assert.equal(games[0].path, path.join(extra, 'steamapps', 'common', 'Alfa'))
    await fs.mkdir(path.join(root, 'appcache', 'librarycache', '10'), { recursive: true })
    await fs.writeFile(path.join(root, 'appcache', 'librarycache', '10', 'library_600x900.jpg'), 'portada')
    assert.equal(String(await localArt('10', 'cover', [root])), 'portada')
    assert.equal(await localArt('10', 'logo', [root]), null)
    // Formato actual del cliente: cada imagen en una subcarpeta con nombre de hash, y la portada como «library_capsule.jpg».
    await fs.mkdir(path.join(root, 'appcache', 'librarycache', '20', 'a1b2'), { recursive: true })
    await fs.writeFile(path.join(root, 'appcache', 'librarycache', '20', 'a1b2', 'library_capsule.jpg'), 'capsula')
    await fs.writeFile(path.join(root, 'appcache', 'librarycache', '20', 'a1b2', 'logo.png'), 'logo')
    assert.equal(String(await localArt('20', 'cover', [root])), 'capsula')
    assert.equal(String(await localArt('20', 'logo', [root])), 'logo')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('reconoce Proton y los entornos de ejecución como herramientas', () => {
  assert.ok(isTool('1', 'Steam Linux Runtime 3.0 (sniper)'))
  assert.ok(isTool('228980', 'Lo que sea'))
  assert.ok(!isTool('1016920', 'Unrailed!'))
})

test('lee las cuentas del PC y los juegos que han jugado', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-')), root = path.join(dir, 'Steam')
  try {
    await fs.mkdir(path.join(root, 'config'), { recursive: true })
    await fs.writeFile(path.join(root, 'config', 'loginusers.vdf'), '"users" { "76561198000000001" { "PersonaName" "Uno" "MostRecent" "0" } "76561198000000002" { "PersonaName" "Dos" "MostRecent" "1" } "123" { } }')
    assert.deepEqual((await steamUsers([root])).map(user => [user.name, user.recent]), [['Dos', true], ['Uno', false]])
    await fs.mkdir(path.join(root, 'userdata', '42', 'config'), { recursive: true })
    await fs.writeFile(path.join(root, 'userdata', '42', 'config', 'localconfig.vdf'), '"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "10" { "LastPlayed" "1" } "20" { } "0" { } } } } } }')
    assert.deepEqual((await playedApps([root])).sort(), ['10', '20'])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

// Arma un appinfo.vdf mínimo: v29 (claves en tabla de cadenas) o v28 (claves en línea).
function appinfo(version, apps) {
  const strings = [], parts = []
  const key = k => { if (version < 29) return Buffer.from(k + '\0'); let i = strings.indexOf(k); if (i < 0) i = strings.push(k) - 1; const b = Buffer.alloc(4); b.writeUInt32LE(i); return b }
  const obj = o => Buffer.concat([...Object.entries(o).map(([k, v]) => typeof v === 'object'
    ? Buffer.concat([Buffer.from([0]), key(k), obj(v)])
    : typeof v === 'number' ? Buffer.concat([Buffer.from([2]), key(k), (() => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b })()])
    : Buffer.concat([Buffer.from([1]), key(k), Buffer.from(v + '\0')])), Buffer.from([8])])
  for (const [appid, data] of apps) {
    const body = Buffer.concat([Buffer.alloc(60), obj({ appinfo: data })]), head = Buffer.alloc(8)
    head.writeUInt32LE(appid); head.writeUInt32LE(body.length, 4)
    parts.push(head, body)
  }
  parts.push(Buffer.alloc(4))
  const header = Buffer.alloc(version >= 29 ? 16 : 8)
  header.writeUInt32LE(version === 29 ? 0x07564429 : 0x07564428)
  const entries = Buffer.concat(parts)
  if (version < 29) return Buffer.concat([header, entries])
  header.writeBigInt64LE(BigInt(16 + entries.length), 8)
  const table = Buffer.concat([(() => { const b = Buffer.alloc(4); b.writeUInt32LE(strings.length); return b })(), ...strings.map(t => Buffer.from(t + '\0'))])
  return Buffer.concat([header, entries, table])
}

test('saca nombre y tipo de appinfo.vdf (v28 y v29)', () => {
  const apps = [[10, { appid: 10, common: { name: 'Alfa', type: 'Game', associations: { 0: { type: 'developer', name: 'Estudio' }, 1: { type: 'publisher', name: 'Editora' } } } }], [20, { common: { name: 'Banda sonora', type: 'Music' } }], [30, { extended: {} }]]
  for (const version of [28, 29]) {
    const info = parseAppInfo(appinfo(version, apps))
    assert.deepEqual(info.get('10'), { name: 'Alfa', type: 'game', developers: ['Estudio'], publishers: ['Editora'] })
    assert.deepEqual(info.get('20'), { name: 'Banda sonora', type: 'music', developers: [], publishers: [] })
    assert.equal(info.has('30'), false)
    assert.deepEqual([...parseAppInfo(appinfo(version, apps), new Set(['20'])).keys()], ['20'])
  }
  assert.throws(() => parseAppInfo(Buffer.alloc(16)), /desconocido/)
})
