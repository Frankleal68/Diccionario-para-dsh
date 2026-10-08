import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

// Cada corrida usa su propia carpeta de datos: no toca el diccionario real.
const CASA = mkdtempSync(join(tmpdir(), 'dsh-dic-'))
process.env.DSH_HOME = CASA

const host = require('../src/index.js')

let manejador = null
const ctx = {
  logger: { info: function () { }, warn: function () { }, error: function () { } },
  connection: { requestRejection: function () { return undefined } },
  effect: function (fn) { fn(); return function () { } },
  webServer: { register: function (def) { manejador = def.handler; return function () { } } },
}
host.apply(ctx)

function peticion(metodo, ruta, cuerpo) {
  const req = new Readable({ read: function () { } })
  req.method = metodo
  req.url = ruta
  if (cuerpo !== undefined) { req.push(JSON.stringify(cuerpo)); req.push(null) }
  return req
}
function respuesta() {
  return {
    codigo: 0, cuerpo: '', headers: null,
    writeHead: function (c, h) { this.codigo = c; this.headers = h },
    end: function (t) { this.cuerpo = t || '' },
  }
}
async function llamar(metodo, ruta, cuerpo) {
  const res = respuesta()
  await manejador(peticion(metodo, ruta, cuerpo), res)
  let datos = null
  try { datos = JSON.parse(res.cuerpo) } catch { }
  return { codigo: res.codigo, datos: datos, bruto: res.cuerpo }
}

test('el host registra el manejador de la API', () => {
  assert.equal(typeof manejador, 'function')
  assert.equal(host.name, 'dsh-diccionario')
})

test('estado responde y crea los ficheros de datos', async () => {
  const r = await llamar('GET', '/diccionario/api/estado')
  assert.equal(r.codigo, 200)
  assert.equal(typeof r.datos.listo, 'boolean')
  assert.ok(existsSync(join(CASA, 'diccionario', 'diccionario.txt')))
  assert.ok(existsSync(join(CASA, 'diccionario', 'aprendidas.txt')))
  assert.ok(existsSync(join(CASA, 'diccionario', 'ignoradas.txt')))
})

test('texto vacio no da dudas', async () => {
  const r = await llamar('POST', '/diccionario/api/revisar', { texto: '' })
  assert.equal(r.codigo, 200)
  if (r.datos.listo) assert.deepEqual(r.datos.dudas, [])
})

test('accion desconocida devuelve 404', async () => {
  const r = await llamar('POST', '/diccionario/api/no-existe', {})
  assert.equal(r.codigo, 404)
})

test('el suplemento aporta regionalismos y jerga', { timeout: 180000 }, async () => {
  const r = await llamar('POST', '/diccionario/api/revisar', { texto: 'checar el coaseguro y la caratula del jitomate' })
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.listo, true)
  const dudosas = r.datos.dudas.map(function (d) { return d.palabra })
  assert.ok(!dudosas.includes('checar'))
  assert.ok(!dudosas.includes('coaseguro'))
  assert.ok(!dudosas.includes('jitomate'))

  // El suplemento no debe silenciar los errores de tilde reales.
  const r2 = await llamar('POST', '/diccionario/api/revisar', { texto: 'la reclamacion del coaseguro' })
  const d2 = r2.datos.dudas.map(function (d) { return d.palabra })
  assert.ok(d2.includes('reclamacion'), 'reclamacion sin tilde debe avisarse')
  assert.ok(!d2.includes('coaseguro'), 'coaseguro es correcta y no debe marcarse')
})

test('aprender guarda la palabra y la acepta', { timeout: 180000 }, async () => {
  const r = await llamar('POST', '/diccionario/api/aprender', { palabra: 'Plomfario' })
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.palabra, 'plomfario')
  const guardadas = readFileSync(join(CASA, 'diccionario', 'aprendidas.txt'), 'utf8')
  assert.ok(guardadas.indexOf('plomfario') >= 0)

  const rev = await llamar('POST', '/diccionario/api/revisar', { texto: 'hola plomfario' })
  assert.equal(rev.codigo, 200)
  assert.equal(rev.datos.listo, true)
  assert.deepEqual(rev.datos.dudas, [])

  const mala = await llamar('POST', '/diccionario/api/revisar', { texto: 'la cancion sonaba' })
  assert.deepEqual(mala.datos.dudas.map(function (d) { return d.palabra }), ['cancion'])
  assert.equal(mala.datos.dudas[0].tipo, 'acento')
  assert.ok(mala.datos.dudas[0].sugerencias.includes('canción'))
})

test('ignorar guarda y deja de marcarla', async () => {
  const r = await llamar('POST', '/diccionario/api/ignorar', { palabra: 'cancion' })
  assert.equal(r.codigo, 200)
  const rev = await llamar('POST', '/diccionario/api/revisar', { texto: 'la cancion sonaba' })
  assert.deepEqual(rev.datos.dudas, [])
})

test('recargar responde con el estado', async () => {
  const r = await llamar('POST', '/diccionario/api/recargar', {})
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.listo, true)
})

test('palabra vacia se rechaza', async () => {
  const r = await llamar('POST', '/diccionario/api/aprender', { palabra: '' })
  assert.equal(r.codigo, 400)
})