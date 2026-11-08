const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { listSteamGames, launchSteamGame, parseVdf } = require('./steam.cjs')

test('interpreta bibliotecas VDF con rutas escapadas y comentarios', () => {
  const result = parseVdf('"libraryfolders" { // comentario\n "0" { "path" "C:\\\\Steam Library" } "1" "D:\\\\Games" }')
  assert.equal(result.libraryfolders['0'].path, 'C:\\Steam Library')
  assert.equal(result.libraryfolders['1'], 'D:\\Games')
  assert.throws(() => parseVdf('"x" { "name" "value"'), /incompleto/)
})

test('encuentra instalaciones en varias bibliotecas y usa portada local', async () => {
  const root = path.resolve(os.tmpdir()), directory = await fs.mkdtemp(path.join(root, 'lectorobot-steam-test-'))
  const resolved = path.resolve(directory)
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith('lectorobot-steam-test-')) throw new Error('Directorio temporal inválido.')
  try {
    const steam = path.join(resolved, 'Steam'), library = path.join(resolved, 'Library')
    await fs.mkdir(path.join(steam, 'steamapps', 'common', 'first'), { recursive: true })
    await fs.mkdir(path.join(library, 'steamapps', 'common', 'second'), { recursive: true })
    await fs.mkdir(path.join(steam, 'appcache', 'librarycache', '2'), { recursive: true })
    const escape = value => value.replace(/\\/g, '\\\\')
    await fs.writeFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "0" { "path" "${escape(steam)}" } "1" { "path" "${escape(library)}" } }`)
    const manifest = (id, name, dir, flags = 4) => `"AppState" { "appid" "${id}" "name" "${name}" "installdir" "${dir}" "StateFlags" "${flags}" }`
    await fs.writeFile(path.join(steam, 'steamapps', 'appmanifest_1.acf'), manifest(1, 'Zeta', 'first'))
    await fs.writeFile(path.join(library, 'steamapps', 'appmanifest_2.acf'), manifest(2, 'Alfa', 'second'))
    await fs.writeFile(path.join(library, 'steamapps', 'appmanifest_3.acf'), manifest(3, 'Incompleto', 'second', 2))
    await fs.writeFile(path.join(library, 'steamapps', 'appmanifest_4.acf'), manifest(4, 'Falta', 'missing'))
    const cover = path.join(steam, 'appcache', 'librarycache', '2', 'library_600x900.jpg')
    await fs.writeFile(cover, 'cover')
    assert.deepEqual(await listSteamGames({ steamPaths: [steam] }), [
      { id: '2', name: 'Alfa', coverPath: cover }, { id: '1', name: 'Zeta', coverPath: null }
    ])
  } finally { await fs.rm(resolved, { recursive: true, force: true }) }
})

test('lanza solo identificadores numéricos válidos con el protocolo de Steam', async () => {
  const opened = []
  await launchSteamGame('431960', async url => opened.push(url))
  assert.deepEqual(opened, ['steam://run/431960'])
  for (const invalid of ['0', '-1', '1/../../', '1?arg=x', '4294967296', 1]) {
    await assert.rejects(launchSteamGame(invalid, async () => {}), /inválido/)
  }
})
