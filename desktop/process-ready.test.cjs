const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { waitForReady } = require('./process-ready.cjs')
function child() { const result = new EventEmitter(); result.stdout = new PassThrough(); result.stderr = new PassThrough(); return result }
test('espera el mensaje completo de inicio', async () => {
  const process = child(), ready = waitForReady(process)
  process.stdout.write('REA'); process.stdout.write('DY\n')
  await ready
  assert.equal(process.listenerCount('exit'), 0)
})
test('notifica si el proceso termina antes de estar listo, incluso con código cero', async () => {
  const process = child(), ready = waitForReady(process)
  process.emit('exit', 0)
  await assert.rejects(ready, /antes de iniciarse/)
})
