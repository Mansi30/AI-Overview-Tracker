/**
 * AI Overview Tracker - Background Service Worker
 * Stores data locally - Dashboard pulls from Firestore
 */

// ==================== INSTALLATION & USER ID ====================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('AI Overview Tracker installed:', details.reason);
  
  await initializeStorage();
  
  if (details.reason === 'install') {
    setTimeout(() => {
      chrome.tabs.create({ url: 'options.html' }).catch(err => {
        console.warn('Could not auto-open options:', err);
      });
    }, 100);
  }
});

async function initializeStorage() {
  const result = await chrome.storage.local.get(['events', 'stats', 'settings']);
  
  const updates = {};
  
  if (!result.events) {
    updates.events = [];
  }
  
  if (!result.stats) {
    updates.stats = {
      total_searches: 0,
      ai_overview_shown: 0,
      total_citations_clicked: 0,
      sessions: [],
      first_event_date: null,
      last_event_date: null
    };
  }
  
  if (!result.settings) {
    updates.settings = {
      tracking_enabled: true,
      auto_export: false,
      data_retention_days: 90,
      include_query_text: true
    };
  }
  
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) {
    sendResponse({ error: 'Invalid request' });
    return false;
  }

  const action = request.action;
  
  if (action === 'storeEvent') {
    handleStoreEvent(request).then(sendResponse);
    return true;
  }
  
  if (action === 'getStats') {
    handleGetStats().then(sendResponse);
    return true;
  }
  
  if (action === 'exportData') {
    handleExportData().then(sendResponse);
    return true;
  }
  
  if (action === 'clearData') {
    handleClearData().then(sendResponse);
    return true;
  }
  
  if (action === 'getSettings') {
    handleGetSettings().then(sendResponse);
    return true;
  }
  
  if (action === 'saveSettings') {
    handleSaveSettings(request).then(sendResponse);
    return true;
  }
  
  sendResponse({ error: 'Unknown action' });
  return false;
});

// Event storage
// ==================== EVENT STORAGE ====================

async function handleStoreEvent(request) {
  const eventData = request.data;
  
  if (!eventData) {
    return { success: false, reason: 'no_event_data' };
  }

  const { settings } = await chrome.storage.local.get('settings');
  if (settings && settings.tracking_enabled === false) {
    return { success: false, reason: 'tracking_disabled' };
  }

  const result = await chrome.storage.local.get(['events', 'stats']);
  const events = result.events || [];
  const stats = result.stats || {
    total_searches: 0,
    ai_overview_shown: 0,
    total_citations_clicked: 0,
    sessions: [],
    first_event_date: null,
    last_event_date: null
  };

  if (!eventData.timestamp) {
    eventData.timestamp = new Date().toISOString();
  }

  events.push(eventData);
  updateStats(stats, eventData);

  const retentionDays = settings && settings.data_retention_days ? settings.data_retention_days : 90;
  const retainedEvents = applyDataRetention(events, retentionDays);

  await chrome.storage.local.set({
    events: retainedEvents,
    stats: stats
  });

  console.log('✅ Event stored locally:', eventData.event_type);

  // 🔥 FIRESTORE SYNC
  try {
    await syncToFirestore(eventData);
  } catch (err) {
    console.error('❌ Firestore sync error:', err);
  }

  return { success: true };
}

// ==================== FIRESTORE SYNC ====================

// ==================== FIRESTORE SYNC (WITH USER ID FIX) ====================

async function syncToFirestore(eventData) {
  try {
    const projectId = 'ai-overview-extension-de';
    
    // Get userId from authentication (Firebase Auth UID)
    const { userId, userEmail } = await chrome.storage.local.get(['userId', 'userEmail']);
    
    // If no userId, user hasn't logged in yet - skip sync
    if (!userId) {
      console.log('⏸️ Skipping Firestore sync - user not logged in');
      return;
    }
    
    // Add email to event data if available (for user identification in dashboard)
    if (userEmail) {
      eventData.userEmail = userEmail;
    }
    
    const finalUserId = userId;
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${finalUserId}/events`;
    
    const payload = {
      fields: convertToFirestoreFields(eventData)
    };

    console.log('📤 Sending to Firestore:', eventData.event_type, 'User:', finalUserId.substr(0, 15) + '...');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Firestore HTTP ${response.status}:`, errorText);
      return;
    }

    const result = await response.json();
    console.log('✅ Synced to Firestore:', eventData.event_type);
  } catch (error) {
    console.error('❌ Firestore fetch error:', error);
    throw error;
  }
}

function convertToFirestoreFields(obj) {
  const fields = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      fields[key] = { integerValue: value.toString() };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (Array.isArray(value)) {
      fields[key] = {
        arrayValue: {
          values: value.map(v => {
            if (v === null || v === undefined) return { nullValue: null };
            if (typeof v === 'string') return { stringValue: v };
            if (typeof v === 'number') return { integerValue: v.toString() };
            if (typeof v === 'boolean') return { booleanValue: v };
            if (typeof v === 'object') return { mapValue: { fields: convertToFirestoreFields(v) } };
            return { stringValue: String(v) };
          })
        }
      };
    } else if (typeof value === 'object') {
      fields[key] = { mapValue: { fields: convertToFirestoreFields(value) } };
    } else {
      // Fallback for any other type
      fields[key] = { stringValue: String(value) };
    }
  }
  
  return fields;
}

function updateStats(stats, eventData) {
  const eventType = eventData.event_type;
  
  if (eventType === 'ai_overview_shown') {
    stats.total_searches++;
    stats.ai_overview_shown++;
    if (!stats.sessions.includes(eventData.session_id)) {
      stats.sessions.push(eventData.session_id);
    }
  } else if (eventType === 'search_without_ai_overview') {
    stats.total_searches++;
  } else if (eventType === 'citation_clicked') {
    stats.total_citations_clicked++;
  }

  if (!stats.first_event_date) {
    stats.first_event_date = eventData.timestamp;
  }
  stats.last_event_date = eventData.timestamp;
}

function applyDataRetention(events, retentionDays) {
  if (!events || events.length === 0) return [];
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  return events.filter(event => {
    const eventDate = new Date(event.timestamp);
    return eventDate >= cutoffDate;
  });
}

// Statistics
async function handleGetStats() {
  const result = await chrome.storage.local.get(['stats', 'events']);
  const stats = result.stats || {
    total_searches: 0,
    ai_overview_shown: 0,
    total_citations_clicked: 0,
    sessions: []
  };
  const events = result.events || [];

  const aiOverviewRate = stats.total_searches > 0
    ? ((stats.ai_overview_shown / stats.total_searches) * 100).toFixed(1)
    : 0;

  const aiOverviewEvents = events.filter(e => e.event_type === 'ai_overview_shown');
  const totalCitations = aiOverviewEvents.reduce((sum, e) => sum + (e.citation_count || 0), 0);
  const avgCitations = aiOverviewEvents.length > 0
    ? (totalCitations / aiOverviewEvents.length).toFixed(1)
    : 0;

  const clickThroughRate = totalCitations > 0
    ? ((stats.total_citations_clicked / totalCitations) * 100).toFixed(1)
    : 0;

  const domainCounts = {};
  const domainClicks = {};
  
  aiOverviewEvents.forEach(e => {
    if (e.cited_sources && Array.isArray(e.cited_sources)) {
      e.cited_sources.forEach(source => {
        if (source.domain) {
          domainCounts[source.domain] = (domainCounts[source.domain] || 0) + 1;
          if (source.clicked) {
            domainClicks[source.domain] = (domainClicks[source.domain] || 0) + 1;
          }
        }
      });
    }
  });

  const topDomains = Object.entries(domainCounts)
    .map(([domain, count]) => ({
      domain,
      count,
      clicks: domainClicks[domain] || 0,
      ctr: count > 0 ? (((domainClicks[domain] || 0) / count) * 100).toFixed(1) : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const clicksByDomain = {};
  const clickEvents = events.filter(e => e.event_type === 'citation_clicked');
  clickEvents.forEach(e => {
    if (e.citation_domain) {
      clicksByDomain[e.citation_domain] = (clicksByDomain[e.citation_domain] || 0) + 1;
    }
  });

  const topClickedDomains = Object.entries(clicksByDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  const dailyStats = calculateDailyStats(events, 7);
  const queryCategoryStats = calculateQueryCategoryStats(aiOverviewEvents);

  return {
    total_searches: stats.total_searches || 0,
    ai_overview_shown: stats.ai_overview_shown || 0,
    total_citations_clicked: stats.total_citations_clicked || 0,
    ai_overview_rate: parseFloat(aiOverviewRate),
    avg_citations_per_overview: parseFloat(avgCitations),
    click_through_rate: parseFloat(clickThroughRate),
    top_cited_domains: topDomains,
    top_clicked_domains: topClickedDomains,
    total_events: events.length,
    unique_sessions: stats.sessions ? stats.sessions.length : 0,
    daily_stats: dailyStats,
    query_category_stats: queryCategoryStats
  };
}

function calculateDailyStats(events, days) {
  const dailyData = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    dailyData[dateKey] = {
      date: dateKey,
      searches: 0,
      ai_overviews: 0,
      clicks: 0
    };
  }

  events.forEach(event => {
    const eventDate = new Date(event.timestamp);
    const dateKey = eventDate.toISOString().split('T')[0];
    
    if (dailyData[dateKey]) {
      if (event.event_type === 'ai_overview_shown') {
        dailyData[dateKey].searches++;
        dailyData[dateKey].ai_overviews++;
      } else if (event.event_type === 'search_without_ai_overview') {
        dailyData[dateKey].searches++;
      } else if (event.event_type === 'citation_clicked') {
        dailyData[dateKey].clicks++;
      }
    }
  });

  return Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));
}

function calculateQueryCategoryStats(events) {
  const categories = {};
  
  events.forEach(e => {
    const cat = e.query_category || 'general';
    if (!categories[cat]) {
      categories[cat] = { count: 0 };
    }
    categories[cat].count++;
  });
  
  return categories;
}

// Data export
async function handleExportData() {
  const result = await chrome.storage.local.get(['events', 'stats', 'settings']);
  
  return {
    events: result.events || [],
    stats: result.stats || {},
    settings: result.settings || {},
    exported_at: new Date().toISOString(),
    extension_version: '2.0.0'
  };
}

// Data management
async function handleClearData() {
  await chrome.storage.local.set({
    events: [],
    stats: {
      total_searches: 0,
      ai_overview_shown: 0,
      total_citations_clicked: 0,
      sessions: [],
      first_event_date: null,
      last_event_date: null
    }
  });
  
  return { success: true };
}

// Settings
async function handleGetSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || {
    tracking_enabled: true,
    auto_export: false,
    data_retention_days: 90,
    include_query_text: true
  };
}

async function handleSaveSettings(request) {
  if (!request.settings) {
    return { success: false, error: 'No settings provided' };
  }
  
  await chrome.storage.local.set({
    settings: request.settings
  });
  
  return { success: true };
}

// Periodic cleanup
chrome.alarms.create('dataCleanup', { periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'dataCleanup') {
    const result = await chrome.storage.local.get(['events', 'settings']);
    const events = result.events || [];
    const settings = result.settings || { data_retention_days: 90 };
    
    const retainedEvents = applyDataRetention(events, settings.data_retention_days);
    
    if (retainedEvents.length !== events.length) {
      console.log(`🧹 Cleaned up ${events.length - retainedEvents.length} old events`);
      await chrome.storage.local.set({ events: retainedEvents });
    }
  }
});

console.log('🚀 Background service worker initialized');
