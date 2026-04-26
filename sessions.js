const $ = (sel) => document.querySelector(sel);

function setStatus(text) {
  const el = $("#status");
  if (!el) return;
  el.textContent = text || "";
}

function siteLabel(url) {
  if (!url) return "";
  try {
    const host = new URL(url).hostname || url;
    return host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function hostOf(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function faviconUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", "32");
    return u.toString();
  } catch {
    return "";
  }
}

function faviconUrlBig(url) {
  if (!url) return "";
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", "64");
    return u.toString();
  } catch {
    return "";
  }
}

const SCOPE_LABELS = {
  currentTab: "Single tab",
  currentWindow: "Window",
  allWindows: "All windows",
};
function scopeLabel(scope) {
  return SCOPE_LABELS[scope] || scope || "—";
}

let state = {
  sessionsFull: [],
  tabIndex: [],
  view: "date",
  query: "",
  selectedKey: null,
  aiEnabled: false,
  smartCache: null, // { hash, groups }
};

function buildTabIndex(sessionsFull) {
  const out = [];
  for (const s of sessionsFull || []) {
    const tabs = Array.isArray(s?.tabs) ? s.tabs : [];
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const url = (t?.url || "").trim();
      const title = (t?.title || "").trim();
      out.push({
        key: `${s.id}#${i}`,
        sessionId: s.id,
        sessionName: s.name || "(Unnamed)",
        sessionScope: s.scope,
        sessionCreatedAt: s.createdAt,
        tabIndex: i,
        title,
        url,
        host: hostOf(url),
      });
    }
  }
  return out;
}

function filterTabs(tabs, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.url.toLowerCase().includes(q) ||
      t.host.includes(q) ||
      t.sessionName.toLowerCase().includes(q)
  );
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dateBucket(ts) {
  if (!ts) return "Older";
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const oneDay = 86400000;
  const diffDays = Math.round((today - day) / oneDay);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Earlier this week";
  if (diffDays < 31) return "Earlier this month";
  return "Older";
}

const DATE_BUCKET_ORDER = [
  "Today",
  "Yesterday",
  "Earlier this week",
  "Earlier this month",
  "Older",
];

function groupByDateThenSession(tabs) {
  const buckets = new Map();
  for (const t of tabs) {
    const bucketKey = dateBucket(t.sessionCreatedAt);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
    const sessions = buckets.get(bucketKey);
    if (!sessions.has(t.sessionId)) {
      sessions.set(t.sessionId, {
        sessionId: t.sessionId,
        sessionName: t.sessionName,
        sessionScope: t.sessionScope,
        sessionCreatedAt: t.sessionCreatedAt,
        tabs: [],
      });
    }
    sessions.get(t.sessionId).tabs.push(t);
  }

  const ordered = [];
  for (const name of DATE_BUCKET_ORDER) {
    if (!buckets.has(name)) continue;
    const sessionsMap = buckets.get(name);
    const sessions = [...sessionsMap.values()].sort(
      (a, b) => (b.sessionCreatedAt || 0) - (a.sessionCreatedAt || 0)
    );
    for (const s of sessions) {
      s.tabs.sort((a, b) => a.tabIndex - b.tabIndex);
    }
    const totalTabs = sessions.reduce((sum, s) => sum + s.tabs.length, 0);
    ordered.push({ name, sessions, totalTabs });
  }
  return ordered;
}

function groupByDomain(tabs) {
  const buckets = new Map();
  for (const t of tabs) {
    const key = t.host || "(no host)";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  const groups = [];
  for (const [name, arr] of buckets) {
    arr.sort((a, b) => (b.sessionCreatedAt || 0) - (a.sessionCreatedAt || 0));
    groups.push({ name, tabs: arr });
  }
  groups.sort(
    (a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name)
  );
  return groups;
}

function buildTabRow(t, nested) {
  const row = document.createElement("div");
  row.className =
    "tabRow" +
    (t.key === state.selectedKey ? " active" : "") +
    (nested ? " nested" : "");
  row.dataset.key = t.key;

  const fav = document.createElement("img");
  fav.className = "fav";
  fav.alt = "";
  fav.src = faviconUrl(t.url);
  fav.addEventListener("error", () => {
    fav.replaceWith(
      Object.assign(document.createElement("span"), {
        className: "fav",
        textContent: "🌐",
      })
    );
  });

  const body = document.createElement("div");
  body.className = "body";
  const title = document.createElement("div");
  title.className = "t";
  title.textContent = t.title || "(No title)";
  title.title = t.title || "";
  const url = document.createElement("div");
  url.className = "u";
  url.textContent = t.host || t.url;
  url.title = t.url;
  body.appendChild(title);
  body.appendChild(url);

  row.appendChild(fav);
  row.appendChild(body);
  row.addEventListener("click", () => onSelectTab(t.key));
  return row;
}

function buildGroupHeader(name, count) {
  const wrapper = document.createElement("div");
  wrapper.className = "group";

  const header = document.createElement("div");
  header.className = "groupHeader";

  const left = document.createElement("span");
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "▼";
  left.appendChild(chevron);
  left.appendChild(document.createTextNode(name));

  const badge = document.createElement("span");
  badge.className = "count";
  badge.textContent = String(count);

  header.appendChild(left);
  header.appendChild(badge);

  const body = document.createElement("div");
  body.className = "groupBody";

  header.addEventListener("click", () => {
    const isCollapsed = header.classList.toggle("collapsed");
    body.classList.toggle("collapsed", isCollapsed);
  });

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return { wrapper, body };
}

function buildSessionHeader(session) {
  const header = document.createElement("div");
  header.className = "sessionHeader";
  const label = document.createElement("span");
  label.className = "sessionName";
  label.textContent = session.sessionName;
  label.title = `${session.sessionName} • Saved ${fmtDate(session.sessionCreatedAt)} • ${session.sessionScope}`;
  const meta = document.createElement("span");
  meta.className = "sessionMeta";
  const time = new Date(session.sessionCreatedAt);
  const pad = (n) => String(n).padStart(2, "0");
  meta.textContent = `${pad(time.getHours())}:${pad(time.getMinutes())} · ${session.tabs.length}`;
  header.appendChild(label);
  header.appendChild(meta);
  return header;
}

function renderSidebar() {
  const sidebar = $("#sidebar");
  const countLabel = $("#countLabel");
  if (!sidebar) return;

  const filtered = filterTabs(state.tabIndex, state.query);
  if (countLabel) {
    const total = state.tabIndex.length;
    countLabel.textContent =
      filtered.length === total
        ? `${total} tab(s)`
        : `${filtered.length} of ${total} tab(s)`;
  }

  sidebar.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.query
      ? `No matches for "${state.query}".`
      : "No saved tabs yet. Save a session from the popup.";
    sidebar.appendChild(empty);
    return;
  }

  if (state.view === "domain") {
    for (const g of groupByDomain(filtered)) {
      const { wrapper, body } = buildGroupHeader(g.name, g.tabs.length);
      for (const t of g.tabs) body.appendChild(buildTabRow(t, false));
      sidebar.appendChild(wrapper);
    }
    return;
  }

  for (const bucket of groupByDateThenSession(filtered)) {
    const { wrapper, body } = buildGroupHeader(bucket.name, bucket.totalTabs);
    for (const session of bucket.sessions) {
      body.appendChild(buildSessionHeader(session));
      for (const t of session.tabs) body.appendChild(buildTabRow(t, true));
    }
    sidebar.appendChild(wrapper);
  }
}

async function computeTabHash(tabIndex) {
  const entries = tabIndex
    .map((t) => ({ key: t.key, host: t.host, title: t.title }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const raw = JSON.stringify(entries);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSmartGroups() {
  const hash = await computeTabHash(state.tabIndex);
  if (state.smartCache && state.smartCache.hash === hash) {
    return state.smartCache.groups;
  }
  const tabs = state.tabIndex.map((t) => ({ key: t.key, title: t.title, host: t.host }));
  const resp = await sendMessage({ type: "AI_SMART_GROUPS", tabs });
  if (!resp?.ok) throw new Error(resp?.error || "Smart groups failed");
  const groups = Array.isArray(resp.groups) ? resp.groups : [];
  state.smartCache = { hash, groups };
  return groups;
}

function renderSmartGroups(groups) {
  const sidebar = $("#sidebar");
  if (!sidebar) return;
  sidebar.innerHTML = "";

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No groups generated. Try saving more tabs first.";
    sidebar.appendChild(empty);
    return;
  }

  const keyMap = new Map();
  for (const t of state.tabIndex) keyMap.set(t.key, t);

  for (const g of groups) {
    const matchedTabs = (g.tabKeys || [])
      .map((k) => keyMap.get(k))
      .filter(Boolean);
    if (matchedTabs.length === 0) continue;
    const { wrapper, body } = buildGroupHeader(g.name, matchedTabs.length);
    for (const t of matchedTabs) body.appendChild(buildTabRow(t, false));
    sidebar.appendChild(wrapper);
  }
}

function findTabByKey(key) {
  return state.tabIndex.find((t) => t.key === key) || null;
}

function findSessionById(id) {
  return state.sessionsFull.find((s) => s?.id === id) || null;
}

function renderDetail() {
  const detail = $("#detail");
  if (!detail) return;

  const tab = findTabByKey(state.selectedKey);
  if (!tab) {
    detail.innerHTML = `
      <div class="empty emptyState">
        <div class="heading">Select a tab on the left</div>
        <div class="helper">Press <kbd>/</kbd> to search · <kbd>Esc</kbd> to clear</div>
      </div>
    `;
    return;
  }

  const session = findSessionById(tab.sessionId);

  detail.innerHTML = "";

  const tabCard = document.createElement("div");
  tabCard.className = "detailCard";
  tabCard.innerHTML = `
    <div class="tabHead">
      <img class="favLg" alt="" />
      <div class="body">
        <h2></h2>
        <div class="url"></div>
      </div>
    </div>
    <div class="actions">
      <button class="primary" id="openTab" type="button">Open tab</button>
      <button id="copyUrl" type="button">Copy URL</button>
      <button class="danger" id="removeTab" type="button">Remove from session</button>
    </div>
  `;
  tabCard.querySelector("h2").textContent = tab.title || "(No title)";
  tabCard.querySelector(".url").textContent = tab.url;
  const favLg = tabCard.querySelector(".favLg");
  favLg.src = faviconUrlBig(tab.url);
  favLg.addEventListener("error", () => {
    const fallback = document.createElement("div");
    fallback.className = "favLg";
    fallback.textContent = "🌐";
    favLg.replaceWith(fallback);
  });
  detail.appendChild(tabCard);

  tabCard.querySelector("#openTab").addEventListener("click", () => {
    chrome.tabs.create({ url: tab.url, active: true });
  });
  tabCard.querySelector("#copyUrl").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(tab.url);
      setStatus("URL copied to clipboard.");
    } catch (e) {
      setStatus(`Copy failed: ${String(e?.message || e)}`);
    }
  });
  tabCard.querySelector("#removeTab").addEventListener("click", () => {
    onRemoveTab(tab).catch((e) => setStatus(`Error: ${String(e?.message || e)}`));
  });

  const sessionCard = document.createElement("div");
  sessionCard.className = "detailCard";
  sessionCard.innerHTML = `
    <div class="label">Session</div>
    <h2></h2>
    <div class="pillRow">
      <span class="pill" id="savedPill"></span>
      <span class="pill" id="scopePill"></span>
      <span class="pill" id="tabsPill"></span>
    </div>
    <div class="actions">
      <button class="primary" id="restoreSession" type="button">Restore all tabs</button>
      <button id="renameSession" type="button">Rename session</button>
      <button class="danger" id="deleteSession" type="button">Delete session</button>
    </div>
  `;
  sessionCard.querySelector("h2").textContent = tab.sessionName;
  sessionCard.querySelector("#savedPill").textContent = `Saved ${fmtDate(tab.sessionCreatedAt)}`;
  const scopePill = sessionCard.querySelector("#scopePill");
  scopePill.textContent = scopeLabel(tab.sessionScope);
  scopePill.classList.add(`scope-${tab.sessionScope}`);
  sessionCard.querySelector("#tabsPill").textContent = `${
    session?.tabs?.length || 0
  } tab(s) in session`;
  detail.appendChild(sessionCard);

  sessionCard.querySelector("#restoreSession").addEventListener("click", () => {
    onRestoreSession(tab.sessionId).catch((e) =>
      setStatus(`Error: ${String(e?.message || e)}`)
    );
  });
  sessionCard.querySelector("#renameSession").addEventListener("click", () => {
    onRenameSession(tab.sessionId).catch((e) =>
      setStatus(`Error: ${String(e?.message || e)}`)
    );
  });
  sessionCard.querySelector("#deleteSession").addEventListener("click", () => {
    onDeleteSession(tab.sessionId).catch((e) =>
      setStatus(`Error: ${String(e?.message || e)}`)
    );
  });
}

async function reload() {
  setStatus("Loading…");
  const resp = await sendMessage({ type: "GET_ALL_SESSIONS_FULL" });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to load sessions");
  state.sessionsFull = Array.isArray(resp.sessions) ? resp.sessions : [];
  state.tabIndex = buildTabIndex(state.sessionsFull);

  if (state.selectedKey && !findTabByKey(state.selectedKey)) {
    state.selectedKey = null;
  }

  renderSidebar();
  renderDetail();
  setStatus("");
  if (state.view === "smart" && state.aiEnabled) {
    onSmartView();
  }
}

function onSelectTab(key) {
  state.selectedKey = key;
  renderSidebar();
  renderDetail();
}

function onSearchInput(e) {
  state.query = e.target.value || "";
  renderSidebar();
}

function onViewToggle(view) {
  if (state.view === view) return;
  state.view = view;
  document.querySelectorAll(".segmented button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  if (view === "smart") {
    onSmartView();
  } else {
    renderSidebar();
  }
}

async function onSmartView() {
  if (!state.aiEnabled) {
    const sidebar = $("#sidebar");
    if (sidebar) {
      sidebar.innerHTML = "";
      const card = document.createElement("div");
      card.className = "empty emptyState";
      card.innerHTML = `
        <div class="heading">AI not enabled</div>
        <div class="helper">Set up your Gemini API key in <a href="#" id="setupLink">⚙ Settings</a> to use Smart Groups.</div>
      `;
      sidebar.appendChild(card);
      card.querySelector("#setupLink")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
      });
    }
    return;
  }
  if (state.tabIndex.length === 0) {
    const sidebar = $("#sidebar");
    if (sidebar) {
      sidebar.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No saved tabs yet. Save a session from the popup.";
      sidebar.appendChild(empty);
    }
    return;
  }
  const sidebar = $("#sidebar");
  if (sidebar) {
    sidebar.innerHTML = '<div class="empty">✨ Generating smart groups…</div>';
  }
  setStatus("");
  try {
    const groups = await getSmartGroups();
    if (state.view === "smart") renderSmartGroups(groups);
  } catch (e) {
    if (state.view === "smart" && sidebar) {
      sidebar.innerHTML = "";
      const err = document.createElement("div");
      err.className = "empty";
      err.textContent = `Error: ${String(e?.message || e)}`;
      sidebar.appendChild(err);
    }
  }
}

async function onDedupe() {
  const ok = confirm(
    "Remove duplicate URLs across ALL saved sessions?\n\nKeeps the first occurrence of each URL (newest sessions first). This cannot be undone."
  );
  if (!ok) return;

  setStatus("Scanning for duplicates…");
  const resp = await sendMessage({ type: "DEDUPE_ALL_SESSIONS" });
  if (!resp?.ok) throw new Error(resp?.error || "Dedupe failed");

  const removed = resp.removedCount || 0;
  const affected = resp.affectedSessions || 0;
  if (removed === 0) {
    setStatus("No duplicates found.");
  } else {
    setStatus(`Removed ${removed} duplicate tab(s) across ${affected} session(s).`);
  }
  await reload();
}

async function onRemoveTab(tab) {
  setStatus("Removing tab…");
  const resp = await sendMessage({
    type: "REMOVE_TAB_FROM_SESSION",
    sessionId: tab.sessionId,
    tabIndex: tab.tabIndex,
  });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to remove tab");
  state.selectedKey = null;
  await reload();
  setStatus("Removed.");
}

async function onRestoreSession(sessionId) {
  const session = findSessionById(sessionId);
  if (!session) return;
  const ok = confirm(
    `Restore ${session.tabs?.length || 0} tab(s) from "${session.name}" into the current window?`
  );
  if (!ok) return;
  setStatus("Restoring…");
  const resp = await sendMessage({ type: "RESTORE_SESSION_APPEND", sessionId });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to restore session");
  const failed = resp.failed || [];
  if (failed.length > 0) setStatus(`Restored with ${failed.length} failure(s).`);
  else setStatus(`Restored ${resp.createdCount || 0} tab(s).`);
}

async function onRenameSession(sessionId) {
  const session = findSessionById(sessionId);
  if (!session) return;
  const name = prompt("New session name:", session.name || "");
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  setStatus("Renaming…");
  const resp = await sendMessage({ type: "RENAME_SESSION", sessionId, name: trimmed });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to rename session");
  await reload();
  setStatus("Renamed.");
}

async function onDeleteSession(sessionId) {
  const session = findSessionById(sessionId);
  if (!session) return;
  const ok = confirm(
    `Delete session "${session.name}" and all its tabs from TabCache?`
  );
  if (!ok) return;
  setStatus("Deleting…");
  const resp = await sendMessage({ type: "DELETE_SESSION", sessionId });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to delete session");
  state.selectedKey = null;
  await reload();
  setStatus("Deleted.");
}

function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    const inField = tag === "input" || tag === "textarea";
    if (e.key === "/" && !inField) {
      e.preventDefault();
      $("#search")?.focus();
      $("#search")?.select();
      return;
    }
    if (e.key === "Escape" && document.activeElement === $("#search")) {
      const input = $("#search");
      if (input.value) {
        input.value = "";
        state.query = "";
        renderSidebar();
      } else {
        input.blur();
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  $("#refresh")?.addEventListener("click", () => {
    state.smartCache = null;
    reload().catch((e) => setStatus(`Error: ${String(e?.message || e)}`));
  });
  $("#dedupe")?.addEventListener("click", () => {
    onDedupe().catch((e) => setStatus(`Error: ${String(e?.message || e)}`));
  });
  $("#search")?.addEventListener("input", onSearchInput);
  document.querySelectorAll(".segmented button").forEach((btn) => {
    btn.addEventListener("click", () => onViewToggle(btn.dataset.view));
  });

  bindKeyboard();
  reload().catch((e) => setStatus(`Error: ${String(e?.message || e)}`));

  // Load AI settings to show/hide Smart button
  sendMessage({ type: "GET_AI_SETTINGS" })
    .then((resp) => {
      state.aiEnabled = !!(resp?.ok && resp.enabled && resp.hasKey && resp.consentAt);
      const smartBtn = $("#viewSmart");
      if (smartBtn) smartBtn.style.display = state.aiEnabled ? "" : "none";
    })
    .catch(() => {});

  // Settings link
  $("#openSettings")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  });
});
