const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('el arrastre con zoom desplaza el libro y no pasa la página', () => {
  const source = fs.readFileSync(require.resolve('./book3d.js'), 'utf8')
  const code = source.slice(source.indexOf('function enableBookPan('), source.indexOf('export function createBook3D('))
  const context = {}; vm.runInNewContext(code, context)
  const handlers = {}, canvas = { style: {}, addEventListener: (name, handler) => { handlers[name] = handler }, setPointerCapture() {} }
  const state = { s: 2, x: 10, y: 20 }, updates = []
  const cursor = context.enableBookPan(canvas, () => state, (x, y) => updates.push([x, y]))
  cursor(); assert.equal(canvas.style.cursor, 'grab')
  const event = { pointerId: 1, button: 0, clientX: 100, clientY: 100, preventDefault() {} }
  handlers.pointerdown(event)
  assert.equal(canvas.style.cursor, 'grabbing')
  handlers.pointermove({ ...event, clientX: 130, clientY: 85 })
  assert.deepEqual(updates, [[40, 5]])
  handlers.pointerup(event)
  let stopped = false
  handlers.click({ preventDefault() {}, stopPropagation() { stopped = true } })
  assert.equal(stopped, true)
  assert.equal(canvas.style.cursor, 'grab')
  state.s = 1; cursor()
  assert.equal(canvas.style.cursor, '')
})
