const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { resolveLocale, translate } = require('./i18n.js')

test('elige idioma explícito o detecta idioma del sistema y valida opciones', () => {
  assert.equal(resolveLocale('pt-BR', 'en-US'), 'pt')
  assert.equal(resolveLocale('ja', 'es-MX'), 'ja')
  assert.equal(resolveLocale('auto', 'ja-JP'), 'ja')
  assert.equal(resolveLocale('system', 'en_US'), 'en')
  assert.equal(resolveLocale('unsupported', 'pt-PT'), 'pt')
  assert.equal(resolveLocale(null, 'fr-FR'), 'es')
})

test('traduce y completa plantillas sin alterar el texto original ni inventar claves', () => {
  assert.equal(translate('en', 'Anterior'), 'Previous')
  assert.equal(translate('pt', 'Anterior'), 'Anterior')
  assert.equal(translate('ja', 'Anterior'), '前へ')
  assert.equal(translate('es', 'Mostrando: {name}', { name: 'Manga' }), 'Mostrando: Manga')
  assert.equal(translate('en', 'Mostrando: {name}', { name: 'Manga' }), 'Showing: Manga')
  assert.equal(translate('ja', '¿Qué deseas hacer con «{name}»?', { name: '本' }), '本をどうしますか？')
  assert.equal(translate('en', 'Texto desconocido {name}', { name: '<libro>' }), 'Texto desconocido <libro>')
  assert.equal(translate('en', 'Mostrando: {name}'), 'Showing: {name}')
})

test('exporta la misma API en el navegador sin CommonJS', () => {
  const window = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('./i18n.js'), 'utf8'), { window })
  assert.equal(window.LectorobotI18n.resolveLocale('auto', 'en-US'), 'en')
  assert.equal(window.LectorobotI18n.translate('ja', 'Leer'), '読む')
})

test('todos los textos marcados de la interfaz tienen traducción inglesa', () => {
  const html = fs.readFileSync(require.resolve('./index.html'), 'utf8')
  const keys = [...html.matchAll(/data-i18n(?:-title|-aria-label|-alt|-placeholder)?="([^"]+)"/g)].map(match => match[1])
  const untranslated = [...new Set(keys.filter(key => key !== 'Zoom' && translate('en', key) === key))]
  assert.deepEqual(untranslated, [])
})
