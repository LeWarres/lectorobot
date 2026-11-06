const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')

function samplePdf() {
  const parts = ['%PDF-1.4\n'], offsets = [0]
  const add = text => { offsets.push(Buffer.byteLength(parts.join(''))); parts.push(`${offsets.length - 1} 0 obj\n${text}\nendobj\n`) }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>')
  const content = ' '.repeat(200000)
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  const start = Buffer.byteLength(parts.join(''))
  parts.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`)
  return Buffer.from(parts.join(''))
}

test('PDF.js abre un PDF mediante rangos sin leerlo completo', async () => {
  const bytes = samplePdf(), calls = []
  const script = fs.readFileSync(require.resolve('./renderer.js'), 'utf8')
  const source = script.slice(script.indexOf('async function loadPdf('), script.indexOf('async function mapLimited('))
  const context = { window: { reader: { pdfRange: async (_id, begin, end) => { calls.push([begin, end]); return bytes.subarray(begin, end) } } }, Uint8Array }
  vm.runInNewContext(source, context)
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
  const doc = await context.loadPdf(pdfjs, { ranged: true, size: bytes.length, mtimeMs: 1 }, 'book')
  try {
    assert.equal(doc.numPages, 1)
    assert.ok(calls.length > 0)
    assert.ok(calls.every(([begin, end]) => end - begin < bytes.length))
    assert.ok(calls.reduce((sum, [begin, end]) => sum + end - begin, 0) < bytes.length)
  } finally { await doc.loadingTask.destroy() }
})
