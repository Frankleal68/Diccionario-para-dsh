/* dsh-diccionario - mitad navegador.
 * Se carga con el modulo del cliente de DSH (__ModuleLoader__), sin bundler.
 * Registra una franja en el slot "conversation.input.dock" (lista, justo
 * encima de la caja de escritura) que lee el borrador con useInput y aplica
 * las correcciones con inputActions.setDraft().
 */
window.__ModuleLoader__.load({
  id: 'dsh-diccionario',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement

    var ID = 'dsh-diccionario'
    var API = '/diccionario/api'
    var REINTENTO_MS = 2500

    var CSS = [
      '.dshdic-franja{margin:0 0 6px;padding:5px 9px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.32));border-radius:8px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.07));font-size:12px;line-height:1.6;color:var(--dsw-alias-text-secondary,inherit)}',
      '.dshdic-cabecera{display:flex;align-items:center;gap:8px;font-weight:600}',
      '.dshdic-lista{display:flex;flex-direction:column;gap:3px;margin-top:3px}',
      '.dshdic-fila{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.dshdic-palabra{font-family:ui-monospace,Consolas,monospace;text-decoration:underline;text-decoration-style:wavy;text-decoration-color:var(--dsw-alias-text-danger,#e06c75);text-underline-offset:2px}',
      '.dshdic-palabra.dshdic-acento{text-decoration-color:var(--dsw-alias-text-warning,#d8a657)}',
      '.dshdic-sug{font:inherit;padding:0 7px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.4));border-radius:6px;background:transparent;color:var(--dsw-alias-text-primary,inherit);cursor:pointer}',
      '.dshdic-sug:hover{border-color:var(--dsw-alias-text-primary,currentColor)}',
      '.dshdic-mini{font:inherit;padding:0 5px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-text-secondary,inherit);cursor:pointer;opacity:.75}',
      '.dshdic-mini:hover{opacity:1;text-decoration:underline}',
      '.dshdic-nota{opacity:.7;font-style:italic}',
    ].join('')

    function inyectarEstilos() {
      try {
        if (document.getElementById('dshdic-estilos')) return
        var s = document.createElement('style')
        s.id = 'dshdic-estilos'
        s.textContent = CSS
        document.head.appendChild(s)
      } catch (e) { }
    }

    function pedir(ruta, datos) {
      var opciones = { headers: { 'content-type': 'application/json' } }
      if (datos !== undefined) { opciones.method = 'POST'; opciones.body = JSON.stringify(datos) }
      return fetch(API + ruta, opciones).then(function (r) { return r.ok ? r.json() : null })
    }

    function Franja(props) {
      var useInput = props ? props.useInput : null
      var inputActions = props ? props.inputActions : null
      var borrador = (typeof useInput === 'function') ? useInput(function (s) { return (s && s.draft) || '' }) : ''

      var eDudas = React.useState([]); var dudas = eDudas[0]; var setDudas = eDudas[1]
      var eAbierto = React.useState(true); var abierto = eAbierto[0]; var setAbierto = eAbierto[1]
      var eAviso = React.useState(''); var aviso = eAviso[0]; var setAviso = eAviso[1]
      var eListo = React.useState(null); var listo = eListo[0]; var setListo = eListo[1]
      var eRefresco = React.useState(0); var refresco = eRefresco[0]; var setRefresco = eRefresco[1]
      var vivo = React.useRef(0)
      var temporizador = React.useRef(null)

      function reintentarMasTarde() {
        if (temporizador.current) clearTimeout(temporizador.current)
        temporizador.current = setTimeout(function () {
          temporizador.current = null
          setRefresco(function (n) { return n + 1 })
        }, REINTENTO_MS)
      }

      React.useEffect(function () {
        return function () { if (temporizador.current) clearTimeout(temporizador.current) }
      }, [])

      React.useEffect(function () {
        var mio = ++vivo.current
        pedir('/estado').then(function (d) {
          if (mio !== vivo.current || !d) return
          var ok = d.listo === true
          setListo(ok)
          if (!ok) { setAviso('preparando el diccionario...'); reintentarMasTarde() }
          else { setAviso('') }
        }).catch(function () { })
      }, [refresco])

      React.useEffect(function () {
        if (!borrador || !borrador.trim()) { setDudas([]); return }
        var mio = ++vivo.current
        var t = setTimeout(function () {
          pedir('/revisar', { texto: borrador }).then(function (d) {
            if (mio !== vivo.current) return
            if (!d) { setAviso('no pude consultar el diccionario (el plugin host no responde)'); return }
            if (d.listo === false) {
              setListo(false)
              setAviso('preparando el diccionario: la primera vez tarda unos segundos...')
              reintentarMasTarde()
              return
            }
            setListo(true)
            setDudas(d.dudas || [])
            setAviso('')
          }).catch(function (e) {
            if (mio === vivo.current) setAviso('error: ' + String((e && e.message) || e))
          })
        }, 450)
        return function () { clearTimeout(t) }
      }, [borrador, refresco])

      function quitarDeLaLista(palabra) {
        setDudas(function (prev) {
          return prev.filter(function (d) { return d.palabra !== palabra })
        })
      }
      function aprender(palabra) {
        pedir('/aprender', { palabra: palabra }).catch(function () { })
        quitarDeLaLista(palabra)
      }
      function ignorar(palabra) {
        pedir('/ignorar', { palabra: palabra }).catch(function () { })
        quitarDeLaLista(palabra)
      }
      function recargar() {
        pedir('/recargar', {}).then(function (d) {
          setAviso('diccionario recargado')
          reintentarMasTarde()
        }).catch(function () { setAviso('no pude recargar el diccionario') })
      }
      function aplicar(duda, sugerencia) {
        if (!inputActions || typeof inputActions.setDraft !== 'function') return
        var texto = String(borrador || '')
        inputActions.setDraft(texto.slice(0, duda.desde) + sugerencia + texto.slice(duda.hasta))
      }

      if (listo === false) {
        return h('div', { className: 'dshdic-franja' },
          h('span', { className: 'dshdic-nota' }, aviso || 'preparando el diccionario...')
        )
      }
      if (!dudas.length && !aviso) return null

      var filas = dudas.map(function (d, i) {
        var botones = (d.sugerencias || []).map(function (s, j) {
          return h('button', {
            key: 's' + j,
            className: 'dshdic-sug',
            title: 'Sustituir por ' + s,
            onClick: function () { aplicar(d, s) },
          }, s)
        })
        var extras = [
          h('button', { key: 'a', className: 'dshdic-mini', title: 'Anadir al diccionario', onClick: function () { aprender(d.palabra) } }, '+ diccionario'),
          h('button', { key: 'i', className: 'dshdic-mini', title: 'No volver a marcarla', onClick: function () { ignorar(d.palabra) } }, 'ignorar'),
        ]
        var medio = botones.length
          ? [h('span', { key: 'f', className: 'dshdic-nota' }, '->')].concat(botones)
          : [h('span', { key: 'n', className: 'dshdic-nota' }, 'sin sugerencias')]
        return h.apply(null, ['div', { key: 'd' + i, className: 'dshdic-fila' },
          h('span', { className: 'dshdic-palabra' + (d.tipo === 'acento' ? ' dshdic-acento' : '') }, d.palabra)
        ].concat(medio, extras))
      })

      return h('div', { className: 'dshdic-franja' },
        h('div', { className: 'dshdic-cabecera' },
          h('span', null, 'Ortografia: ' + dudas.length + (dudas.length === 1 ? ' duda' : ' dudas')),
          h('button', { className: 'dshdic-mini', onClick: function () { setAbierto(!abierto) } }, abierto ? 'ocultar' : 'ver'),
          h('button', { className: 'dshdic-mini', onClick: recargar, title: 'Releer diccionario.txt y aprendidas.txt' }, 'recargar')
        ),
        abierto ? h('div', { className: 'dshdic-lista' }, filas) : null,
        aviso ? h('div', { className: 'dshdic-nota' }, aviso) : null
      )
    }

    function apply(ctx) {
      inyectarEstilos()
      ctx.effect(function () {
        return ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({
            name: 'conversation.input.dock',
            id: ID,
            order: 40,
            inject: function () { return {} },
          }, Franja)
        })
      }, 'dsh-diccionario: franja de ortografia')
    }

    module.exports = {
      name: ID,
      inject: ['slots'],
      __internals: { Franja: Franja },
      apply: apply,
    }
    return module.exports
  },
})
