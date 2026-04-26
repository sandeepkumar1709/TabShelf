try {
  importScripts("gemini.js");
} catch (e) {
  console.error("[TabCache] failed to load gemini.js:", e);
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details?.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  }
});

const AI_SETTINGS_KEY = "tabcache:ai";

async function loadAiSettings() {
  const v = await storageGet(AI_SETTINGS_KEY);
  if (!v || typeof v !== "object") return { apiKey: "", enabled: false, consentAt: 0 };
  return {
    apiKey: typeof v.apiKey === "string" ? v.apiKey : "",
    enabled: !!v.enabled,
    consentAt: Number(v.consentAt) || 0,
  };
}

async function saveAiSettings(next) {
  await storageSet({ [AI_SETTINGS_KEY]: next });
}

async function requireAi() {
  const s = await loadAiSettings();
  if (!s.enabled) throw new Error("AI disabled in settings");
  if (!s.apiKey) throw new Error("No API key set");
  if (!s.consentAt) throw new Error("Consent required");
  return s;
}

function isRestrictedUrl(url) {
  if (!url || typeof url !== "string") return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:")
  );
}

function queryTabsForScope(scope) {
  return new Promise((resolve, reject) => {
    let queryInfo = {};
    if (scope === "currentTab") queryInfo = { active: true, currentWindow: true };
    else if (scope === "currentWindow") queryInfo = { currentWindow: true };
    else if (scope === "allWindows") queryInfo = {};
    else return reject(new Error(`Unknown scope: ${scope}`));

    chrome.tabs.query(queryInfo, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tabs || []);
    });
  });
}

function removeTabs(tabIds) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabIds, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

const SESSIONS_KEY = "tabcache:sessions";
const MAX_SESSIONS = 50;

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (items) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(items?.[key]);
    });
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function loadSessions() {
  const v = await storageGet(SESSIONS_KEY);
  return Array.isArray(v) ? v : [];
}

async function saveSessions(sessions) {
  await storageSet({ [SESSIONS_KEY]: sessions });
}

function makeSessionId() {
  // Reasonably unique without needing crypto APIs.
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeTabs(tabs) {
  const out = [];
  for (const t of Array.isArray(tabs) ? tabs : []) {
    const title = typeof t?.title === "string" ? t.title : "";
    const url = typeof t?.url === "string" ? t.url : "";
    if (!url || isRestrictedUrl(url)) continue;
    out.push({ title, url });
  }
  return out;
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let path = u.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.protocol}//${host}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function createTab(url, windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false, windowId }, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tab);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (message.type === "GET_TABS") {
      const scope = message.scope;
      const tabs = await queryTabsForScope(scope);

      const resultTabs = [];
      const skipped = [];

      for (const t of tabs) {
        if (typeof t?.id !== "number") {
          skipped.push({ reason: "missing_id", title: t?.title ?? "", url: t?.url ?? "" });
          continue;
        }

        const title = t.title || "";
        const url = t.url || "";
        const windowId = typeof t.windowId === "number" ? t.windowId : undefined;

        if (isRestrictedUrl(url)) {
          skipped.push({ id: t.id, reason: "restricted_url", title, url, windowId });
          continue;
        }

        resultTabs.push({ id: t.id, title, url, windowId });
      }

      sendResponse({ ok: true, tabs: resultTabs, skipped });
      return;
    }

    if (message.type === "SAVE_SESSION") {
      const nameRaw = typeof message.name === "string" ? message.name : "";
      const name = nameRaw.trim() || `Session ${new Date().toLocaleString()}`;
      const scope = message.scope;
      if (!["currentTab", "currentWindow", "allWindows"].includes(scope)) {
        sendResponse({ ok: false, error: `Unknown scope: ${scope}` });
        return;
      }

      const tabs = sanitizeTabs(message.tabs);
      if (tabs.length === 0) {
        sendResponse({ ok: false, error: "No tabs to save." });
        return;
      }

      const sessions = await loadSessions();
      const session = { id: makeSessionId(), name, createdAt: Date.now(), scope, tabs };
      const next = [session, ...sessions].slice(0, MAX_SESSIONS);
      await saveSessions(next);
      sendResponse({ ok: true, sessionId: session.id });
      return;
    }

    if (message.type === "LIST_SESSIONS") {
      const sessions = await loadSessions();
      const items = sessions.map((s) => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        scope: s.scope,
        tabCount: Array.isArray(s.tabs) ? s.tabs.length : 0,
      }));
      sendResponse({ ok: true, sessions: items });
      return;
    }

    if (message.type === "GET_SESSION") {
      const id = message.sessionId;
      const sessions = await loadSessions();
      const session = sessions.find((s) => s?.id === id);
      if (!session) {
        sendResponse({ ok: false, error: "Session not found" });
        return;
      }
      sendResponse({ ok: true, session });
      return;
    }

    if (message.type === "RENAME_SESSION") {
      const id = message.sessionId;
      const nameRaw = typeof message.name === "string" ? message.name : "";
      const name = nameRaw.trim();
      if (!name) {
        sendResponse({ ok: false, error: "Name is required" });
        return;
      }
      const sessions = await loadSessions();
      const idx = sessions.findIndex((s) => s?.id === id);
      if (idx === -1) {
        sendResponse({ ok: false, error: "Session not found" });
        return;
      }
      sessions[idx] = { ...sessions[idx], name };
      await saveSessions(sessions);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "DELETE_SESSION") {
      const id = message.sessionId;
      const sessions = await loadSessions();
      const next = sessions.filter((s) => s?.id !== id);
      await saveSessions(next);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "REMOVE_TAB_FROM_SESSION") {
      const id = message.sessionId;
      const tabIndex = message.tabIndex;
      if (typeof tabIndex !== "number" || !Number.isInteger(tabIndex)) {
        sendResponse({ ok: false, error: "tabIndex must be an integer" });
        return;
      }

      const sessions = await loadSessions();
      const idx = sessions.findIndex((s) => s?.id === id);
      if (idx === -1) {
        sendResponse({ ok: false, error: "Session not found" });
        return;
      }

      const session = sessions[idx];
      const tabs = Array.isArray(session.tabs) ? [...session.tabs] : [];
      if (tabIndex < 0 || tabIndex >= tabs.length) {
        sendResponse({ ok: false, error: "tabIndex out of range" });
        return;
      }

      tabs.splice(tabIndex, 1);
      sessions[idx] = { ...session, tabs };
      await saveSessions(sessions);
      sendResponse({ ok: true, tabCount: tabs.length });
      return;
    }

    if (message.type === "RESTORE_SESSION_APPEND") {
      const id = message.sessionId;
      const sessions = await loadSessions();
      const session = sessions.find((s) => s?.id === id);
      if (!session) {
        sendResponse({ ok: false, error: "Session not found" });
        return;
      }

      const tabList = sanitizeTabs(session.tabs);
      if (tabList.length === 0) {
        sendResponse({ ok: false, error: "Session has no restorable tabs" });
        return;
      }

      const windowId = typeof sender?.tab?.windowId === "number" ? sender.tab.windowId : undefined;

      const failed = [];
      let createdCount = 0;
      for (const t of tabList) {
        try {
          await createTab(t.url, windowId);
          createdCount += 1;
        } catch (e) {
          failed.push({ url: t.url, error: String(e?.message || e) });
        }
      }
      sendResponse({ ok: true, createdCount, failed });
      return;
    }

    if (message.type === "CLOSE_TABS") {
      const tabIds = Array.isArray(message.tabIds) ? message.tabIds : [];
      const uniqueIds = [...new Set(tabIds)].filter((id) => typeof id === "number");

      if (uniqueIds.length === 0) {
        sendResponse({ ok: true, closedCount: 0, failed: [] });
        return;
      }

      try {
        await removeTabs(uniqueIds);
        sendResponse({ ok: true, closedCount: uniqueIds.length, failed: [] });
      } catch (e) {
        // If the batch removal fails, try removing one-by-one to report failures.
        const failed = [];
        let closedCount = 0;
        for (const id of uniqueIds) {
          try {
            await removeTabs(id);
            closedCount += 1;
          } catch (err) {
            failed.push({ id, error: String(err?.message || err) });
          }
        }
        sendResponse({ ok: true, closedCount, failed });
      }
      return;
    }

    if (message.type === "GET_ALL_SESSIONS_FULL") {
      const sessions = await loadSessions();
      sendResponse({ ok: true, sessions });
      return;
    }

    if (message.type === "DEDUPE_ALL_SESSIONS") {
      const sessions = await loadSessions();
      const seen = new Set();
      let removedCount = 0;
      const affected = new Set();

      const next = sessions.map((s) => {
        const tabs = Array.isArray(s?.tabs) ? s.tabs : [];
        const kept = [];
        for (const t of tabs) {
          const key = normalizeUrl(t?.url || "");
          if (!key) {
            kept.push(t);
            continue;
          }
          if (seen.has(key)) {
            removedCount += 1;
            affected.add(s.id);
            continue;
          }
          seen.add(key);
          kept.push(t);
        }
        return kept.length === tabs.length ? s : { ...s, tabs: kept };
      });

      if (removedCount > 0) await saveSessions(next);
      sendResponse({ ok: true, removedCount, affectedSessions: affected.size });
      return;
    }

    if (message.type === "GET_AI_SETTINGS") {
      const s = await loadAiSettings();
      sendResponse({
        ok: true,
        enabled: s.enabled,
        hasKey: !!s.apiKey,
        consentAt: s.consentAt,
      });
      return;
    }

    if (message.type === "SET_AI_SETTINGS") {
      const cur = await loadAiSettings();
      const next = { ...cur };
      if (typeof message.apiKey === "string") next.apiKey = message.apiKey.trim();
      if (typeof message.enabled === "boolean") next.enabled = message.enabled;
      if (typeof message.consentAt === "number") next.consentAt = message.consentAt;
      if (!next.apiKey) next.enabled = false;
      await saveAiSettings(next);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "AI_TEST_KEY") {
      const s = await loadAiSettings();
      if (!s.apiKey) {
        sendResponse({ ok: false, error: "No API key set" });
        return;
      }
      if (!self.Gemini) {
        sendResponse({ ok: false, error: "Gemini module not loaded" });
        return;
      }
      try {
        await self.Gemini.testKey(s.apiKey);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }

    if (message.type === "AI_GENERATE_SESSION_NAME") {
      try {
        const s = await requireAi();
        if (!self.Gemini) throw new Error("Gemini module not loaded");
        const tabsIn = Array.isArray(message.tabs) ? message.tabs : [];
        const tabs = tabsIn
          .filter((t) => t && typeof t.url === "string" && !isRestrictedUrl(t.url))
          .map((t) => ({ title: typeof t.title === "string" ? t.title : "", url: t.url }));
        if (tabs.length === 0) throw new Error("No usable tabs to name");
        const name = await self.Gemini.generateSessionName(s.apiKey, tabs, message.scope || "");
        sendResponse({ ok: true, name });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }

    if (message.type === "AI_SMART_GROUPS") {
      try {
        const s = await requireAi();
        if (!self.Gemini) throw new Error("Gemini module not loaded");
        const tabsIn = Array.isArray(message.tabs) ? message.tabs : [];
        const tabs = tabsIn
          .filter((t) => t && typeof t.key === "string")
          .map((t) => ({
            key: t.key,
            title: typeof t.title === "string" ? t.title : "",
            host: typeof t.host === "string" ? t.host : "",
          }));
        if (tabs.length === 0) {
          sendResponse({ ok: true, groups: [] });
          return;
        }
        const groups = await self.Gemini.generateSmartGroups(s.apiKey, tabs);
        sendResponse({ ok: true, groups });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });

  return true;
});

