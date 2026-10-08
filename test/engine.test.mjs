import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const E = require('../src/engine.js')
const BT = String.fromCharCode(96)

// Corrector falso: diccionario minimo, sin cargar Hunspell.
const BUENAS = ['casa', 'canción', 'perro', 'gato', 'hola', 'mundo', 'póliza', 'certificado', 'la', 'de', 'es', 'grande', 'vino', 'ayer', 'bonita', 'lunes', 'federico', 'mañana']
const SUG = { cancion: ['canción'], casaa: ['casa', 'casas'], poliza: ['paliza', 'póliza'], federicoo: ['federico'], manana: ['canana', 'macana'] }
function falso() {
  return {
    correct: function (w) { return BUENAS.indexOf(String(w).toLowerCase()) >= 0 },
    suggest: function (w) { return SUG[String(w).toLowerCase()] || [] },
    add: function () { },
  }
}
const C = new E.Corrector(falso(), { ignoradas: ['xyz'] })

test('tokeniza palabras con posiciones exactas', () => {
  const t = E.tokenizar('Hola mundo')
  assert.equal(t.length, 2)
  assert.deepEqual(t[0], { palabra: 'Hola', desde: 0, hasta: 4 })
  assert.deepEqual(t[1], { palabra: 'mundo', desde: 5, hasta: 10 })
})

test('ignora bloques de codigo y codigo en linea', () => {
  const texto = 'antes ' + BT + BT + BT + ' const malo = 1 ' + BT + BT + BT + ' medio ' + BT + 'otroMalo()' + BT + ' despues'
  const palabras = E.tokenizar(texto).map(function (t) { return t.palabra })
  assert.ok(palabras.includes('antes'))
  assert.ok(palabras.includes('medio'))
  assert.ok(palabras.includes('despues'))
  assert.ok(!palabras.includes('malo'))
  assert.ok(!palabras.includes('otroMalo'))
  assert.ok(!palabras.includes('const'))
})

test('no se cuelga con texto corriente', () => {
  const t0 = Date.now()
  E.tokenizar('una frase normal sin nada raro')
  assert.ok(Date.now() - t0 < 1000)
})

test('ignora URLs, correos, rutas e identificadores', () => {
  const texto = 'mira const miVariable = 42; visita https://ejemplo.com/algo y escribe a ana@ejemplo.com en C:\\Users\\ana'
  const palabras = E.tokenizar(texto).map(function (t) { return t.palabra })
  assert.ok(palabras.includes('mira'))
  assert.ok(!palabras.includes('miVariable'))
  assert.ok(!palabras.some(function (p) { return p.indexOf('ejemplo') >= 0 }))
  assert.ok(!palabras.includes('Users'))
})

test('no marca palabras correctas', () => {
  assert.deepEqual(C.revisar('hola mundo, la casa de lunes', {}), [])
})

test('la tilde que falta se clasifica como acento', () => {
  const d = C.revisar('la cancion de casa', {})
  assert.equal(d.length, 1)
  assert.equal(d[0].palabra, 'cancion')
  assert.equal(d[0].tipo, E.ACENTO)
  assert.deepEqual(d[0].sugerencias, ['canción'])
  assert.equal(d[0].desde, 3)
})

test('la ene que falta se propone la primera', () => {
  const d = C.revisar('hola manana', {})
  assert.equal(d.length, 1)
  assert.equal(d[0].tipo, E.ACENTO)
  assert.equal(d[0].sugerencias[0], 'mañana')
})

test('el error de tecleo se clasifica como desconocida', () => {
  const d = C.revisar('la casaa es grande', {})
  assert.equal(d.length, 1)
  assert.equal(d[0].tipo, E.DESCONOCIDA)
  assert.ok(d[0].sugerencias.includes('casa'))
})

test('respeta palabras ignoradas', () => {
  assert.deepEqual(C.revisar('xyz', {}), [])
})

test('los nombres propios no se marcan', () => {
  assert.deepEqual(C.revisar('Federico vino ayer', {}), [])
})

test('pero si se les corrige la tilde', () => {
  const d = C.revisar('Cancion bonita', {})
  assert.equal(d.length, 1)
  assert.equal(d[0].tipo, E.ACENTO)
})

test('agregar una palabra la vuelve correcta', () => {
  const c = new E.Corrector(falso(), {})
  assert.equal(c.revisar('zarzamora', {}).length, 1)
  c.agregar('zarzamora')
  // el doble tambien tiene que aprenderla
  c.spell.correct = function (w) { return w === 'zarzamora' ? true : BUENAS.indexOf(w) >= 0 }
  assert.deepEqual(c.revisar('zarzamora', {}), [])
})

test('sinAcentos y soloAcentos', () => {
  assert.equal(E.sinAcentos('canción'), 'cancion')
  assert.ok(E.soloAcentos('Canción', 'cancion'))
  assert.ok(!E.soloAcentos('casa', 'caza'))
})
