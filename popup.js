const $ = (sel) => document.querySelector(sel);

function setStatus(text, kind = "info") {
  const el = $("#status");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind;
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

function defaultSessionName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
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

const state = {
  scope: "currentTab",
  counts: { currentTab: null, currentWindow: null, allWindows: null },
  cache: { currentTab: null, currentWindow: null, allWindows: null },
  aiEnabled: false,
};

function tileCountText(n) {
  if (n == null) return "·";
  return `· ${n}`;
}

function renderTiles() {
  document.querySelectorAll(".tile").forEach((tile) => {
    const scope = tile.dataset.scope;
    const n = state.counts[scope];
    tile.classList.toggle("selected", scope === state.scope);
    tile.classList.toggle("empty", n === 0);
    const countEl = tile.querySelector(".count");
    if (countEl) countEl.textContent = tileCountText(n);
  });
}

function renderCta() {
  const btn = $("#run");
  if (!btn) return;
  const n = state.counts[state.scope];
  if (n == null) {
    btn.textContent = "Save & close…";
    btn.disabled = true;
    return;
  }
  if (n === 0) {
    btn.textContent = "Nothing to save";
    btn.disabled = true;
    return;
  }
  btn.textContent = n === 1 ? "Save & close 1 tab" : `Save & close ${n} tabs`;
  btn.disabled = false;
}

async function loadCounts() {
  const scopes = ["currentTab", "currentWindow", "allWindows"];
  const responses = await Promise.all(
    scopes.map((scope) => sendMessage({ type: "GET_TABS", scope }).catch(() => null))
  );
  for (let i = 0; i < scopes.length; i++) {
    const resp = responses[i];
    const tabs = resp?.tabs || [];
    state.counts[scopes[i]] = tabs.length;
    state.cache[scopes[i]] = resp?.ok
      ? { tabs, skipped: resp.skipped || [] }
      : null;
  }
  renderTiles();
  renderCta();
}

async function loadAiState() {
  try {
    const resp = await sendMessage({ type: "GET_AI_SETTINGS" });
    state.aiEnabled = !!(resp?.ok && resp.enabled && resp.hasKey && resp.consentAt);
  } catch {
    state.aiEnabled = false;
  }
  const btn = $("#autoName");
  if (btn) btn.style.display = state.aiEnabled ? "" : "none";
}

async function onAutoName() {
  const btn = $("#autoName");
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("loading");
  setStatus("Generating name…");
  try {
    const scope = state.scope;
    let tabs = state.cache[scope]?.tabs;
    if (!tabs) {
      const resp = await sendMessage({ type: "GET_TABS", scope });
      if (!resp?.ok) throw new Error(resp?.error || "Failed to collect tabs");
      tabs = resp.tabs || [];
      state.cache[scope] = { tabs, skipped: resp.skipped || [] };
      state.counts[scope] = tabs.length;
    }
    if (tabs.length === 0) {
      setStatus("No tabs to analyze.");
      return;
    }
    const resp = await sendMessage({
      type: "AI_GENERATE_SESSION_NAME",
      tabs: tabs.map((t) => ({ title: t.title, url: t.url })),
      scope,
    });
    if (!resp?.ok) throw new Error(resp?.error || "AI naming failed");
    const nameInput = $("#sessionName");
    if (nameInput) nameInput.value = resp.name;
    setStatus("");
  } catch (e) {
    setStatus(`AI: ${String(e?.message || e)}`, "error");
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

function selectScope(scope) {
  if (!["currentTab", "currentWindow", "allWindows"].includes(scope)) return;
  state.scope = scope;
  renderTiles();
  renderCta();
}

function renderPreview({ tabs, skipped }) {
  const container = $("#preview");
  if (!container) return;
  container.innerHTML = "";

  const total = tabs.length;
  const skippedCount = skipped?.length || 0;

  const head = document.createElement("div");
  head.className = "previewHead";
  head.innerHTML = `
    <span class="pill">${total} selected</span>
    <span class="pill">${skippedCount} skipped</span>
  `;
  container.appendChild(head);

  const list = document.createElement("div");
  list.className = "list";
  if (total === 0) {
    list.innerHTML = `<div class="item" style="opacity:.7">No closable tabs found.</div>`;
  } else {
    for (const t of tabs) {
      const item = document.createElement("div");
      item.className = "item";
      const safeTitle = (t.title || "").trim() || "(No title)";
      const safeUrl = (t.url || "").trim();
      item.innerHTML = `
        <a target="_blank" rel="noreferrer noopener">
          <div class="t"></div>
          <div class="u"></div>
        </a>
      `;
      const a = item.querySelector("a");
      a.href = safeUrl;
      a.title = safeUrl;
      a.querySelector(".t").textContent = safeTitle;
      a.querySelector(".u").textContent = siteLabel(safeUrl);
      list.appendChild(item);
    }
  }
  container.appendChild(list);

  if (skippedCount > 0) {
    const note = document.createElement("div");
    note.className = "skipNote";
    note.textContent = "Skipped tabs are usually internal pages (e.g. chrome://) that Chrome won't allow extensions to close.";
    container.appendChild(note);
  }
}

async function onRun() {
  const btn = $("#run");
  if (btn?.disabled) return;
  btn.disabled = true;
  $("#preview").innerHTML = "";
  setStatus("Collecting tabs…");

  try {
    const scope = state.scope;
    let tabs = state.cache[scope]?.tabs;
    let skipped = state.cache[scope]?.skipped;

    if (!tabs) {
      const resp = await sendMessage({ type: "GET_TABS", scope });
      if (!resp?.ok) throw new Error(resp?.error || "Failed to collect tabs");
      tabs = resp.tabs || [];
      skipped = resp.skipped || [];
      state.cache[scope] = { tabs, skipped };
      state.counts[scope] = tabs.length;
    }

    renderPreview({ tabs, skipped });

    if (tabs.length === 0) {
      setStatus("Nothing to save/close.");
      renderCta();
      return;
    }

    const confirmEnabled = $("#confirm")?.checked ?? true;
    if (confirmEnabled) {
      const ok = confirm(`Save session and close ${tabs.length} tab(s)?`);
      if (!ok) {
        setStatus("Cancelled.");
        renderCta();
        return;
      }
    }

    const name = ($("#sessionName")?.value || "").trim();
    setStatus("Saving session…");
    const saveResp = await sendMessage({
      type: "SAVE_SESSION",
      name,
      scope,
      tabs: tabs.map((t) => ({ title: t.title, url: t.url })),
    });
    if (!saveResp?.ok) throw new Error(saveResp?.error || "Failed to save session");

    setStatus("Closing tabs…");
    const closeResp = await sendMessage({
      type: "CLOSE_TABS",
      tabIds: tabs.map((t) => t.id),
    });
    if (!closeResp?.ok) throw new Error(closeResp?.error || "Failed to close tabs");

    const closedCount = closeResp.closedCount || 0;
    const failed = closeResp.failed || [];
    if (failed.length > 0) {
      setStatus(`Saved. Closed ${closedCount} tab(s). ${failed.length} failed.`);
    } else {
      setStatus(`Saved. Closed ${closedCount} tab(s).`);
    }
  } catch (e) {
    setStatus(`Error: ${String(e?.message || e)}`, "error");
  } finally {
    renderCta();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const nameInput = $("#sessionName");
  if (nameInput && !nameInput.value) nameInput.value = defaultSessionName();

  document.querySelectorAll(".tile").forEach((tile) => {
    tile.addEventListener("click", () => selectScope(tile.dataset.scope));
  });

  $("#run")?.addEventListener("click", onRun);
  $("#autoName")?.addEventListener("click", onAutoName);

  $("#manage")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = chrome.runtime.getURL("sessions.html");
    await new Promise((resolve, reject) => {
      chrome.tabs.create({ url }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  });

  $("#openSettings")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = chrome.runtime.getURL("settings.html");
    chrome.tabs.create({ url });
  });

  renderTiles();
  renderCta();
  loadCounts().catch((e) =>
    setStatus(`Error: ${String(e?.message || e)}`, "error")
  );
  loadAiState();
});
