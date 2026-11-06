const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { execFileSync } = require('node:child_process')
const { pages, rar } = require('./archive.cjs')

test('CBZ ordena páginas numéricamente y omite otros archivos', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-reader-test-'))
  try {
    const file = path.join(directory, 'test.cbz')
    const zip = new AdmZip()
    for (const name of ['10.jpg', '2.jpg', '1.png', 'ComicInfo.xml']) zip.addFile(name, Buffer.from(name))
    zip.writeZip(file)
    const entries = await pages(file)
    assert.deepEqual(entries.map(entry => entry.entryName), ['1.png', '2.jpg', '10.jpg'])
    assert.equal((await entries[0].getData()).toString(), '1.png')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('actualiza las páginas si cambia el CBZ', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-cache-test-'))
  try {
    const file = path.join(directory, 'test.cbz')
    const first = new AdmZip(); first.addFile('1.png', Buffer.from('a')); first.writeZip(file)
    assert.deepEqual((await pages(file)).map(entry => entry.entryName), ['1.png'])
    const second = new AdmZip(); second.addFile('2.png', Buffer.from('a')); second.addFile('3.png', Buffer.from('b')); second.writeZip(file)
    assert.deepEqual((await pages(file)).map(entry => entry.entryName), ['2.png', '3.png'])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
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
