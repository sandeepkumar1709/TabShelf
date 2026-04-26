# TabCache 🧠🔖

A Chrome extension that saves your tab sessions and uses **Google Gemini** to auto-name them and cluster saved tabs into smart, AI-generated topic groups.

Built for the **GDSC HackDay "Build With AI"** hackathon.

Targeting: **Best App for Developer Productivity** & **Best Use of Gemini**.

## ✨ Features

- 🔖 **One-Click Save & Restore** — Save your current tab, window, or all windows instantly.
- ✨ **AI Auto-Naming (Gemini)** — Instead of generic timestamps, Gemini analyzes your tabs and generates specific session names (e.g., "React Hooks Research").
- 🤖 **Smart Groups (Gemini)** — Click "🤖 Smart" on the sessions page to have Gemini automatically cluster all your saved tabs across all sessions into themed categories (e.g., "API Debugging", "Job Applications").
- 🔒 **Privacy-First (BYOK)** — Bring your own Gemini API key. It stays securely in your browser's local storage. No backend servers, no data collection.

## 🚀 How to Install & Run Locally

1. Clone this repository: `git clone https://github.com/sandeepkumar1709/TabShelf.git`
2. Open Google Chrome and navigate to `chrome://extensions/`
3. Toggle on **Developer Mode** in the top right corner.
4. Click **Load unpacked** and select the `TabCache` directory.
5. The Settings page will automatically open.

## ⚙️ AI Setup

To use the AI features, you need a free Google Gemini API key:

1. Get a free API key at [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Paste it into the TabCache Settings page.
3. Toggle "Enable AI features" to ON.

## 🛠️ Built With

- Vanilla JavaScript, HTML5, CSS3
- Chrome Extensions API (Manifest V3)
- Google Gemini 2.5 Flash API (`generativelanguage.googleapis.com`)
- Structured JSON Output (`responseSchema`)

## 💡 What's Next

- **Secure Backend:** A dedicated server to authenticate API calls without requiring users to provide their own keys.
- **Deep Research Summarization:** Using Gemini to summarize the actual text content of saved tabs.
- **Workspace Linking:** Auto-restoring specific tab groups when switching Git branches in an IDE.
