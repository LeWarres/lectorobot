function waitForReady(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => finish(new Error('No respondió el control de interacción.')), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      child.stdout.removeListener('data', onData)
    }
    const finish = error => { cleanup(); if (error) reject(error); else resolve() }
    const onError = error => finish(error)
    const onExit = code => finish(new Error(`El control de interacción terminó antes de iniciarse (${code ?? 'sin código'}).`))
    const onData = data => {
      output += data.toString()
      if (output.includes('READY')) finish()
      else if (output.length > 4096) finish(new Error('Respuesta inválida del control de interacción.'))
    }
    child.once('error', onError)
    child.once('exit', onExit)
    child.stdout.on('data', onData)
    child.stderr.resume()
  })
}
module.exports = { waitForReady }
