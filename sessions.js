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

let state = {
  sessions: [],
  selectedId: null,
  selectedSession: null,
};

function renderList() {
  const list = $("#sessionList");
  const countLabel = $("#countLabel");
  if (!list) return;

  const sessions = state.sessions || [];
  if (countLabel) countLabel.textContent = `${sessions.length} session(s)`;

  list.innerHTML = "";
  if (sessions.length === 0) {
    list.innerHTML = `<div class="empty">No sessions yet. Save one from the extension popup.</div>`;
    return;
  }

  for (const s of sessions) {
    const div = document.createElement("div");
    div.className = "sessionItem" + (s.id === state.selectedId ? " active" : "");
    div.dataset.id = s.id;
    div.innerHTML = `
      <div class="name"></div>
      <div class="meta"></div>
    `;
    div.querySelector(".name").textContent = s.name || "(Unnamed)";
    div.querySelector(".meta").textContent = `${fmtDate(s.createdAt)} • ${s.tabCount || 0} tab(s) • ${s.scope}`;
    div.addEventListener("click", () => selectSession(s.id));
    list.appendChild(div);
  }
}

function renderDetail() {
  const detail = $("#detail");
  if (!detail) return;

  const s = state.selectedSession;
  if (!s) {
    detail.innerHTML = `<div class="empty">Select a session to view details.</div>`;
    return;
  }

  const tabCount = Array.isArray(s.tabs) ? s.tabs.length : 0;

  detail.innerHTML = `
    <div class="detailHeader">
      <div style="min-width: 0">
        <h2 id="sessionTitle"></h2>
        <div class="pillRow">
          <span class="pill">${fmtDate(s.createdAt)}</span>
          <span class="pill">${tabCount} tab(s)</span>
          <span class="pill">${s.scope}</span>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end">
        <button id="rename">Rename</button>
        <button id="delete">Delete</button>
      </div>
    </div>
    <div class="tabsList" id="tabsList"></div>
  `;

  detail.querySelector("#sessionTitle").textContent = s.name || "(Unnamed)";

  const tabsList = detail.querySelector("#tabsList");
  if (tabCount === 0) {
    tabsList.innerHTML = `<div class="empty">This session has no tabs.</div>`;
  } else {
    tabsList.innerHTML = "";
    for (const [i, t] of s.tabs.entries()) {
      const item = document.createElement("div");
      item.className = "tabItem";
      const title = (t?.title || "").trim() || "(No title)";
      const url = (t?.url || "").trim();
      item.innerHTML = `
        <div>
          <a class="t" target="_blank" rel="noreferrer noopener"></a>
          <a class="u" target="_blank" rel="noreferrer noopener"></a>
        </div>
        <div class="tabActions">
          <button class="iconBtn" type="button" aria-label="Remove from session" title="Remove from session">×</button>
        </div>
      `;
      const titleA = item.querySelector(".t");
      const urlA = item.querySelector(".u");
      titleA.textContent = title;
      urlA.textContent = siteLabel(url);
      titleA.href = url;
      urlA.href = url;
      titleA.title = url;
      urlA.title = url;

      item.querySelector(".iconBtn").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeTabFromSession(i).catch((err) =>
          setStatus(`Error: ${String(err?.message || err)}`)
        );
      });
      tabsList.appendChild(item);
    }
  }

  detail.querySelector("#rename").addEventListener("click", onRename);
  detail.querySelector("#delete").addEventListener("click", onDelete);
}

async function refresh() {
  setStatus("Loading sessions…");
  const resp = await sendMessage({ type: "LIST_SESSIONS" });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to list sessions");

  state.sessions = resp.sessions || [];
  if (state.selectedId && !state.sessions.some((s) => s.id === state.selectedId)) {
    state.selectedId = null;
    state.selectedSession = null;
  }

  renderList();
  renderDetail();
  setStatus("");
}

async function selectSession(id) {
  state.selectedId = id;
  renderList();
  setStatus("Loading session…");
  const resp = await sendMessage({ type: "GET_SESSION", sessionId: id });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to load session");
  state.selectedSession = resp.session;
  renderDetail();
  setStatus("");
}

async function onRestore() {
  const s = state.selectedSession;
  if (!s) return;
  const ok = confirm(`Restore ${s.tabs?.length || 0} tab(s) into the current window?`);
  if (!ok) return;

  setStatus("Restoring…");
  const resp = await sendMessage({ type: "RESTORE_SESSION_APPEND", sessionId: s.id });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to restore session");
  const failed = resp.failed || [];
  if (failed.length > 0) setStatus(`Restored with ${failed.length} failure(s).`);
  else setStatus(`Restored ${resp.createdCount || 0} tab(s).`);
}

async function removeTabFromSession(tabIndex) {
  const s = state.selectedSession;
  if (!s) return;
  setStatus("Removing tab…");
  const resp = await sendMessage({
    type: "REMOVE_TAB_FROM_SESSION",
    sessionId: s.id,
    tabIndex,
  });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to remove tab");
  await selectSession(s.id);
  setStatus("Removed.");
}

async function onRename() {
  const s = state.selectedSession;
  if (!s) return;
  const name = prompt("New session name:", s.name || "");
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  setStatus("Renaming…");
  const resp = await sendMessage({ type: "RENAME_SESSION", sessionId: s.id, name: trimmed });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to rename session");
  await refresh();
  await selectSession(s.id);
  setStatus("Renamed.");
}

async function onDelete() {
  const s = state.selectedSession;
  if (!s) return;
  const ok = confirm(`Delete session “${s.name || "Unnamed"}”?`);
  if (!ok) return;

  setStatus("Deleting…");
  const resp = await sendMessage({ type: "DELETE_SESSION", sessionId: s.id });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to delete session");
  state.selectedId = null;
  state.selectedSession = null;
  await refresh();
  setStatus("Deleted.");
}

document.addEventListener("DOMContentLoaded", () => {
  $("#refresh")?.addEventListener("click", () => {
    refresh().catch((e) => setStatus(`Error: ${String(e?.message || e)}`));
  });

  refresh().catch((e) => setStatus(`Error: ${String(e?.message || e)}`));
});

