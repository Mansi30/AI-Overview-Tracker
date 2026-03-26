/**
 * AI Overview Tracker - Background Service Worker
 * Stores data locally - Dashboard pulls from Firestore
 */

try {
  importScripts('env.js');
} catch (error) {
  console.warn('env.js not found; Firebase-backed features may be unavailable.');
}

const ENV = globalThis.AIO_ENV || {};
const FIREBASE_PROJECT_ID = typeof ENV.FIREBASE_PROJECT_ID === 'string' ? ENV.FIREBASE_PROJECT_ID.trim() : '';
const FIREBASE_REGION = typeof ENV.FIREBASE_REGION === 'string' && ENV.FIREBASE_REGION.trim() ? ENV.FIREBASE_REGION.trim() : 'us-central1';
const CLASSIFY_FUNCTION_NAME = typeof ENV.CLASSIFY_FUNCTION_NAME === 'string' && ENV.CLASSIFY_FUNCTION_NAME.trim() ? ENV.CLASSIFY_FUNCTION_NAME.trim() : 'classifyTopic';
const CLASSIFY_FUNCTION_URL = FIREBASE_PROJECT_ID
  ? `https://${FIREBASE_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/${CLASSIFY_FUNCTION_NAME}`
  : '';
const FIRESTORE_BASE_URL = FIREBASE_PROJECT_ID
  ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`
  : '';

const DEFAULT_SEARCH_MODE_PREFERENCE = 'all';
const VALID_SEARCH_MODE_PREFERENCES = new Set(['all', 'random', 'normal', 'ai', 'no_ai']);

function normalizeSearchModePreference(value) {
  if (!VALID_SEARCH_MODE_PREFERENCES.has(value)) {
    return DEFAULT_SEARCH_MODE_PREFERENCE;
  }

  // Legacy "normal" maps to the new "all" option.
  if (value === 'normal') {
    return 'all';
  }

  return value;
}

function normalizeRetentionDays(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 90;
  }

  return Math.min(Math.max(parsed, 1), 3650);
}

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
      include_query_text: true,
      search_mode_preference: DEFAULT_SEARCH_MODE_PREFERENCE
    };
  } else {
    const normalizedMode = normalizeSearchModePreference(result.settings.search_mode_preference);
    if (result.settings.search_mode_preference !== normalizedMode) {
      updates.settings = {
        ...result.settings,
        search_mode_preference: normalizedMode
      };
    }
  }
  
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

// ==================== LLM TOPIC CLASSIFICATION ====================

async function handleClassifyTopic(request) {
  const query = request.query;
  
  if (!query || query.trim().length === 0) {
    return { topic: 'general' };
  }
  
  try {
    // Get stored user data (includes Firebase Auth ID token)
    const userData = await new Promise((resolve) => {
      chrome.storage.local.get(['userId', 'userAuthToken'], (data) => resolve(data));
    });
    
    if (!userData.userId) {
      console.warn('⚠️ User not authenticated, using fallback classification');
      return { topic: 'general' };
    }
    
    if (!userData.userAuthToken) {
      console.warn('⚠️ No Firebase ID token found, using fallback classification');
      return { topic: 'general' };
    }
    
    if (!CLASSIFY_FUNCTION_URL) {
      console.warn('⚠️ Missing Firebase env config for topic classification');
      return { topic: 'general' };
    }

    // Call secure Firebase Cloud Function (API key never exposed to client)
    const response = await fetch(CLASSIFY_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userData.userAuthToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      console.error('Firebase function error:', response.status, response.statusText);
      return { topic: 'general' };
    }
    
    const data = await response.json();
    
    if (data.topic) {
      return { topic: data.topic };
    } else {
      return { topic: 'general' };
    }
    
  } catch (error) {
    console.error('LLM classification error:', error);
    return { topic: 'general' };
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
  
  if (action === 'selectiveDelete') {
    handleSelectiveDelete(request).then(sendResponse);
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
  
  if (action === 'classifyTopic') {
    handleClassifyTopic(request).then(sendResponse);
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

  // Check if user is authenticated
  const { userId, userEmail } = await chrome.storage.local.get(['userId', 'userEmail']);
  if (!userId || !userEmail) {
    console.log('⏸️ Event tracking blocked - user not logged in');
    return { success: false, reason: 'user_not_authenticated' };
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
  let firestoreSynced = false;
  let firestoreReason = 'not_attempted';

  try {
    const syncResult = await syncToFirestore(eventData);
    firestoreSynced = Boolean(syncResult && syncResult.success);
    firestoreReason = syncResult && syncResult.reason ? syncResult.reason : 'unknown';
  } catch (err) {
    console.error('❌ Firestore sync error:', err);
    firestoreReason = 'sync_exception';
  }

  return {
    success: true,
    firestore_synced: firestoreSynced,
    firestore_reason: firestoreReason
  };
}

// ==================== FIRESTORE SYNC ====================

// ==================== FIRESTORE SYNC (WITH USER ID FIX) ====================

async function syncToFirestore(eventData) {
  try {
    if (!FIRESTORE_BASE_URL) {
      console.warn('⚠️ Missing Firebase env config for Firestore sync');
      return { success: false, reason: 'missing_env_config' };
    }
    
    // Get userId from authentication (Firebase Auth UID)
    const { userId, userEmail, userAuthToken } = await chrome.storage.local.get(['userId', 'userEmail', 'userAuthToken']);
    
    // If no userId, user hasn't logged in yet - skip sync
    if (!userId) {
      console.log('⏸️ Skipping Firestore sync - user not logged in');
      return { success: false, reason: 'user_not_logged_in' };
    }

    if (!userAuthToken) {
      console.log('⏸️ Skipping Firestore sync - missing auth token');
      return { success: false, reason: 'missing_auth_token' };
    }
    
    // Add email to event data if available (for user identification in dashboard)
    if (userEmail) {
      eventData.userEmail = userEmail;
    }
    
    const finalUserId = userId;
    
    const url = `${FIRESTORE_BASE_URL}/users/${finalUserId}/events`;
    
    const payload = {
      fields: convertToFirestoreFields(eventData)
    };

    console.log('📤 Sending to Firestore:', eventData.event_type, 'User:', finalUserId.substr(0, 15) + '...');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAuthToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Firestore HTTP ${response.status}:`, errorText);
      return { success: false, reason: `http_${response.status}` };
    }

    const result = await response.json();
    console.log('✅ Synced to Firestore:', eventData.event_type);
    return { success: true, reason: 'ok' };
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

async function handleSelectiveDelete(request) {
  const options = request.options;
  const result = await chrome.storage.local.get(['events', 'stats', 'userId', 'userAuthToken']);
  let events = result.events || [];
  let stats = result.stats || {
    total_searches: 0,
    ai_overview_shown: 0,
    total_citations_clicked: 0,
    sessions: [],
    first_event_date: null,
    last_event_date: null
  };
  
  const userId = result.userId;
  const userAuthToken = result.userAuthToken;

  // Only support date-based deletion (LIMITED TO 30 DAYS MAX)
  if (options.deleteByDate && options.dateRange) {
    const cutoffDate = new Date();
    const daysToDelete = Math.min(options.dateRange, 30); // Enforce 30-day maximum
    cutoffDate.setDate(cutoffDate.getDate() - daysToDelete);
    
    // Get events to delete for Firestore (only from the past 30 days)
    const eventsToDelete = events.filter(event => {
      const eventDate = new Date(event.timestamp);
      const now = new Date();
      const daysSinceEvent = (now - eventDate) / (1000 * 60 * 60 * 24);
      return eventDate >= cutoffDate && daysSinceEvent <= 30; // Only events within past 30 days
    });
    
    // Remove selected events from local storage
    events = events.filter(event => {
      const eventDate = new Date(event.timestamp);
      const now = new Date();
      const daysSinceEvent = (now - eventDate) / (1000 * 60 * 60 * 24);
      return !(eventDate >= cutoffDate && daysSinceEvent <= 30);
    });
    
    // Delete from Firestore
    if (userId && eventsToDelete.length > 0) {
      await deleteFirestoreEventsByDate(userId, userAuthToken, cutoffDate);
    }
    
    // Recalculate statistics from remaining events
    stats = {
      total_searches: 0,
      ai_overview_shown: 0,
      total_citations_clicked: 0,
      sessions: [],
      first_event_date: null,
      last_event_date: null
    };
    
    events.forEach(event => {
      updateStats(stats, event);
    });
  }

  // Save updated data
  await chrome.storage.local.set({
    events: events,
    stats: stats
  });

  return { success: true, message: 'Selected data deleted from browser and cloud' };
}

// Helper functions for Firestore deletion
async function deleteAllFirestoreEvents(userId, authToken) {
  try {
    if (!FIRESTORE_BASE_URL) {
      console.warn('⚠️ Missing Firebase env config for Firestore deletion');
      return;
    }

    const url = `${FIRESTORE_BASE_URL}/users/${userId}/events`;
    
    // Get all event IDs
    const listResponse = await fetch(url, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    
    if (!listResponse.ok) {
      console.error('Failed to list events for deletion');
      return;
    }
    
    const data = await listResponse.json();
    const documents = data.documents || [];
    
    // Delete each document
    for (const doc of documents) {
      const docPath = doc.name;
      await fetch(`https://firestore.googleapis.com/v1/${docPath}`, {
        method: 'DELETE',
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
      });
    }
    
    console.log(`✅ Deleted ${documents.length} events from Firestore`);
  } catch (error) {
    console.error('❌ Firestore deletion error:', error);
  }
}

async function deleteFirestoreEventsByDate(userId, authToken, cutoffDate) {
  try {
    if (!FIRESTORE_BASE_URL) {
      console.warn('⚠️ Missing Firebase env config for Firestore deletion by date');
      return;
    }

    const url = `${FIRESTORE_BASE_URL}/users/${userId}/events`;
    
    const listResponse = await fetch(url, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    
    if (!listResponse.ok) return;
    
    const data = await listResponse.json();
    const documents = data.documents || [];
    
    let deletedCount = 0;
    for (const doc of documents) {
      const timestamp = doc.fields.timestamp?.stringValue;
      if (timestamp) {
        const eventDate = new Date(timestamp);
        if (eventDate < cutoffDate) {
          await fetch(`https://firestore.googleapis.com/v1/${doc.name}`, {
            method: 'DELETE',
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
          });
          deletedCount++;
        }
      }
    }
    
    console.log(`✅ Deleted ${deletedCount} old events from Firestore`);
  } catch (error) {
    console.error('❌ Firestore date deletion error:', error);
  }
}

async function deleteFirestoreEventsByType(userId, authToken, eventTypes) {
  try {
    if (!FIRESTORE_BASE_URL) {
      console.warn('⚠️ Missing Firebase env config for Firestore deletion by type');
      return;
    }

    const url = `${FIRESTORE_BASE_URL}/users/${userId}/events`;
    
    const listResponse = await fetch(url, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });
    
    if (!listResponse.ok) return;
    
    const data = await listResponse.json();
    const documents = data.documents || [];
    
    let deletedCount = 0;
    for (const doc of documents) {
      const eventType = doc.fields.event_type?.stringValue;
      if (eventType && eventTypes.includes(eventType)) {
        await fetch(`https://firestore.googleapis.com/v1/${doc.name}`, {
          method: 'DELETE',
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        });
        deletedCount++;
      }
    }
    
    console.log(`✅ Deleted ${deletedCount} events of type ${eventTypes.join(', ')} from Firestore`);
  } catch (error) {
    console.error('❌ Firestore type deletion error:', error);
  }
}

// Settings
async function handleGetSettings() {
  const result = await chrome.storage.local.get('settings');
  const defaults = {
    tracking_enabled: true,
    auto_export: false,
    data_retention_days: 90,
    include_query_text: true,
    search_mode_preference: DEFAULT_SEARCH_MODE_PREFERENCE
  };

  const merged = {
    ...defaults,
    ...(result.settings || {})
  };

  merged.search_mode_preference = normalizeSearchModePreference(merged.search_mode_preference);
  merged.data_retention_days = normalizeRetentionDays(merged.data_retention_days);

  return merged;
}

async function handleSaveSettings(request) {
  if (!request.settings) {
    return { success: false, error: 'No settings provided' };
  }

  const incoming = request.settings;
  const normalizedSettings = {
    tracking_enabled: incoming.tracking_enabled !== false,
    auto_export: incoming.auto_export === true,
    data_retention_days: normalizeRetentionDays(incoming.data_retention_days),
    include_query_text: incoming.include_query_text !== false,
    search_mode_preference: normalizeSearchModePreference(incoming.search_mode_preference)
  };
  
  await chrome.storage.local.set({
    settings: normalizedSettings
  });
  
  return { success: true, settings: normalizedSettings };
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
