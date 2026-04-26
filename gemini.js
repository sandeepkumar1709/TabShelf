const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function geminiCall(apiKey, { prompt, schema, temperature }) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: typeof temperature === "number" ? temperature : 0.4,
    },
  };
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {}
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Gemini returned non-JSON: ${String(text).slice(0, 120)}`);
  }
}

const SESSION_NAME_SCHEMA = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
};

const SMART_GROUPS_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          tabKeys: { type: "array", items: { type: "string" } },
        },
        required: ["name", "tabKeys"],
      },
    },
  },
  required: ["groups"],
};

self.Gemini = {
  async testKey(apiKey) {
    const out = await geminiCall(apiKey, {
      prompt: 'Reply with the single JSON object {"name":"ok"} and nothing else.',
      schema: SESSION_NAME_SCHEMA,
      temperature: 0,
    });
    return Boolean(out && typeof out.name === "string");
  },

  async generateSessionName(apiKey, tabs, scope) {
    const safeTabs = Array.isArray(tabs) ? tabs.slice(0, 30) : [];
    const list = safeTabs
      .map((t, i) => `${i + 1}. ${(t.title || "").slice(0, 140)} (${t.url || ""})`)
      .join("\n");
    const prompt =
      `You name browsing sessions. Given these ${safeTabs.length} tabs ` +
      `(scope: ${scope || "unknown"}), produce ONE short, specific session name ` +
      `(at most 6 words, no quotes, no trailing punctuation). Avoid generic names ` +
      `like "Browsing", "Tabs", "Session". Prefer the dominant theme.\n\n` +
      `Tabs:\n${list}`;
    const out = await geminiCall(apiKey, {
      prompt,
      schema: SESSION_NAME_SCHEMA,
      temperature: 0.4,
    });
    const name = (out?.name || "").trim().replace(/^["'`]+|["'`]+$/g, "");
    if (!name) throw new Error("Gemini returned empty name");
    return name.slice(0, 80);
  },

  async generateSmartGroups(apiKey, tabs) {
    const safeTabs = Array.isArray(tabs) ? tabs : [];
    if (safeTabs.length === 0) return [];
    const list = safeTabs
      .map(
        (t) =>
          `${t.key} | ${(t.host || "").slice(0, 60)} | ${(t.title || "").slice(0, 140)}`
      )
      .join("\n");
    const prompt =
      `Cluster these saved browser tabs into 3 to 8 themed groups. Every tab "key" ` +
      `must appear in exactly ONE group. Group names must be specific and human ` +
      `(e.g. "React perf debugging", not "Web stuff"; ` +
      `"Job applications", not "Work"). Format below is: key | host | title.\n\n` +
      `${list}`;
    const out = await geminiCall(apiKey, {
      prompt,
      schema: SMART_GROUPS_SCHEMA,
      temperature: 0.5,
    });
    const groups = Array.isArray(out?.groups) ? out.groups : [];
    return groups
      .map((g) => ({
        name: (g?.name || "").trim().slice(0, 60) || "Untitled",
        tabKeys: Array.isArray(g?.tabKeys) ? g.tabKeys.filter((k) => typeof k === "string") : [],
      }))
      .filter((g) => g.tabKeys.length > 0);
  },
};
