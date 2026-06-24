/* ============================================================================
 * UVG Bot - Service worker (segundo plano)
 * Usa chrome.debugger (CDP) para enviar clics REALES (isTrusted=true) que la
 * página sí acepta. El content script le manda coordenadas y este los clickea.
 * ==========================================================================*/

const attached = new Set();

function attach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err && !/already attached/i.test(err.message || "")) {
        return reject(new Error(err.message));
      }
      attached.add(tabId);
      resolve();
    });
  });
}

function detach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      void chrome.runtime.lastError; // ignorar si ya estaba suelto
      attached.delete(tabId);
      resolve();
    });
  });
}

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  await attach(tabId);
}

function sendCmd(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(res);
    });
  });
}

async function trustedClick(tabId, x, y) {
  await ensureAttached(tabId);
  // Mover, presionar y soltar => click confiable en (x, y) del viewport.
  await sendCmd(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await sendCmd(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
  });
  await sendCmd(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    sendResponse({ ok: false, error: "sin tabId" });
    return false;
  }
  (async () => {
    try {
      if (msg.type === "attach") {
        await ensureAttached(tabId);
        sendResponse({ ok: true });
      } else if (msg.type === "trustedClick") {
        await trustedClick(tabId, msg.x, msg.y);
        sendResponse({ ok: true });
      } else if (msg.type === "detach") {
        await detach(tabId);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "tipo desconocido" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // respuesta asíncrona
});

// Si el usuario cierra el infobar o se cierra la pestaña, limpiar el estado.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attached.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));
