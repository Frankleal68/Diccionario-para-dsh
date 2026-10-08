'use strict'

// Mitad host del plugin: carga el corrector (nspell + diccionario Hunspell
// espanol) en segundo plano, guarda el diccionario del usuario en disco y
// sirve la API que consume la franja del cliente.

const { mkdirSync, readFileSync, appendFileSync, writeFileSync, existsSync } = require('node:fs')
const { join, dirname } = require('node:path')
const os = require('node:os')
const { Corrector, minusculas } = require('./engine.js')

const NOMBRE = 'dsh-diccionario'
const RUTA_API = '/diccionario/api'

const PLANTILLA = [
  '# Tu diccionario del Centro de Mando.',
  '# Una palabra por linea. Las lineas que empiezan por # se ignoran.',
  '# Tras editarlo, pulsa "recargar" en la franja (o reinicia dsh).',
  '',
].join('\n')

// Listas que vienen con el plugin: terminos tecnicos y suplemento (regionalismos
// y jerga que el Hunspell estandar no trae).
const ARCHIVOS_EXTRA = ['tecnicos.txt', 'suplemento.txt']

function archivosExtra() {
  return ARCHIVOS_EXTRA.map(function (f) { return join(dirname(__dirname), 'datos', f) })
}

function leerExtras() {
  const salida = []
  for (const f of archivosExtra()) for (const w of leerLineas(f)) salida.push(w)
  return salida
}

function carpetaDatos() {
  const casa = process.env.DSH_HOME || join(os.homedir(), '.dsh')
  return join(casa, 'diccionario')
}

function leerLineas(archivo) {
  try {
    return readFileSync(archivo, 'utf8')
      .split(/\r?\n/)
      .map(function (s) { return s.trim() })
      .filter(function (s) { return s && s.charAt(0) !== '#' })
  } catch { return [] }
}

function enviarJson(res, codigo, datos) {
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(datos))
}

function leerCuerpo(req, limite) {
  return new Promise(function (resolve, reject) {
    let n = 0
    const trozos = []
    req.on('data', function (c) {
      n += c.length
      if (n > (limite || 400000)) { reject(new Error('cuerpo demasiado grande')); req.destroy(); return }
      trozos.push(c)
    })
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}')) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

module.exports = {
  name: NOMBRE,
  inject: ['webServer', 'connection'],

  apply(ctx) {
    const dir = carpetaDatos()
    try { mkdirSync(dir, { recursive: true }) } catch { }
    const fUsuario = join(dir, 'diccionario.txt')
    const fAprendidas = join(dir, 'aprendidas.txt')
    const fIgnoradas = join(dir, 'ignoradas.txt')
    try { if (!existsSync(fUsuario)) writeFileSync(fUsuario, PLANTILLA, 'utf8') } catch { }
    try { if (!existsSync(fAprendidas)) writeFileSync(fAprendidas, '', 'utf8') } catch { }
    try { if (!existsSync(fIgnoradas)) writeFileSync(fIgnoradas, '', 'utf8') } catch { }

    let corrector = null
    let cargando = false
    let error = ''
    let msCarga = 0

    // Carga perezosa: construir el Hunspell cuesta ~6 s, asi que el arranque de
    // dsh no se bloquea; se calienta solo, en segundo plano.
    async function cargar() {
      if (corrector) return corrector
      if (cargando) return null
      cargando = true
      const t0 = Date.now()
      try {
        const nspell = require('nspell')
        const modulo = await import('dictionary-es')
        const diccionario = modulo && modulo.default ? modulo.default : modulo
        const spell = nspell(diccionario)
        const ignoradas = leerLineas(fIgnoradas)
        for (const w of leerExtras()) { try { spell.add(minusculas(w)) } catch { } }
        for (const w of leerLineas(fUsuario)) { try { spell.add(minusculas(w)) } catch { } }
        for (const w of leerLineas(fAprendidas)) { try { spell.add(minusculas(w)) } catch { } }
        corrector = new Corrector(spell, { ignoradas: ignoradas })
        error = ''
      } catch (e) {
        error = String((e && e.message) || e)
        corrector = null
      }
      msCarga = Date.now() - t0
      cargando = false
      if (corrector && ctx.logger && typeof ctx.logger.info === 'function') {
        ctx.logger.info('dsh-diccionario: corrector listo en ' + msCarga + ' ms')
      }
      return corrector
    }

    function estado() {
      return {
        listo: !!corrector,
        cargando: cargando,
        error: error,
        msCarga: msCarga,
        usuario: leerLineas(fUsuario).length,
        aprendidas: leerLineas(fAprendidas).length,
        ignoradas: leerLineas(fIgnoradas).length,
        carpeta: dir,
        extras: leerExtras().length,
        archivos: {
          extras: archivosExtra(),
          diccionario: fUsuario,
          aprendidas: fAprendidas,
          ignoradas: fIgnoradas,
        },
      }
    }

    // Calienta el corrector poco despues de arrancar, sin bloquear el boot.
    setTimeout(function () { cargar().catch(function () { }) }, 2500)

    ctx.effect(function () {
      return ctx.webServer.register({
        kind: 'prefix',
        path: RUTA_API,
        handler: async function (req, res) {
          try {
            if (ctx.connection && typeof ctx.connection.requestRejection === 'function') {
              const rechazo = ctx.connection.requestRejection(req)
              if (rechazo !== undefined) { res.writeHead(rechazo); res.end(); return }
            }
          } catch { }
          try {
            const url = new URL(req.url || '/', 'http://dsh.local')
            const partes = url.pathname.replace(/\/+$/, '').split('/')
            const accion = partes[partes.length - 1]

            if (req.method === 'GET' && (accion === 'estado' || accion === 'api')) {
              enviarJson(res, 200, estado())
              return
            }

            if (req.method === 'POST' && accion === 'revisar') {
              const cuerpo = await leerCuerpo(req)
              const texto = String(cuerpo.texto || '')
              const c = corrector || await cargar()
              if (!c) { enviarJson(res, 200, { listo: false, cargando: cargando, error: error, dudas: [] }); return }
              const dudas = c.revisar(texto, { maxPalabras: 600, maxSugerencias: 5 })
              enviarJson(res, 200, { listo: true, dudas: dudas })
              return
            }

            if (req.method === 'POST' && accion === 'aprender') {
              const cuerpo = await leerCuerpo(req)
              const palabra = minusculas(String(cuerpo.palabra || '')).trim()
              if (palabra.length < 2) { enviarJson(res, 400, { error: 'palabra vacia' }); return }
              appendFileSync(fAprendidas, palabra + '\n', 'utf8')
              if (corrector) corrector.agregar(palabra)
              enviarJson(res, 200, { ok: true, palabra: palabra })
              return
            }

            if (req.method === 'POST' && accion === 'ignorar') {
              const cuerpo = await leerCuerpo(req)
              const palabra = minusculas(String(cuerpo.palabra || '')).trim()
              if (palabra.length < 2) { enviarJson(res, 400, { error: 'palabra vacia' }); return }
              appendFileSync(fIgnoradas, palabra + '\n', 'utf8')
              if (corrector) corrector.ignorar(palabra)
              enviarJson(res, 200, { ok: true, palabra: palabra })
              return
            }

            if (req.method === 'POST' && accion === 'recargar') {
              // Volver a leer los archivos del usuario es barato (add, no rebuild).
              if (corrector) {
                for (const w of leerLineas(fUsuario)) corrector.agregar(w)
                for (const w of leerLineas(fAprendidas)) corrector.agregar(w)
                for (const w of leerLineas(fIgnoradas)) corrector.ignorar(w)
              } else {
                cargar().catch(function () { })
              }
              enviarJson(res, 200, estado())
              return
            }

            enviarJson(res, 404, { error: 'no encontrado: ' + accion })
          } catch (e) {
            enviarJson(res, 400, { error: String((e && e.message) || e) })
          }
        },
      })
    }, 'dsh-diccionario: api del diccionario')
  },

  __internals: {
    carpetaDatos: carpetaDatos,
    leerLineas: leerLineas,
    Corrector: Corrector,
  },
}
