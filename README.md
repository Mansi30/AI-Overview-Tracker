# AI Overview Tracker - Chrome Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Track, analyze, and gain insights from Google's AI Overview citations in real-time.

AI Overview Tracker is a Chrome extension for researchers, SEO professionals, and digital marketers who want to understand how Google's AI Overviews cite and display sources. It captures citation data and syncs it to a shared Firebase backend for analysis on the dashboard.

---

## Features

- **Automatic detection** — detects AI Overviews on Google Search and captures the full response text
- **Citation tracking** — extracts all cited URLs/domains, position, timestamps, and click events
- **Analytics dashboard** — real-time charts for CTR, domain rankings, topic categories, and trends
- **Topic classification** — queries auto-classified via a Cloud Function (Technology, Health, Finance, etc.)
- **Journey tracking** — tracks dwell time and navigation patterns from citations
- **Data retention** — configurable per-user (7, 15, 30, or 90 days)

---

## Setup

This extension connects to a shared Firebase project. Credentials are provided by Adrian.

### Prerequisites

- Node.js (any recent LTS version — only used for the one-time env generation script)
- Google Chrome

### Steps

1. **Clone the repo**

   ```bash
   git clone https://github.com/AdrianHagen/AI-Overview-Tracker.git
   cd AI-Overview-Tracker
   ```

2. **Create your `.env` file**

   ```bash
   cp .env.example .env
   ```

   Then fill in the values (request credentials from Adrian if you don't have them):

   | Variable | Required | Description |
   |---|---|---|
   | `FIREBASE_PROJECT_ID` | Yes | Firebase project ID (used for Firestore and Cloud Function endpoints) |
   | `FIREBASE_WEB_API_KEY` | Yes | Firebase Web API key (used for Identity Toolkit auth) |
   | `FIREBASE_REGION` | No | Cloud Functions region (default: `us-central1`) |
   | `CLASSIFY_FUNCTION_NAME` | No | Cloud Function name for topic classification (default: `classifyTopic`) |
   | `DASHBOARD_URL` | No | Dashboard URL shown in the options UI |

3. **Generate the runtime config**

   ```bash
   node scripts/generate-env.mjs
   ```

   This reads `.env` and writes `env.js` into the project root. Both files are gitignored and must never be committed.

4. **Load the extension in Chrome**

   - Open `chrome://extensions`
   - Enable **Developer mode** (toggle in top-right)
   - Click **Load unpacked** and select the project folder
   - Pin the extension from the puzzle icon if you want it in the toolbar

5. **Create an account on the dashboard**

   - Open the dashboard URL (found in your `.env` or ask Adrian)
   - Sign up with your email via Firebase Authentication

6. **Verify it works**

   - Do a Google Search that triggers an AI Overview
   - Check the Firestore console or dashboard to confirm a record was created
   - If you see `http_403`, contact Adrian to confirm your account has been granted Firestore access

> **Reloading after changes:** Any time you edit source files or regenerate `env.js`, go to `chrome://extensions` and click **Reload** on the extension card.

---

## File Structure

```
AI-Overview-Tracker/
├── manifest.json           # Extension config (Manifest V3)
├── background.js           # Service worker — handles Firebase writes and alarms
├── content.js              # Content script — detects AI Overviews on google.com/search
├── popup.html / popup.js   # Extension popup UI
├── options.html / options.js / options.css  # Full settings page
├── env.js                  # Auto-generated from .env — DO NOT commit
├── .env                    # Local credentials — DO NOT commit
├── .env.example            # Template for .env
├── scripts/
│   └── generate-env.mjs    # Reads .env → writes env.js
└── icons/                  # Extension icons (16, 48, 128px)
```

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Store user preferences and session data locally |
| `alarms` | Schedule periodic data cleanup based on retention setting |
| `tabs` | Detect navigation events on Google Search tabs |
| `webNavigation` | Track page transitions for journey/dwell-time analysis |
| `host_permissions` (google.com) | Run content script on Google Search pages |
| `host_permissions` (Firebase) | Write to Firestore and call Cloud Functions directly from the extension |

---

## Troubleshooting

**AI Overviews not being detected**
Refresh the Google Search page after loading or reloading the extension. The content script only injects on page load.

**Data not appearing on the dashboard**
Confirm you're signed in with the same email on both the extension and dashboard. Check your browser console on a search page for errors.

**`http_403` errors**
Your Firebase account may not have Firestore read/write access yet. Contact Adrian.

**`env.js` missing errors in the console**
You haven't run `node scripts/generate-env.mjs` yet, or you ran it before creating `.env`.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Open a Pull Request against `main`

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contact

**Developer**: Aditya Dubey / SimPPL
