/* ============================================================================
 * UVG Bot - Cambio automático de sección
 * Vigila la sección de un docente en "Asignación de cursos" y se cambia
 * automáticamente en cuanto aparece cupo.
 *
 * Flujo en cada ciclo (la página se recarga cada POLL_MS):
 *   1. Pantalla inicial -> click en "ASIGNACIÓN"
 *   2. Carga la lista -> abrir el acordeón del curso (DATA SCIENCE)
 *   3. Buscar la fila del docente objetivo
 *   4. Si hay botón "Cambiarse": Cambiarse -> OK -> Asignarse -> aviso de éxito
 *   5. Si no hay cupo: recargar en POLL_MS y volver a intentar
 * ==========================================================================*/
(function () {
  "use strict";

  // ----------------------------- CONFIGURACIÓN -----------------------------
  const CONFIG = {
    COURSE_TEXT:   "DATA SCIENCE",                         // acordeón a abrir
    DOCENTE_TEXT:  "MARROQUIN RODRIGUEZ, ERICK FRANCISCO", // docente objetivo (sin tildes; el match ignora tildes)
    CAMBIARSE_TEXT: "CAMBIARSE",
    ASIGNARSE_TEXT: "ASIGNARSE",
    POLL_MS:       5000,   // cada cuánto recargar para revisar cupos
    DRY_RUN:       false,  // true = detecta y avisa, pero NO hace el cambio (para pruebas)
    // "Keep-alive" de audio: mantiene la pestaña marcada como "reproduciendo
    // audio" para que Chrome NO la ralentice en segundo plano. Tono ultrasónico
    // y bajito = inaudible para ti. Si llegaras a oír un pitido, baja KEEPALIVE_GAIN
    // o sube KEEPALIVE_HZ.
    KEEPALIVE_HZ:   19000, // frecuencia (Hz); ~19000 es inaudible para casi todos
    KEEPALIVE_GAIN: 0.02,  // volumen (0–1); muy bajo, solo para que Chrome lo registre
  };

  const LS = { active: "uvgbot_active", done: "uvgbot_done" };

  // ------------------------------- HELPERS ---------------------------------
  function normalize(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  // ¿El elemento es parte de la UI del propio bot? (panel o pop-up). Hay que
  // ignorarlos en las búsquedas: el panel muestra textos como "DATA SCIENCE".
  function isOurs(el) {
    return !!(el && el.closest && el.closest("#uvgbot-panel, #uvgbot-overlay"));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---- KEEP-ALIVE DE AUDIO (anti-ralentización en segundo plano) ----
  // Chrome no ralentiza las pestañas que están "reproduciendo audio". Emitimos un
  // tono ultrasónico casi en silencio para que la pestaña siga revisando cada 5s
  // aunque esté minimizada o tapada.
  let kaCtx = null;
  let kaOsc = null;
  function startKeepAlive() {
    try {
      if (!kaCtx) {
        kaCtx = new (window.AudioContext || window.webkitAudioContext)();
        kaOsc = kaCtx.createOscillator();
        const g = kaCtx.createGain();
        kaOsc.type = "sine";
        kaOsc.frequency.value = CONFIG.KEEPALIVE_HZ;
        g.gain.value = CONFIG.KEEPALIVE_GAIN;
        kaOsc.connect(g);
        g.connect(kaCtx.destination);
        kaOsc.start();
      }
      if (kaCtx.state === "suspended") kaCtx.resume().catch(() => {});
    } catch (e) {}
  }
  function stopKeepAlive() {
    try { if (kaOsc) { kaOsc.stop(); kaOsc.disconnect(); kaOsc = null; } } catch (e) {}
    try { if (kaCtx) { kaCtx.close(); kaCtx = null; } } catch (e) {}
  }

  // Espera hasta que fn() devuelva un valor "truthy" o se acabe el tiempo.
  function waitFor(fn, { timeout = 10000, interval = 200 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        let v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= timeout) return reject(new Error("timeout"));
        setTimeout(tick, interval);
      })();
    });
  }

  // Elemento más específico (texto más corto) cuyo contenido incluye `text`.
  function findDeepestByText(text, root) {
    const T = normalize(text);
    const scope = root || document;
    let best = null;
    let bestLen = Infinity;
    const els = scope.querySelectorAll("*");
    for (const el of els) {
      // Ignorar la UI del bot y las copias OCULTAS (plantillas Angular de tamaño 0):
      // si tomáramos una copia oculta, visible() siempre daría false.
      if (isOurs(el) || !visible(el)) continue;
      const t = normalize(el.textContent);
      if (t.includes(T) && t.length < bestLen) {
        bestLen = t.length;
        best = el;
      }
    }
    return best;
  }

  // Primer elemento "clickeable" visible cuyo texto coincide.
  function clickableByText(text, { exact = false, root } = {}) {
    const T = normalize(text);
    const scope = root || document;
    const els = scope.querySelectorAll(
      'button, a, [role="button"], input[type="button"], input[type="submit"]'
    );
    for (const el of els) {
      if (!visible(el) || isOurs(el)) continue;
      const t = normalize(el.value ? el.value : el.textContent);
      if (exact ? t === T : t.includes(T)) return el;
    }
    return null;
  }

  function clickEl(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    try { el.focus && el.focus(); } catch (e) {}
    // Secuencia completa de eventos para frameworks (Angular, etc.)
    ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try {
        const Ev = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
    });
    // Click nativo: dispara la acción por defecto (routerLink, submit, etc.)
    try { el.click(); } catch (e) {}
  }

  // Click para elementos SPA (<a href="/home" route="/home">): ejecuta el handler
  // de Angular pero BLOQUEA la navegación por defecto del enlace (que da 403).
  function clickNoNav(el) {
    if (!el) return;
    const blocker = (e) => { e.preventDefault(); };
    document.addEventListener("click", blocker, true);
    try {
      clickEl(el);
    } finally {
      setTimeout(() => document.removeEventListener("click", blocker, true), 100);
    }
  }

  // Encuentra un botón/enlace por texto, subiendo al ancestro clickeable si hace falta.
  function findClickable(text, opts) {
    const el = clickableByText(text, opts);
    if (el) return el;
    // Fallback: el texto puede estar dentro de un <span>/<i> del botón.
    const node = findDeepestByText(text, opts && opts.root);
    if (node) {
      const up = node.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
      if (up && visible(up)) return up;
      if (visible(node)) return node;
    }
    return null;
  }

  // Como hay varios elementos con el mismo texto (p.ej. el ícono pequeño de la
  // barra lateral Y el botón grande), elige el de MAYOR ÁREA visible: el botón real.
  function findBigButton(text, { exact = false, root } = {}) {
    const T = normalize(text);
    const scope = root || document;
    const sel =
      'button, a, [role="button"], input[type="button"], input[type="submit"], ' +
      '[route], [class*="btn"], [class*="button"]';
    let best = null;
    let bestArea = -1;
    for (const el of scope.querySelectorAll(sel)) {
      if (!visible(el) || isOurs(el)) continue;
      const t = normalize(el.value ? el.value : el.textContent);
      const match = exact ? t === T : t.includes(T);
      if (!match) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }

  // -------- CLICS CONFIABLES (vía background.js + chrome.debugger / CDP) --------
  // La página ignora clics de script (isTrusted=false). El background envía
  // clics REALES por coordenadas usando el protocolo de depuración de Chrome.

  // ¿Sigue vivo el contexto de la extensión? (deja de estarlo si recargas la
  // extensión con la página abierta -> "Extension context invalidated").
  function extAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  }

  // Si el contexto murió (extensión actualizada), recargar la página UNA vez
  // para cargar el script nuevo y reconectar.
  let reloadingForDeath = false;
  function handleDeadContext() {
    if (reloadingForDeath) return;
    reloadingForDeath = true;
    setStatus("La extensión se actualizó; recargando la página para reconectar…");
    setTimeout(() => location.reload(), 1000);
  }

  function isDeadError(m) {
    return /context invalidated|receiving end does not exist|message port closed/i.test(m || "");
  }

  function sendBg(msg) {
    return new Promise((resolve) => {
      if (!extAlive()) { resolve({ ok: false, error: "Extension context invalidated", dead: true }); return; }
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const e = chrome.runtime.lastError;
          if (e && isDeadError(e.message)) {
            resolve({ ok: false, error: e.message, dead: true });
          } else {
            resolve(res || { ok: false, error: e ? e.message : "sin respuesta" });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: String(err), dead: isDeadError(String(err)) });
      }
    });
  }

  function attachDebugger() { return sendBg({ type: "attach" }); }
  function detachDebugger() { return sendBg({ type: "detach" }); }

  // Click REAL en el centro del elemento (coordenadas del viewport en px CSS).
  async function trustedClick(el) {
    if (!extAlive()) { handleDeadContext(); return { ok: false, dead: true }; }
    if (!el) return { ok: false, error: "sin elemento" };
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
    await sleep(300);
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return { ok: false, error: "elemento sin tamaño" };
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    // Diagnóstico: ¿qué hay realmente en esas coordenadas? (detecta zoom/escala)
    const hit = document.elementFromPoint(x, y);
    const onTarget = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    console.log("[UVGBot] clic en", Math.round(x), Math.round(y),
      "| sobre:", hit && hit.tagName, "| en objetivo:", onTarget);
    if (!onTarget) {
      setStatus("⚠️ Las coordenadas no caen sobre el botón (¿zoom del navegador ≠ 100%?). Pon el zoom en 100% (Ctrl+0).");
    }

    const res = await sendBg({ type: "trustedClick", x, y });
    if (res && res.dead) { handleDeadContext(); return res; }
    if (!res || !res.ok) {
      const err = res && res.error;
      console.warn("[UVGBot] trustedClick falló:", err);
      setStatus("❌ No se pudo hacer el clic real: " + err + ". ¿Tienes DevTools (F12) abiertas? Ciérralas.");
    }
    await sleep(1000); // esperar 1s a que la página reaccione antes de seguir
    return res;
  }

  // -------------------------------- ESTADO ---------------------------------
  function isActive() { return localStorage.getItem(LS.active) === "true"; }
  function isDone()   { return localStorage.getItem(LS.done) === "true"; }

  let reloadTimer = null;
  function cancelReload() {
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
  }
  function scheduleReload() {
    cancelReload();
    if (!isActive()) return;
    reloadTimer = setTimeout(() => location.reload(), CONFIG.POLL_MS);
  }

  // ----------------------------- UI (panel) --------------------------------
  let statusEl = null;

  function buildPanel() {
    if (document.getElementById("uvgbot-panel")) return;
    const panel = document.createElement("div");
    panel.id = "uvgbot-panel";
    panel.innerHTML =
      '<div class="uvgbot-title">🤖 BOT CAMBIO DE SECCIÓN</div>' +
      '<button id="uvgbot-toggle"></button>' +
      '<div id="uvgbot-status"></div>';
    document.body.appendChild(panel);

    statusEl = panel.querySelector("#uvgbot-status");
    const btn = panel.querySelector("#uvgbot-toggle");
    renderToggle(btn);

    btn.addEventListener("click", () => {
      if (isActive()) {
        // Apagar
        localStorage.setItem(LS.active, "false");
        cancelReload();
        detachDebugger();
        stopKeepAlive();
        renderToggle(btn);
        setStatus("Apagado.");
      } else {
        // Encender: limpiar "done" y arrancar ciclo limpio recargando
        localStorage.setItem(LS.done, "false");
        localStorage.setItem(LS.active, "true");
        startKeepAlive(); // arrancar audio con el gesto del clic (permite autoplay)
        renderToggle(btn);
        setStatus("Activando… recargando.");
        location.reload();
      }
    });
  }

  function renderToggle(btn) {
    if (isActive()) {
      btn.textContent = "🟢 BOT ENCENDIDO (apagar)";
      btn.className = "on";
    } else {
      btn.textContent = "🔴 BOT APAGADO (encender)";
      btn.className = "off";
    }
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log("[UVGBot]", msg);
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      g.gain.value = 0.2;
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 450);
    } catch (e) {}
  }

  function showSuccess() {
    if (document.getElementById("uvgbot-overlay")) return;
    beep();
    const ov = document.createElement("div");
    ov.id = "uvgbot-overlay";
    ov.innerHTML =
      '<div class="uvgbot-card">' +
      '<div class="uvgbot-emoji">✅</div>' +
      "<h2>¡Te asignaste correctamente!</h2>" +
      "<p>Quedaste en la sección de <b>" + CONFIG.DOCENTE_TEXT + "</b> en <b>" + CONFIG.COURSE_TEXT + "</b>. El bot se apagó solo.</p>" +
      '<button id="uvgbot-ok">Entendido</button>' +
      "</div>";
    document.body.appendChild(ov);
    ov.querySelector("#uvgbot-ok").addEventListener("click", () => ov.remove());
  }

  function showInfo(msg) {
    if (document.getElementById("uvgbot-overlay")) return;
    const ov = document.createElement("div");
    ov.id = "uvgbot-overlay";
    ov.innerHTML =
      '<div class="uvgbot-card">' +
      '<div class="uvgbot-emoji">🔎</div>' +
      "<h2>Modo prueba</h2>" +
      "<p>" + msg + "</p>" +
      '<button id="uvgbot-ok">Cerrar</button>' +
      "</div>";
    document.body.appendChild(ov);
    ov.querySelector("#uvgbot-ok").addEventListener("click", () => ov.remove());
  }

  // ------------------------------- LÓGICA ----------------------------------

  // Pantalla inicial -> click "ASIGNACIÓN" -> esperar la lista de cursos.
  async function ensureCourseList() {
    if (findDeepestByText(CONFIG.COURSE_TEXT)) { console.log("[UVGBot] Lista ya visible"); return; }
    // Espera a que aparezca el botón ASIGNACIÓN (o ya la lista).
    await waitFor(
      () => findDeepestByText(CONFIG.COURSE_TEXT) || findBigButton("ASIGNACION"),
      { timeout: 12000 }
    );
    if (findDeepestByText(CONFIG.COURSE_TEXT)) return;

    const go = findBigButton("ASIGNACION");
    console.log("[UVGBot] Botón ASIGNACIÓN (el grande) encontrado:", go);
    if (!go) throw new Error("no encontré el botón ASIGNACIÓN");
    await trustedClick(go);

    // Algunos clicks no navegan a la primera; reintenta el click si tarda.
    try {
      await waitFor(() => findDeepestByText(CONFIG.COURSE_TEXT), { timeout: 6000 });
    } catch (e) {
      console.log("[UVGBot] No navegó; reintento click en ASIGNACIÓN");
      const again = findBigButton("ASIGNACION");
      if (again) await trustedClick(again);
      await waitFor(() => findDeepestByText(CONFIG.COURSE_TEXT), { timeout: 8000 });
    }
    console.log("[UVGBot] Lista de cursos cargada");
  }

  // ¿Está abierto el acordeón? Al expandir aparece el texto fijo "Cualquier duda…"
  // (inmediato), o ya la fila del docente.
  function courseIsOpen() {
    return !!findDeepestByText("CUALQUIER DUDA") ||
           !!findDeepestByText(CONFIG.DOCENTE_TEXT);
  }

  // Abrir el acordeón del curso y esperar a que aparezca la fila del docente.
  async function expandCourse() {
    // Reintenta el clic SOLO mientras siga cerrado (nunca cierra uno ya abierto).
    for (let i = 0; i < 3 && !courseIsOpen(); i++) {
      const header = findDeepestByText(CONFIG.COURSE_TEXT);
      if (!header) throw new Error("curso no encontrado");
      const target = header.closest('a, button, [role="button"]') || header;
      await trustedClick(target);
      try { await waitFor(courseIsOpen, { timeout: 4000 }); } catch (e) {}
    }
    if (!courseIsOpen()) throw new Error("no abrió el acordeón");

    // Abierto: las filas de secciones se cargan del servidor un par de segundos
    // después; esperar SIN volver a hacer clic.
    await waitFor(() => visible(findDeepestByText(CONFIG.DOCENTE_TEXT)), { timeout: 10000 });
  }

  // Devuelve el contenedor de la FILA del docente (acotado a esa sección).
  function getDocenteRow() {
    const node = findDeepestByText(CONFIG.DOCENTE_TEXT);
    if (!node) return null;
    let cur = node;
    for (let i = 0; i < 8 && cur; i++) {
      if (normalize(cur.textContent).includes("DISPONIBLES")) return cur;
      cur = cur.parentElement;
    }
    return node.parentElement;
  }

  // Cambiarse -> OK -> Asignarse
  async function doEnroll(btn) {
    setStatus("¡Cupo encontrado! Cambiándote…");
    await trustedClick(btn);

    setStatus("Confirmando (OK)…");
    const ok = await waitFor(() => findClickable("OK", { exact: true }), { timeout: 8000 });
    await trustedClick(ok);

    setStatus("Esperando pantalla de asignación…");
    const asig = await waitFor(() => findClickable(CONFIG.ASIGNARSE_TEXT), { timeout: 15000 });
    await trustedClick(asig);

    localStorage.setItem(LS.done, "true");
    localStorage.setItem(LS.active, "false");
    cancelReload();
    await detachDebugger();
    stopKeepAlive();

    await sleep(1000);
    setStatus("✅ ¡Asignado!");
    showSuccess();
  }

  async function runCycle() {
    if (!isActive()) return;
    if (!extAlive()) return handleDeadContext();

    // Espera inicial tras recargar, para que la página termine de pintar.
    await sleep(1000);

    // Conectar el depurador (clics confiables) ANTES de medir coordenadas, para
    // que el infobar de Chrome ya esté visible y el layout no se mueva luego.
    setStatus("Conectando clic confiable…");
    const at = await attachDebugger();
    if (at && at.dead) { return handleDeadContext(); }
    if (!at || !at.ok) {
      setStatus("⚠️ No conecté el clic real (" + (at && at.error) + "). Cierra las DevTools (F12) y reintenta.");
      return scheduleReload();
    }
    await sleep(800);

    setStatus("Entrando a la pantalla de asignación…");
    try {
      await ensureCourseList();
    } catch (e) {
      setStatus("No cargó la lista; reintentando…");
      return scheduleReload();
    }

    setStatus("Abriendo " + CONFIG.COURSE_TEXT + "…");
    try {
      await expandCourse();
    } catch (e) {
      setStatus("No encontré el curso; reintentando…");
      return scheduleReload();
    }

    const row = getDocenteRow();
    if (!row) {
      setStatus("No encontré al docente; reintentando…");
      return scheduleReload();
    }

    const btn = clickableByText(CONFIG.CAMBIARSE_TEXT, { root: row, exact: true });
    if (!btn) {
      setStatus("Sin cupo aún. Reviso de nuevo en " + (CONFIG.POLL_MS / 1000) + "s…");
      return scheduleReload();
    }

    // ¡Hay cupo!
    if (CONFIG.DRY_RUN) {
      try { row.style.outline = "3px solid orange"; } catch (e) {}
      localStorage.setItem(LS.active, "false");
      cancelReload();
      await detachDebugger();
      stopKeepAlive();
      setStatus("CUPO DETECTADO (modo prueba). No se hizo el cambio.");
      showInfo("Se detectó cupo en la sección de " + CONFIG.DOCENTE_TEXT + " y se encontró el botón \"Cambiarse\". (DRY_RUN activo: no se hizo ningún cambio.)");
      return;
    }

    try {
      await doEnroll(btn);
    } catch (e) {
      setStatus("Falló el cambio (" + e.message + "); reintentando…");
      return scheduleReload();
    }
  }

  // -------------------------------- INIT -----------------------------------
  function init() {
    buildPanel();

    // Respaldo: si el audio queda suspendido tras una recarga (sin gesto),
    // reanudarlo en cuanto el usuario interactúe con la página.
    ["click", "keydown", "pointerdown"].forEach((ev) =>
      window.addEventListener(ev, () => { if (isActive()) startKeepAlive(); },
        { capture: true, passive: true })
    );

    if (isDone()) {
      setStatus("✅ Ya te asignaste. (Bot apagado)");
      showSuccess();
      return;
    }
    if (isActive()) {
      startKeepAlive(); // mantener la pestaña "audible" => sin ralentización
      runCycle();
    } else {
      setStatus("Apagado. Pulsa el botón para activar.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
