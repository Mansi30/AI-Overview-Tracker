# 🔍 AI Overview Tracker - Chrome Extension

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-blue?logo=googlechrome)](https://ai-overview-extension-de.web.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Track, analyze, and gain insights from Google's AI Overview citations in real-time.**

AI Overview Tracker is a powerful Chrome extension designed for researchers, SEO professionals, content creators, and digital marketers who want to understand how Google's AI Overviews cite and display sources. Get comprehensive analytics on citation patterns, domain performance, click-through rates, and query trends—all synced to your personal dashboard.

---

## 🎯 Features

### 🔍 **Automatic AI Overview Detection**
- Instantly detects when Google displays an AI Overview in search results
- Captures the complete AI response text for analysis
- Works seamlessly across all Google Search sessions

### 📊 **Citation Tracking**
- Extracts all URLs and domains cited in AI Overviews
- Tracks citation position and prominence
- Records timestamps for temporal analysis
- Monitors which citations users click

### 📈 **Analytics Dashboard**
- Beautiful, real-time analytics dashboard
- Citation click-through rate (CTR) metrics
- Domain performance rankings
- Query topic categorization (Technology, Health, Finance, etc.)
- Time-series charts and trend analysis
- Session-based grouping of searches

### 🔐 **Privacy-First Design**
- All data stored in **YOUR** personal Firebase database
- No data sharing with third parties
- Complete user control over data retention (7, 15, 30, or 90 days)
- GDPR and CCPA compliant

### ⚡ **Real-Time Sync**
- Instant synchronization between extension and dashboard
- Cross-device data access
- Offline support with automatic sync when online

---

## 🚀 Installation

### Method 1: Chrome Web Store (Recommended)

1. Visit the [Chrome Web Store listing](https://chromewebstore.google.com/your-extension-link)
2. Click **"Add to Chrome"**
3. Click **"Add Extension"** in the confirmation dialog
4. The extension icon will appear in your Chrome toolbar

### Method 2: Manual Installation (Developer Mode)

Perfect for testing or if you want to use the latest development version:

1. **Download the Extension**
git clone https://github.com/YOUR-USERNAME/ai-overview-extension.git
cd ai-overview-extension

text

2. **Open Chrome Extensions Page**
- Navigate to `chrome://extensions/` in your Chrome browser
- Or click **Menu (⋮) → Extensions → Manage Extensions**

3. **Enable Developer Mode**
- Toggle the **"Developer mode"** switch in the top-right corner

4. **Load the Extension**
- Click **"Load unpacked"** button
- Select the extension folder you cloned/downloaded
- The extension will now appear in your extensions list

5. **Pin the Extension (Optional)**
- Click the puzzle icon 🧩 in Chrome toolbar
- Find "AI Overview Tracker"
- Click the pin icon 📌 to keep it visible

---

## 🔧 Setup & Configuration

### First-Time Setup

1. **Install the Extension** (see Installation above)

2. **Visit the Dashboard**
- Go to [https://ai-overview-extension-de.web.app](https://ai-overview-extension-de.web.app)
- Sign in with your email (Firebase Authentication)

3. **Configure Firebase (Automatic)**
- The extension automatically connects to your Firebase project
- All data is stored securely in your personal database

4. **Start Tracking!**
- Perform a Google Search
- If an AI Overview appears, tracking begins automatically
- View results in real-time on your dashboard

### Extension Settings

Click the extension icon to access:
- **Data Retention**: Set how long to keep tracked data (7-90 days)
- **Auto-Tracking**: Enable/disable automatic tracking
- **Clear Data**: Remove all tracked data
- **Dashboard Link**: Quick access to analytics

---

## 💡 How to Use

### Basic Usage

1. **Search on Google**
- Go to [google.com](https://www.google.com)
- Enter any search query

2. **AI Overview Appears**
- Extension automatically detects it
- Starts tracking citations and user interactions

3. **Click Citations (Optional)**
- Click any citation link in the AI Overview
- Extension records which citations get clicked

4. **View Analytics**
- Open the [dashboard](https://ai-overview-extension-de.web.app)
- See comprehensive analytics, charts, and insights

### Advanced Features

- **Topic Filtering**: Filter queries by auto-detected topic (Tech, Health, etc.)
- **Date Range Selection**: Analyze specific time periods
- **Domain Analysis**: See which domains get cited most
- **CTR Analysis**: Understand which citations get clicked
- **Export Data**: Download your data for external analysis

---

## 🛠️ Technical Details

### Built With

- **Manifest Version**: V3 (latest Chrome Extension standard)
- **Frontend**: Vanilla JavaScript (extension), React (dashboard)
- **Backend**: Firebase Firestore (NoSQL database)
- **Authentication**: Firebase Auth
- **Hosting**: Firebase Hosting
- **APIs**: Chrome Storage API, Chrome Tabs API

### File Structure

ai-overview-extension/
├── manifest.json # Extension configuration
├── background.js # Background service worker
├── content.js # Content script (runs on Google Search)
├── popup.html # Extension popup UI
├── popup.js # Popup logic
├── firebaseConfig.js # Firebase configuration
├── icons/ # Extension icons
│ ├── icon16.png
│ ├── icon48.png
│ └── icon128.png
└── README.md # This file

text

### Permissions Explained

The extension requests the following permissions:

| Permission | Justification |
|------------|---------------|
| `storage` | Store user preferences and temporary data locally |
| `activeTab` | Detect AI Overviews on the current Google Search tab |
| `host_permissions` | Access Google Search pages to extract AI Overview data |

**We do NOT:**
- Access your browsing history
- Track you across non-Google sites
- Collect personal information beyond what's in AI Overviews

---

## 🔐 Privacy & Security

Your privacy is our top priority:

- ✅ **Your Data, Your Control**: All data stored in YOUR Firebase database
- ✅ **No Data Sharing**: We never share, sell, or analyze your data
- ✅ **Transparent**: Open-source extension code (view on GitHub)
- ✅ **Configurable Retention**: You choose how long data is kept
- ✅ **Easy Deletion**: Clear all data with one click

**Privacy Policy**: [https://ai-overview-extension-de.web.app/privacy.html](https://ai-overview-extension-de.web.app/privacy.html)

---

## 🐛 Troubleshooting

### Extension Not Working?

**Problem**: AI Overviews not being detected
- **Solution**: Refresh the Google Search page after installing the extension
- **Check**: Make sure you're searching on google.com (not other Google domains)

**Problem**: Data not syncing to dashboard
- **Solution**: Check your internet connection
- **Check**: Verify you're logged into the dashboard with the same account

**Problem**: Extension icon not showing
- **Solution**: Pin the extension (click puzzle icon 🧩 → find extension → click pin 📌)

### Dashboard Issues

**Problem**: Login not working
- **Solution**: Clear browser cache and cookies
- **Check**: Use a supported browser (Chrome, Edge, Firefox)

**Problem**: Data not displaying
- **Solution**: Wait a few seconds for Firebase sync
- **Check**: Perform a new Google Search to generate data

---

## 📊 Use Cases

### For SEO Professionals
- Track which domains Google's AI cites most frequently
- Analyze citation patterns for competitive intelligence
- Understand how AI Overviews impact organic traffic

### For Researchers
- Study AI Overview citation behavior
- Collect data on query-response relationships
- Analyze topical trends in AI-generated content

### For Content Creators
- Identify high-authority sources Google trusts
- Understand citation opportunities in your niche
- Track your own domain's citation frequency

### For Digital Marketers
- Monitor brand mentions in AI Overviews
- Track CTR on cited sources
- Optimize content for AI Overview inclusion

---

## 🗓️ Roadmap

- [ ] Export data to CSV/JSON
- [ ] Browser notifications for tracked queries
- [ ] Chrome sync for cross-device settings
- [ ] API for programmatic access
- [ ] Competitor comparison tools

---

## 🤝 Contributing

Contributions are welcome! If you'd like to improve this extension:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 📧 Contact & Support

**Developer**: Aditya Dubey / SimPPL

**Email**: [adity.dubey1301@gmail.com](mailto:adity.dubey1301@gmail.com)

**Dashboard**: [https://ai-overview-extension-de.web.app](https://ai-overview-extension-de.web.app)

**Report Issues**: [GitHub Issues](https://github.com/YOUR-USERNAME/ai-overview-extension/issues)

---

## 🙏 Acknowledgments

- Firebase for backend infrastructure
- Google Chrome Extensions team for excellent documentation
- The open-source community for inspiration and tools

---

## ⭐ Star This Project

If you find this extension useful, please consider giving it a star on GitHub!

---
