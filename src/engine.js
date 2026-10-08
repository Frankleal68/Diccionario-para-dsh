'use strict'

// Motor del corrector: decide QUE se revisa (prosa, no codigo) y clasifica el
// hallazgo. El corrector de verdad (nspell + diccionario Hunspell) se inyecta,
// de modo que todo esto se prueba sin cargar el diccionario.

const EQUIV = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u',
  'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
  'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o',
  'ñ': 'n', 'ç': 'c',
}

const RE_PALABRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-]*/g
const BT = String.fromCharCode(96)
const RE_CERCA = new RegExp(BT + BT + BT + '[\\s\\S]*?(?:' + BT + BT + BT + '|$)|' + BT + '[^' + BT + '\\n]*' + BT, 'g')
const RE_URL = /(?:https?:\/\/|www\.)[^\s)]+/gi
const RE_CORREO = /[\w.+-]+@[\w-]+\.[\w.]+/g
const RE_RUTA = /[A-Za-z]:\\[^\s]*/g

function minusculas(w) { return String(w).toLowerCase() }

function sinAcentos(w) {
  let salida = ''
  for (const c of w) salida += (EQUIV[c] || c)
  return salida
}

function soloAcentos(a, b) { return sinAcentos(String(a).toLowerCase()) === sinAcentos(String(b).toLowerCase()) }

const PARES_ACENTO = [['a', 'á'], ['e', 'é'], ['i', 'í'], ['o', 'ó'], ['u', 'ú'], ['n', 'ñ']]

function formaAlterna(c) {
  for (const par of PARES_ACENTO) {
    if (c === par[0]) return par[1]
    if (c === par[1]) return par[0]
  }
  return null
}

// Combinaciones de tilde/ene de una palabra: reconoce "cancion" -> "canción" y
// "manana" -> "mañana", que es el error mas comun y el que nspell no siempre propone.
function variantesAcento(w) {
  const posiciones = []
  for (let i = 0; i < w.length; i++) if (formaAlterna(w[i])) posiciones.push(i)
  if (posiciones.length === 0 || posiciones.length > 6) return []
  const salida = []
  const total = 1 << posiciones.length
  for (let m = 1; m < total && salida.length < 128; m++) {
    let s = ''
    for (let i = 0; i < w.length; i++) {
      const k = posiciones.indexOf(i)
      s += (k >= 0 && (m & (1 << k))) ? formaAlterna(w[i]) : w[i]
    }
    if (s !== w) salida.push(s)
  }
  return salida
}

function mayusculaInicial(p) { return /^[A-ZÁÉÍÓÚÜÑ]/.test(p) }

// Zonas que no se revisan: bloques de codigo, codigo en linea, URLs, correos y rutas.
function zonasIgnoradas(texto) {
  const zonas = []
  for (const re of [RE_CERCA, RE_URL, RE_CORREO, RE_RUTA]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(texto))) {
      zonas.push([m.index, m.index + m[0].length])
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return zonas
}

function enZona(zonas, i) {
  for (const z of zonas) if (i >= z[0] && i < z[1]) return true
  return false
}

// Descarta lo que no es prosa: codigo, siglas, identificadores, numeros, rutas.
function esCandidata(p) {
  if (p.length < 3) return false
  if (/[0-9_\/\\.@:]/.test(p)) return false
  if (/[a-záéíóúüñ][A-ZÁÉÍÓÚÜÑ]/.test(p)) return false
  if (/^[A-ZÁÉÍÓÚÜÑ]+$/.test(p) && p.length <= 6) return false
  return true
}

// Palabras revisables de un texto, con su posicion exacta.
function tokenizar(texto) {
  const zonas = zonasIgnoradas(texto)
  const salida = []
  RE_PALABRA.lastIndex = 0
  let m
  while ((m = RE_PALABRA.exec(texto))) {
    const palabra = m[0]
    const desde = m.index
    if (enZona(zonas, desde)) continue
    if (!esCandidata(palabra)) continue
    salida.push({ palabra: palabra, desde: desde, hasta: desde + palabra.length })
  }
  return salida
}

const ACENTO = 'acento'
const DESCONOCIDA = 'desconocida'

// Envuelve un corrector con correct()/suggest()/add() (nspell en produccion).
class Corrector {
  constructor(spell, opciones) {
    const o = opciones || {}
    this.spell = spell
    this.ignoradas = new Set((o.ignoradas || []).map(minusculas))
  }

  agregar(palabra) {
    const w = minusculas(String(palabra).trim())
    if (w.length < 2) return
    try { this.spell.add(w) } catch { }
  }

  ignorar(palabra) { this.ignoradas.add(minusculas(String(palabra).trim())) }

  revisar(texto, opciones) {
    const o = opciones || {}
    const maxPalabras = o.maxPalabras || 600
    const maxSugerencias = o.maxSugerencias || 5
    const dudas = []
    const cache = new Map()
    const tokens = tokenizar(texto)
    for (let i = 0; i < tokens.length && i < maxPalabras; i++) {
      const t = tokens[i]
      const w = minusculas(t.palabra)
      if (this.ignoradas.has(w)) continue
      if (cache.has(w)) {
        const guardado = cache.get(w)
        if (guardado) dudas.push({ palabra: t.palabra, desde: t.desde, hasta: t.hasta, tipo: guardado.tipo, sugerencias: guardado.sugerencias })
        continue
      }
      let hallazgo = null
      let correcta = true
      try { correcta = this.spell.correct(t.palabra) } catch { correcta = true }
      if (!correcta) {
        let sugerencias = []
        try { sugerencias = (this.spell.suggest(t.palabra) || []).slice(0, maxSugerencias) } catch { sugerencias = [] }
        // Si al poner bien las tildes/enes la palabra existe, ese es EL arreglo:
        // va el primero aunque nspell no lo haya propuesto.
        const enMinusculas = minusculas(t.palabra)
        let arregloAcento = null
        for (const v of variantesAcento(enMinusculas)) {
          if (this.spell.correct(v)) { arregloAcento = v; break }
        }
        let tipo = DESCONOCIDA
        if (arregloAcento) {
          tipo = ACENTO
          if (mayusculaInicial(t.palabra)) arregloAcento = arregloAcento.charAt(0).toUpperCase() + arregloAcento.slice(1)
          sugerencias = [arregloAcento].concat(sugerencias.filter(function (s) { return minusculas(s) !== minusculas(arregloAcento) }))
          sugerencias = sugerencias.slice(0, maxSugerencias)
        }
        // Una palabra con mayuscula inicial que solo falla porque no esta en el
        // diccionario (nombre propio) no se marca; si es una tilde, si.
        const esNombrePropio = mayusculaInicial(t.palabra) && !arregloAcento
        if (!esNombrePropio) hallazgo = { tipo: tipo, sugerencias: sugerencias }
      }
      cache.set(w, hallazgo)
      if (hallazgo) dudas.push({ palabra: t.palabra, desde: t.desde, hasta: t.hasta, tipo: hallazgo.tipo, sugerencias: hallazgo.sugerencias })
    }
    return dudas
  }
}

module.exports = {
  minusculas: minusculas,
  sinAcentos: sinAcentos,
  soloAcentos: soloAcentos,
  tokenizar: tokenizar,
  esCandidata: esCandidata,
  variantesAcento: variantesAcento,
  zonasIgnoradas: zonasIgnoradas,
  Corrector: Corrector,
  ACENTO: ACENTO,
  DESCONOCIDA: DESCONOCIDA,
}
