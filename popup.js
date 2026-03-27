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

function getScope() {
  const checked = document.querySelector('input[name="scope"]:checked');
  return checked?.value || "currentTab";
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

function renderPreview({ tabs, skipped }) {
  const container = $("#preview");
  if (!container) return;

  const total = tabs.length;
  const skippedCount = skipped?.length || 0;

  const header = document.createElement("div");
  header.className = "row";
  header.style.marginTop = "10px";
  header.innerHTML = `
    <div class="pill">${total} selected</div>
    <div class="pill">${skippedCount} skipped</div>
  `;

  const list = document.createElement("div");
  list.className = "list";

  if (total === 0) {
    list.innerHTML = `<div class="muted">No closable tabs found for this scope.</div>`;
  } else {
    for (const t of tabs) {
      const item = document.createElement("div");
      item.className = "item";
      const safeTitle = (t.title || "").trim() || "(No title)";
      const safeUrl = (t.url || "").trim();
      item.innerHTML = `
        <a class="t" target="_blank" rel="noreferrer noopener"></a>
        <a class="u" target="_blank" rel="noreferrer noopener"></a>
      `;
      const titleA = item.querySelector(".t");
      const urlA = item.querySelector(".u");
      titleA.textContent = safeTitle;
      urlA.textContent = siteLabel(safeUrl);
      titleA.href = safeUrl;
      urlA.href = safeUrl;
      titleA.title = safeUrl;
      urlA.title = safeUrl;
      list.appendChild(item);
    }
  }

  container.innerHTML = "";
  container.appendChild(header);
  container.appendChild(list);

  if (skippedCount > 0) {
    const skippedEl = document.createElement("div");
    skippedEl.className = "muted";
    skippedEl.style.marginTop = "8px";
    skippedEl.textContent = `Skipped tabs are usually internal pages (e.g. chrome://) that Chrome won’t allow extensions to close.`;
    container.appendChild(skippedEl);
  }
}

async function onRun() {
  const btn = $("#run");
  btn.disabled = true;
  $("#preview").innerHTML = "";
  setStatus("Collecting tabs…");

  try {
    const scope = getScope();
    const resp = await sendMessage({ type: "GET_TABS", scope });
    if (!resp?.ok) throw new Error(resp?.error || "Failed to collect tabs");

    const tabs = resp.tabs || [];
    const skipped = resp.skipped || [];
    renderPreview({ tabs, skipped });

    if (tabs.length === 0) {
      setStatus("Nothing to save/close.");
      return;
    }

    const confirmEnabled = $("#confirm")?.checked ?? true;
    if (confirmEnabled) {
      const ok = confirm(`Save session and close ${tabs.length} tab(s)?`);
      if (!ok) {
        setStatus("Cancelled.");
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
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#run")?.addEventListener("click", onRun);

  const nameInput = $("#sessionName");
  if (nameInput && !nameInput.value) nameInput.value = defaultSessionName();

  $("#manage")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = chrome.runtime.getURL("sessions.html");
    // Open in a normal tab.
    await new Promise((resolve, reject) => {
      chrome.tabs.create({ url }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  });
});

