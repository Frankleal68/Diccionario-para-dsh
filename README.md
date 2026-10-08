# dsh-diccionario

Corrector ortografico en espanol para el campo de escritura del GUI de
**DeepSeek Harness**. Marca las palabras dudosas encima de la caja de escritura y
ofrece sugerencias con un clic, con tu propio diccionario.

## Que hace

- Revisa el borrador mientras escribes (450 ms despues de la ultima tecla).
- Distingue **acento** (falta una tilde o una ene: `cancion`, `manana`) de
  **desconocida** (typo o palabra que no conoce).
- Cada sugerencia es un boton: al pulsarla se sustituye **solo esa palabra**.
- **+ diccionario** la aprende para siempre · **ignorar** no vuelve a marcarla.
- **recargar** relee tus archivos sin reiniciar dsh.
- No revisa codigo: ignora bloques y codigo en linea, URLs, correos, rutas de
  Windows, identificadores en camelCase, siglas cortas y numeros.
- Trae dos listas propias: **273 terminos tecnicos** (npm, commit, plugin...) y
  **252 de regionalismos y jerga** (checar, lonche, chido, jitomate, coaseguro,
  caratula...).

## Requisitos

- DeepSeek Harness instalado (`dsh` en el PATH).
- pnpm disponible (lo usa `dsh plugin`).

## Instalacion

    dsh plugin --profile web add github:Frankleal68/Diccionario-para-dsh

Luego reinicia dsh (por ejemplo, con el Centro de Mando: APAGAR y ENCENDER) para
que el perfil cargue el plugin. La primera vez que escribas, el corrector tarda
unos segundos en construirse (se hace en segundo plano) y la franja avisa
`preparando el diccionario...`.

Si prefieres instalarlo desde una copia local:

    git clone https://github.com/Frankleal68/Diccionario-para-dsh.git
    cd Diccionario-para-dsh
    npm install
    dsh plugin --profile web add link:<ruta-a-la-carpeta>

(`link:` usa la carpeta tal cual, asi que ahi si hacen falta las dependencias
instaladas con `npm install`. Con `github:` pnpm las instala solo.)

## Desinstalar

    dsh plugin --profile web remove dsh-diccionario

## Tu diccionario

Todo vive en `%USERPROFILE%\.dsh\diccionario\`:

| Archivo | Quien lo escribe | Para que |
|---|---|---|
| `diccionario.txt` | tu, a mano | tus palabras: nombres, siglas, jerga. Tras editarlo, pulsa **recargar**. |
| `aprendidas.txt` | el plugin | palabras aceptadas con **+ diccionario**. |
| `ignoradas.txt` | el plugin | palabras descartadas con **ignorar**. |

Las lineas que empiezan por `#` se ignoran.

## Cobertura

Usa el Hunspell espanol estandar: **57.346 lemas** mas reglas de afijos (de ahi
salen conjugaciones y plurales). Medido sobre una lista de 636.598 palabras
espanolas, reconoce el **75%** (62% tal cual + 13% que son tildes que faltan,
que es justo lo que debe avisar). El 25% restante son formas raras o arcaicas.

**No se debe volcar una lista masiva de palabras sin tildes** (tipo
`an-array-of-spanish-words`): al aceptar `cancion` o `poliza` como validas,
el corrector dejaria de avisarte de las tildes, que es su mayor valor.

## Como funciona por dentro

- **Motor** (`src/engine.js`): decide que se revisa (prosa, no codigo),
  clasifica la duda y busca el arreglo de tilde/ene.
- **Host** (`src/index.js`): carga `nspell` + `dictionary-es` en segundo
  plano y sirve la API en `/diccionario/api`.
- **Cliente** (`client/bundle.js`): se registra en el slot
  `conversation.input.dock`, lee el borrador con `useInput` y aplica la
  correccion con `inputActions.setDraft()`. No necesita bundler: usa el
  `__ModuleLoader__` del cliente de DSH.

API: `GET /diccionario/api/estado`, `POST /diccionario/api/revisar`,
`/aprender`, `/ignorar`, `/recargar`.

## Pruebas

    npm test

- `test/engine.test.mjs`: motor con un corrector falso (rapido).
- `test/integracion.test.mjs`: con el Hunspell real (tarda ~6 s).
- `test/host.test.mjs`: la API del host con un contexto falso.

## Licencia

MIT. El diccionario espanol viene de
[dictionary-es](https://www.npmjs.com/package/dictionary-es) (Hunspell es_ES).
