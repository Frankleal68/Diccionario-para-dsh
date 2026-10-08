import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const E = require('../src/engine.js')

function terminosTecnicos() {
  const texto = readFileSync(new URL('../datos/tecnicos.txt', import.meta.url), 'utf8')
  return texto.split(String.fromCharCode(10))
    .map(function (s) { return s.replace(String.fromCharCode(13), '').trim() })
    .filter(function (s) { return s.length > 0 && s.charAt(0) !== '#' })
}

// Prueba con el Hunspell de verdad (tarda unos segundos en construirse).
test('corrector real: tildes, sugerencias y palabras agregadas', { timeout: 180000 }, async () => {
  const nspell = require('nspell')
  const diccionario = (await import('dictionary-es')).default
  const spell = nspell(diccionario)
  const c = new E.Corrector(spell, {})

  assert.deepEqual(c.revisar('la casa de lunes esta bien', {}), [])

  const d = c.revisar('la cancion y la poliza del cliente', {})
  assert.deepEqual(d.map(function (x) { return x.palabra }), ['cancion', 'poliza'])
  assert.equal(d[0].tipo, E.ACENTO)
  assert.ok(d[0].sugerencias.includes('canción'))
  assert.ok(d[1].sugerencias.includes('póliza'))

  const ene = c.revisar('nos vemos manana', {})
  assert.equal(ene.length, 1)
  assert.equal(ene[0].tipo, E.ACENTO)
  assert.equal(ene[0].sugerencias[0], 'mañana')

  const typo = c.revisar('el certificdo vencido', {})
  assert.equal(typo.length, 1)
  assert.ok(typo[0].sugerencias.includes('certificado'))

  assert.deepEqual(c.revisar('Federico llamo', {}), [])
  const mayus = c.revisar('Cancion bonita', {})
  assert.equal(mayus.length, 1)
  assert.equal(mayus[0].tipo, E.ACENTO)

  for (const w of terminosTecnicos()) c.agregar(w)

  const BT = String.fromCharCode(96)
  const codigo = 'ejecuta npm run build y mira ' + BT + 'const polizaX = 1' + BT + ' en https://ejemplo.com/poliza'
  assert.deepEqual(c.revisar(codigo, {}), [])
  assert.deepEqual(c.revisar('npm run build', {}), [])

  // Pese a la lista tecnica, una tilde que falta se sigue detectando.
  const falta = c.revisar('la aplicacion no arranca', {})
  assert.equal(falta.length, 1)
  assert.equal(falta[0].palabra, 'aplicacion')
  assert.equal(falta[0].tipo, E.ACENTO)

  assert.equal(c.revisar('plomfario', {}).length, 1)
  c.agregar('plomfario')
  assert.deepEqual(c.revisar('plomfario', {}), [])
})