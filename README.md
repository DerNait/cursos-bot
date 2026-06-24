# 🤖 UVG Bot — Cambio automático de sección

Extensión de Chrome que vigila la sección de un docente en **Asignación de cursos UVG**
(`asignaciones.uvg.edu.gt`) y se cambia **automáticamente** en cuanto se libera un cupo.

---

## 📦 Instalación

1. Abre Chrome (o Edge / Opera / Brave) y entra a `chrome://extensions`.
2. Activa el **Modo desarrollador** (interruptor arriba a la derecha).
3. Click en **Cargar descomprimida** (*Load unpacked*).
4. Selecciona la carpeta **`cursos-bot`** (esta carpeta, la que contiene `manifest.json`).
5. Listo: aparece la extensión instalada.

---

## ▶️ Uso

1. Entra a `https://asignaciones.uvg.edu.gt/home` e **inicia sesión**.
2. Verás un panel flotante arriba a la derecha: **🤖 BOT CAMBIO DE SECCIÓN**.
3. Pulsa **🔴 BOT APAGADO (encender)**. La página se recargará y el bot empezará a vigilar.
4. **Deja la pestaña abierta.** Cada 5 segundos hará:
   - Recargar → click en **ASIGNACIÓN** → abrir **DATA SCIENCE** → revisar la fila de Marroquín.
5. En cuanto haya cupo, el bot solo hace **Cambiarse → OK → Asignarse** y te muestra un
   **pop-up de éxito** (con un beep). El bot se **apaga solo** al terminar.
6. Para detenerlo manualmente, pulsa **🟢 BOT ENCENDIDO (apagar)**.

> El estado (encendido/apagado) sobrevive a las recargas. Si la sesión se cierra por
> inactividad, vuelve a iniciar sesión y enciende el bot de nuevo.

---

## ⚙️ Ajustes

Edita la sección `CONFIG` al inicio de **`content.js`** y recarga la extensión en
`chrome://extensions` (botón de recargar ↻):

| Opción | Qué hace | Por defecto |
|---|---|---|
| `COURSE_TEXT` | Texto del curso/acordeón a abrir | `"DATA SCIENCE"` |
| `DOCENTE_TEXT` | Docente objetivo (escríbelo **sin tildes**; el match las ignora) | `"APELLIDOS, NOMBRES"` |
| `POLL_MS` | Cada cuántos milisegundos recargar y revisar | `5000` (5 s) |
| `DRY_RUN` | `true` = detecta y avisa, pero **no** hace el cambio (para probar) | `false` |

---

## 🧪 Probar sin riesgo (recomendado antes de usarlo en serio)

Como la sección real de Marroquín está en 0 cupos, puedes verificar que el bot encuentra
el curso, la fila y el botón usando una sección que **sí** tenga cupo, sin asignarte:

1. En `CONFIG` pon:
   - `DRY_RUN: true`
   - `DOCENTE_TEXT: "APELLIDOS, NOMBRE"` (esa sección tiene cupos)
2. Recarga la extensión y enciende el bot.
3. Debe abrir DATA SCIENCE, **resaltar en naranja** la fila del docente de prueba y mostrar un
   pop-up de *modo prueba* — **sin** hacer ningún cambio.
4. Cuando confirmes que funciona, **revierte**: `DOCENTE_TEXT` del que deseas y `DRY_RUN: false`.

---

## ❓ Si algo no funciona

- Abre las **DevTools** (F12) → pestaña **Console**: el bot imprime cada paso con `[UVGBot]`.
- Si los textos de los botones en la página fueran distintos a los esperados
  (`Cambiarse`, `OK`, `Asignarse`, `ASIGNACIÓN`), avísame y ajustamos los selectores.
- El bot busca todo por **texto visible** (no por IDs), así que es tolerante a cambios de la página.

---

## 📁 Archivos

```
cursos-bot/
├── manifest.json   # Configuración de la extensión (Manifest V3)
├── background.js   # Service worker: hace los clics REALES vía chrome.debugger (CDP)
├── content.js      # Lógica del bot + panel flotante
├── styles.css      # Estilos del panel y el pop-up
└── README.md       # Este archivo
```

## ⚠️ Importante: clics "confiables" (barra amarilla)

La página de UVG **ignora los clics hechos por script** (solo acepta clics reales del
ratón). Por eso el bot usa la API `chrome.debugger` para enviar clics **confiables**.

Esto hace que, mientras el bot esté **encendido**, Chrome muestre una **barra amarilla**
arriba que dice *"…está depurando este navegador"*. **Es normal y necesario.** No la cierres
mientras el bot trabaja; cuando el bot se apaga (manualmente o al terminar), la barra
desaparece sola. Por esto el `manifest.json` pide el permiso `debugger`.

### 🚨 CIERRA las DevTools (F12) al usar el bot

`chrome.debugger` **no puede conectarse si tienes las DevTools (la consola F12) abiertas**
en esa pestaña (Chrome solo permite UN depurador a la vez). Si las dejas abiertas, los clics
del bot **no se enviarán**.

- **Usa el bot con las DevTools CERRADAS.**
- Para ver qué está haciendo, **mira el texto del panel flotante** (muestra cada paso y los
  errores). No necesitas la consola.

## 🔊 Anti-ralentización en segundo plano (keep-alive de audio)

Chrome **ralentiza** las pestañas ocultas (revisaría cada ~1 min en vez de cada 5 s). Para
evitarlo, mientras el bot está encendido reproduce un **tono ultrasónico casi inaudible**
(~19000 Hz, muy bajito) que hace que Chrome marque la pestaña como "reproduciendo audio" y
**no la ralentice**. Así puedes minimizar o tapar la ventana y sigue revisando cada 5 s.

- Verás el **ícono de altavoz 🔊** en la pestaña: es señal de que el keep-alive está activo.
- Es inaudible para casi todos. Si llegaras a oír un pitido agudo, baja `KEEPALIVE_GAIN`
  (p.ej. `0.01`) o sube `KEEPALIVE_HZ` en `content.js`.
- Aun así, **no dejes que la PC entre en suspensión** (sleep) ni cierres la laptop.
