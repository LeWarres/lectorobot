const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { execFileSync } = require('node:child_process')
const { pages, rar } = require('./archive.cjs')

test('CBZ ordena páginas numéricamente y omite otros archivos', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-reader-test-'))
  try {
    const file = path.join(directory, 'test.cbz')
    const zip = new AdmZip()
    for (const name of ['10.jpg', '2.jpg', '1.png', 'ComicInfo.xml']) zip.addFile(name, Buffer.from(name))
    zip.writeZip(file)
    assert.deepEqual(pages(file).map(entry => entry.entryName), ['1.png', '2.jpg', '10.jpg'])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

const rarTool = process.env.RAR_EXE
test('CBR enumera y extrae páginas', { skip: !rarTool || !fs.existsSync(rarTool) }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-rar-test-'))
  try {
    fs.writeFileSync(path.join(directory, '1.png'), 'pagina uno')
    execFileSync(rarTool, ['a', '-idq', 'test.cbr', '1.png'], { cwd: directory, windowsHide: true })
    const file = path.join(directory, 'test.cbr')
    const entries = await rar(file)
    assert.deepEqual(entries.map(entry => entry.name), ['1.png'])
    assert.equal(Buffer.from(await rar(file, entries[0].name)).toString(), 'pagina uno')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
