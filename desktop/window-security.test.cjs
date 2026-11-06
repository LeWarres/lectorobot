const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { secureWindow } = require('./window-security.cjs')
test('impide abrir ventanas y navegar fuera de la aplicación', () => {
  const webContents = new EventEmitter()
  webContents.setWindowOpenHandler = handler => { webContents.open = handler }
  secureWindow({ webContents })
  assert.equal(webContents.open().action, 'deny')
  for (const name of ['will-navigate', 'will-attach-webview']) {
    let prevented = false
    webContents.emit(name, { preventDefault() { prevented = true } })
    assert.equal(prevented, true)
  }
})
