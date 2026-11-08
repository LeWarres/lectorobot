const path = require('node:path')
const extensions = Object.freeze(['cbz', 'cbr', 'pdf'])
function supportedFile(file) {
  return typeof file === 'string' && extensions.includes(path.extname(file).slice(1).toLowerCase())
}
module.exports = { extensions, supportedFile }
