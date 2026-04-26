const $ = (sel) => document.querySelector(sel);

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function setStatus(elId, text, kind = "") {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text || "";
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

const state = {
  hasKey: false,
  enabled: false,
  consentAt: 0,
};

function refreshConsentUi() {
  const consentBox = $("#consent");
  if (consentBox) consentBox.checked = state.consentAt > 0;
  const aiEnabled = $("#aiEnabled");
  if (aiEnabled) aiEnabled.checked = state.enabled;
}

async function loadSettings() {
  try {
    const resp = await sendMessage({ type: "GET_AI_SETTINGS" });
    if (!resp?.ok) throw new Error(resp?.error || "Failed to load settings");
    state.hasKey = !!resp.hasKey;
    state.enabled = !!resp.enabled;
    state.consentAt = Number(resp.consentAt) || 0;
    if (state.hasKey) {
      $("#apiKey").placeholder = "Key saved (paste a new one to replace)";
    }
    refreshConsentUi();
  } catch (e) {
    setStatus("keyStatus", `Error: ${String(e.message || e)}`, "error");
  }
}

async function onSave() {
  const raw = $("#apiKey").value || "";
  const apiKey = raw.trim();
  if (!apiKey) {
    setStatus("keyStatus", "Paste a key first.", "error");
    return;
  }
  setStatus("keyStatus", "Saving…");
  try {
    const resp = await sendMessage({ type: "SET_AI_SETTINGS", apiKey });
    if (!resp?.ok) throw new Error(resp?.error || "Save failed");
    state.hasKey = true;
    $("#apiKey").value = "";
    $("#apiKey").placeholder = "Key saved (paste a new one to replace)";
    setStatus("keyStatus", "Saved.", "success");
  } catch (e) {
    setStatus("keyStatus", `Error: ${String(e.message || e)}`, "error");
  }
}

async function onClear() {
  if (!confirm("Remove your Gemini API key from this browser?")) return;
  setStatus("keyStatus", "Clearing…");
  try {
    const resp = await sendMessage({ type: "SET_AI_SETTINGS", apiKey: "", enabled: false });
    if (!resp?.ok) throw new Error(resp?.error || "Clear failed");
    state.hasKey = false;
    state.enabled = false;
    $("#apiKey").value = "";
    $("#apiKey").placeholder = "Paste your Gemini API key";
    refreshConsentUi();
    setStatus("keyStatus", "Cleared.", "success");
  } catch (e) {
    setStatus("keyStatus", `Error: ${String(e.message || e)}`, "error");
  }
}

async function onTest() {
  setStatus("keyStatus", "Testing…");
  $("#test").disabled = true;
  try {
    const pendingKey = ($("#apiKey").value || "").trim();
    if (pendingKey) {
      const saveResp = await sendMessage({ type: "SET_AI_SETTINGS", apiKey: pendingKey });
      if (!saveResp?.ok) throw new Error(saveResp?.error || "Save failed");
      state.hasKey = true;
      $("#apiKey").value = "";
      $("#apiKey").placeholder = "Key saved (paste a new one to replace)";
    }
    if (!state.hasKey) {
      setStatus("keyStatus", "Save a key first.", "error");
      return;
    }
    const resp = await sendMessage({ type: "AI_TEST_KEY" });
    if (!resp?.ok) throw new Error(resp?.error || "Test failed");
    setStatus("keyStatus", "✓ Key works.", "success");
  } catch (e) {
    setStatus("keyStatus", `✗ ${String(e.message || e)}`, "error");
  } finally {
    $("#test").disabled = false;
  }
}

async function onToggleEnabled(e) {
  const wantEnabled = e.target.checked;
  setStatus("enabledStatus", "");
  if (wantEnabled) {
    if (!state.hasKey) {
      e.target.checked = false;
      setStatus("enabledStatus", "Save an API key first.", "error");
      return;
    }
    const consentBox = $("#consent");
    if (!consentBox.checked) {
      e.target.checked = false;
      setStatus("enabledStatus", "Tick the consent checkbox to enable AI.", "error");
      return;
    }
  }
  try {
    const payload = { type: "SET_AI_SETTINGS", enabled: wantEnabled };
    if (wantEnabled && !state.consentAt) payload.consentAt = Date.now();
    const resp = await sendMessage(payload);
    if (!resp?.ok) throw new Error(resp?.error || "Save failed");
    state.enabled = wantEnabled;
    if (wantEnabled && !state.consentAt) state.consentAt = payload.consentAt;
    setStatus(
      "enabledStatus",
      wantEnabled ? "AI features enabled." : "AI features disabled.",
      "success"
    );
  } catch (err) {
    e.target.checked = !wantEnabled;
    setStatus("enabledStatus", `Error: ${String(err.message || err)}`, "error");
  }
}

function onToggleVisibility() {
  const input = $("#apiKey");
  input.type = input.type === "password" ? "text" : "password";
}

function onConsentChange(e) {
  if (!e.target.checked && state.enabled) {
    setStatus("enabledStatus", "Disable AI to revoke consent.", "error");
    e.target.checked = true;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#save")?.addEventListener("click", onSave);
  $("#test")?.addEventListener("click", onTest);
  $("#clear")?.addEventListener("click", onClear);
  $("#toggleVisibility")?.addEventListener("click", onToggleVisibility);
  $("#aiEnabled")?.addEventListener("change", onToggleEnabled);
  $("#consent")?.addEventListener("change", onConsentChange);
  $("#back")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = chrome.runtime.getURL("sessions.html");
    await new Promise((resolve) => {
      chrome.tabs.create({ url }, () => resolve());
    });
  });
  loadSettings();
});
