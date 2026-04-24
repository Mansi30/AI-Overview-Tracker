/**
 * AI Overview Tracker - Background Service Worker
 * Stores data locally - Dashboard pulls from Firestore
 */

// ==================== JOURNEY TRACKING STATE ====================

// Store active journeys in memory
const activeJourneys = new Map(); // { tabId: journeyData }

// Journey configuration
const JOURNEY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const JOURNEY_MAX_DEPTH = 10; // Limit max navigation depth

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
const FIREBASE_WEB_API_KEY = typeof ENV.FIREBASE_WEB_API_KEY === 'string' ? ENV.FIREBASE_WEB_API_KEY.trim() : '';
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

// Exchange refreshToken for a fresh idToken using Secure Token API
async function attemptRefreshAndStore(refreshToken) {
  if (!refreshToken) return null;
  try {
    // Use the same API key as the frontend (.env) - public client key
    const API_KEY = 'AIzaSyDBOKEynotV7RKB2HMEldT9igso7WeBtMY';
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    });

    if (!res.ok) {
      const txt = await res.text();
      console.warn('Refresh token exchange failed:', res.status, txt);
      return null;
    }

    const data = await res.json();
    if (data && data.id_token) {
      await chrome.storage.local.set({ userAuthToken: data.id_token, userRefreshToken: data.refresh_token || refreshToken });
      return data.id_token;
    }

    return null;
  } catch (err) {
    console.error('Error exchanging refresh token:', err);
    return null;
  }
}

// ==================== JOURNEY TRACKING HELPERS ====================

function generateJourneyId() {
  return `journey_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateNodeId() {
  return `node_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function buildNavigationTree(navigationStack, rootUrl) {
  // Convert flat navigation stack into tree structure
  const root = {
    node_id: 'root',
    url: rootUrl,
    domain: extractDomainFromUrl(rootUrl),
    visited_at: navigationStack.length > 0 ? navigationStack[0].visited_at : new Date().toISOString(),
    dwell_time_ms: 0,
    children: []
  };

  const nodeMap = new Map();
  nodeMap.set(rootUrl, root);

  for (const node of navigationStack) {
    const parent = nodeMap.get(node.parent_url) || root;

    const treeNode = {
      node_id: node.node_id,
      url: node.url,
      domain: node.domain,
      visited_at: node.visited_at,
      dwell_time_ms: node.dwell_time_ms || 0,
      transition_type: node.transition_type,
      children: []
    };

    parent.children.push(treeNode);
    nodeMap.set(node.url, treeNode);
  }

  return root;
}

function calculateMaxDepth(node, currentDepth = 0) {
  if (!node.children || node.children.length === 0) {
    return currentDepth;
  }

  return Math.max(...node.children.map(child => calculateMaxDepth(child, currentDepth + 1)));
}

function extractDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function calculateTTL(days) {
  return Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60);
}

async function finalizeJourney(journey, end_reason) {
  try {
    // Build tree structure from navigation stack
    const tree = buildNavigationTree(journey.navigation_stack, journey.root_citation.url);

    // Calculate total journey time
    const startTime = new Date(journey.started_at).getTime();
    const endTime = Date.now();

    const journeyData = {
      journey_id: journey.journey_id,
      session_id: journey.session_id,
      query: journey.query,
      event_type: 'navigation_journey',

      started_at: journey.started_at,
      ended_at: new Date().toISOString(),
      end_reason: end_reason, // "tab_closed", "timeout", "max_depth_reached"

      root_citation: journey.root_citation,
      navigation_tree: tree,

      summary: {
        total_pages_visited: journey.navigation_stack.length + 1, // +1 for root
        max_depth: calculateMaxDepth(tree),
        total_journey_time_ms: endTime - startTime,
        domains_visited: [...new Set([journey.root_citation.domain, ...journey.navigation_stack.map(n => n.domain)])],
        unique_domains_count: new Set([journey.root_citation.domain, ...journey.navigation_stack.map(n => n.domain)]).size
      },

      // Data retention
      retention_days: 90,
      ttl: calculateTTL(90),
      created_at: new Date().toISOString()
    };

    // Store in local storage and sync to Firestore
    await handleStoreEvent({ data: journeyData });

    console.log('✅ Journey finalized:', journey.journey_id, 'Pages:', journeyData.summary.total_pages_visited);
  } catch (error) {
    console.error('❌ Failed to finalize journey:', error);
  }
}

// ==================== DWELL TIME TRACKING (TAB FOCUS) ====================
//
// Dwell time definition (from requirements):
// - start when the destination tab/window becomes active
// - end when that tab/window loses focus (next onActivated) or is removed
//
// We keep this state in-memory; it resets if the service worker is restarted.
const DWELL_PENDING_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
let pendingDwellClicks = []; // citations clicked but dwell start not yet assigned
let activeDwellByTabId = {}; // { [tabId]: { startTs, startIso, pending } }
let lastActivatedTabId = null;

function safeToUrlParts(maybeUrl) {
  try {
    const u = new URL(maybeUrl);
    return u;
  } catch {
    return null;
  }
}

function urlsMatchCitation(tabUrl, citationUrl) {
  if (!tabUrl || !citationUrl) return false;
  if (tabUrl === citationUrl) return true;

  const t = safeToUrlParts(tabUrl);
  const c = safeToUrlParts(citationUrl);
  if (!t || !c) return false;

  // Strong match: origin+pathname (ignore query params)
  if (t.origin === c.origin && t.pathname === c.pathname) return true;

  // Fallback match: hostname only (captures redirects landing on same site)
  return t.hostname === c.hostname;
}

function prunePendingDwellClicks(nowMs) {
  pendingDwellClicks = pendingDwellClicks.filter((p) => {
    if (!p.click_timestamp) return false;
    const clickTs = Date.parse(p.click_timestamp);
    if (Number.isNaN(clickTs)) return false;
    return nowMs - clickTs <= DWELL_PENDING_MAX_AGE_MS;
  });
}

function createCitationDwellEvent(pending, dwellStartTs, dwellEndTs) {
  return {
    session_id: pending.session_id,
    timestamp: new Date(dwellEndTs).toISOString(),
    event_type: 'citation_dwelled',

    // Query details
    query: pending.query,
    query_category: pending.query_category,
    query_topic: pending.query_topic,

    // Citation details
    citation_url: pending.citation_url,
    citation_domain: pending.citation_domain,
    citation_position: pending.citation_position,
    click_timestamp: pending.click_timestamp,

    // Dwell timings
    dwell_time_ms: Math.max(0, Math.round(dwellEndTs - dwellStartTs)),
    dwell_start_timestamp: new Date(dwellStartTs).toISOString(),
    dwell_end_timestamp: new Date(dwellEndTs).toISOString(),

    // Page context (where the user clicked from)
    page_url: pending.page_url,
    page_title: pending.page_title || null,

    // Data retention
    retention_days: pending.retention_days,
    ttl: pending.ttl,

    created_at: new Date().toISOString()
  };
}

async function maybeAssignDwellToTab(tabId, tabUrl) {
  // Only assign if this tab isn't already tracking dwell.
  if (activeDwellByTabId[tabId]) return;

  prunePendingDwellClicks(Date.now());
  if (!pendingDwellClicks.length) return;

  // Find all pending clicks that match this tab URL and choose the most recent click.
  const matches = pendingDwellClicks.filter((p) => urlsMatchCitation(tabUrl, p.citation_url));
  if (!matches.length) return;

  const best = matches.sort((a, b) => Date.parse(b.click_timestamp) - Date.parse(a.click_timestamp))[0];

  activeDwellByTabId[tabId] = {
    startTs: Date.now(),
    startIso: new Date().toISOString(),
    pending: best
  };

  // Ensure this click yields exactly one dwell event.
  pendingDwellClicks = pendingDwellClicks.filter((p) => p !== best);
}

async function endDwellForTab(tabId) {
  const record = activeDwellByTabId[tabId];
  if (!record) return;

  const endTs = Date.now();
  const dwellEvent = createCitationDwellEvent(record.pending, record.startTs, endTs);

  // Persist dwell event using the same pipeline as other events.
  try {
    await handleStoreEvent({ data: dwellEvent });
  } catch (err) {
    console.error('❌ Failed to store dwell event:', err);
  }

  delete activeDwellByTabId[tabId];
}

async function handleClassifyTopic(request) {
  const query = request.query;
  
  if (!query || query.trim().length === 0) {
    return { topic: 'general' };
  }

  // No function endpoint configured -> skip remote classification
  // and let the keyword fallback decide locally.
  if (!CLASSIFY_FUNCTION_URL) {
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

  // 🆕 NEW: Journey tracking
  if (action === 'startJourney') {
    const sourceTabId = sender.tab?.id;
    if (!sourceTabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return false;
    }

    // Create journey data
    const journey = {
      journey_id: generateJourneyId(),
      session_id: request.session_id,
      query: request.query,
      started_at: new Date().toISOString(),
      root_citation: {
        url: request.citation_url,
        domain: request.citation_domain,
        position: request.citation_position
      },
      navigation_stack: [],
      current_node: null,
      last_activity: Date.now(),
      waiting_for_first_nav: true,
      source_tab_id: sourceTabId // Track source tab
    };

    // Store journey temporarily - will be transferred to destination tab
    activeJourneys.set(sourceTabId, journey);
    console.log(`🗺️ Journey prepared on source tab ${sourceTabId}:`, journey.journey_id);

    sendResponse({ success: true, journey_id: journey.journey_id });
    return false;
  }

  sendResponse({ error: 'Unknown action' });
  return false;
});

// ==================== JOURNEY NAVIGATION LISTENERS ====================

// Listen to navigation events
chrome.webNavigation.onCommitted.addListener((details) => {
  const { tabId, url, transitionType, frameId } = details;

  // Only track main frame (not iframes)
  if (frameId !== 0) return;

  // Check if this tab has a journey
  let journey = activeJourneys.get(tabId);

  // If no journey on this tab, check if any journey is waiting for this URL
  if (!journey) {
    for (const [sourceTabId, waitingJourney] of activeJourneys.entries()) {
      if (waitingJourney.waiting_for_first_nav) {
        // Check if this navigation matches the citation URL
        if (url === waitingJourney.root_citation.url ||
            extractDomainFromUrl(url) === waitingJourney.root_citation.domain) {
          console.log(`🔀 Journey transferred from tab ${sourceTabId} to tab ${tabId}`);
          // Transfer journey to this tab
          journey = waitingJourney;
          activeJourneys.delete(sourceTabId);
          activeJourneys.set(tabId, journey);
          break;
        }
      }
    }
  }

  // Debug: Log all navigations
  console.log(`🔍 Navigation event - Tab ${tabId}, URL: ${extractDomainFromUrl(url)}, Journey exists: ${!!journey}`);

  if (!journey) return;

  // If this is the first navigation (to the citation URL), mark journey as started
  if (journey.waiting_for_first_nav) {
    // Check if we're navigating to the citation URL
    if (url === journey.root_citation.url || extractDomainFromUrl(url) === journey.root_citation.domain) {
      console.log(`🗺️ Journey started for tab ${tabId}: ${journey.journey_id}`);
      delete journey.waiting_for_first_nav;
      journey.last_activity = Date.now();
      // Don't add to navigation_stack yet, this is the root
      return;
    }
  }

  console.log(`✅ Processing navigation for journey ${journey.journey_id}, stack length: ${journey.navigation_stack.length}`);

  // Check if we've reached max depth
  if (journey.navigation_stack.length >= JOURNEY_MAX_DEPTH) {
    console.log(`⚠️ Journey max depth reached for tab ${tabId}`);
    finalizeJourney(journey, 'max_depth_reached');
    activeJourneys.delete(tabId);
    return;
  }

  // Create a new node for this navigation
  const parentUrl = journey.navigation_stack.length > 0
    ? journey.navigation_stack[journey.navigation_stack.length - 1].url
    : journey.root_citation.url;

  const node = {
    node_id: generateNodeId(),
    url: url,
    domain: extractDomainFromUrl(url),
    visited_at: new Date().toISOString(),
    transition_type: transitionType, // "link", "typed", "reload", etc.
    parent_url: parentUrl,
    dwell_time_ms: 0
  };

  // Calculate dwell time for previous node
  if (journey.current_node) {
    const dwellStartTime = new Date(journey.current_node.visited_at).getTime();
    const dwellEndTime = Date.now();
    journey.current_node.dwell_time_ms = dwellEndTime - dwellStartTime;

    console.log(`⏱️ Dwell time on ${journey.current_node.domain}: ${journey.current_node.dwell_time_ms}ms`);
  } else if (!journey.waiting_for_first_nav) {
    // This is the first real navigation after landing on citation page
    // Create a node for the root citation
    journey.current_node = {
      node_id: 'root',
      url: journey.root_citation.url,
      domain: journey.root_citation.domain,
      visited_at: journey.started_at,
      dwell_time_ms: Date.now() - new Date(journey.started_at).getTime()
    };
    console.log(`⏱️ Dwell time on ${journey.current_node.domain}: ${journey.current_node.dwell_time_ms}ms`);
  }

  journey.navigation_stack.push(node);
  journey.current_node = node;
  journey.last_activity = Date.now();

  console.log(`📍 Journey navigation [${journey.navigation_stack.length}]: ${extractDomainFromUrl(url)}`);
});

// Track when tab is closed - finalize journey
chrome.tabs.onRemoved.addListener((tabId) => {
  const journey = activeJourneys.get(tabId);
  if (journey) {
    console.log(`🚪 Tab ${tabId} closed, finalizing journey`);
    finalizeJourney(journey, 'tab_closed');
    activeJourneys.delete(tabId);
  }

  // Also handle dwell time tracking (existing code)
  endDwellForTab(tabId).catch(() => {});
});

// Check for inactive journeys (timeout after 5 minutes)
setInterval(() => {
  const now = Date.now();

  for (const [tabId, journey] of activeJourneys.entries()) {
    if (now - journey.last_activity > JOURNEY_TIMEOUT_MS) {
      console.log(`⏱️ Journey timeout for tab ${tabId}`);
      finalizeJourney(journey, 'timeout');
      activeJourneys.delete(tabId);
    }
  }
}, 60000); // Check every minute

// ==================== DWELL-TIME LISTENERS ====================
//
// We use tab focus changes to measure dwell time on external citation destinations.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const newTabId = activeInfo.tabId;

  // End dwell for the previously-active tab (if any).
  if (lastActivatedTabId !== null && lastActivatedTabId !== newTabId) {
    try {
      await endDwellForTab(lastActivatedTabId);
    } catch (err) {
      console.error('❌ Failed ending dwell:', err);
    }
  }

  lastActivatedTabId = newTabId;

  // Start dwell on the newly active tab (if it matches a pending citation click).
  try {
    const tab = await chrome.tabs.get(newTabId);
    await maybeAssignDwellToTab(newTabId, tab && tab.url);
  } catch (err) {
    // Ignore failures (tab may not be accessible yet)
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // When navigation finishes in an already-active tab, we may now be able to match URL.
  if (changeInfo.status === 'complete' && tab && tab.active) {
    maybeAssignDwellToTab(tabId, tab.url).catch(() => {});
  }
});

// Note: chrome.tabs.onRemoved is now handled in the JOURNEY NAVIGATION LISTENERS section above

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

  // ==================== DWELL (pending assignment) ====================
  // When a citation is clicked, we start tracking dwell time once its destination
  // tab becomes active and end it when that tab loses focus.
  if (eventData.event_type === 'citation_clicked' && eventData.citation_url) {
    pendingDwellClicks.push({
      session_id: eventData.session_id,
      query: eventData.query,
      query_category: eventData.query_category,
      query_topic: eventData.query_topic,

      citation_url: eventData.citation_url,
      citation_domain: eventData.citation_domain,
      citation_position: eventData.citation_position,

      click_timestamp: eventData.click_timestamp || eventData.timestamp,
      page_url: eventData.page_url,
      page_title: eventData.page_title,

      retention_days: eventData.retention_days,
      ttl: eventData.ttl
    });

    prunePendingDwellClicks(Date.now());

    // Best-effort: if the destination tab is already active, start dwell immediately.
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        for (const tab of tabs) {
          if (tab && tab.id != null) {
            maybeAssignDwellToTab(tab.id, tab.url).catch(() => {});
          }
        }
      });
    } catch {
      // No-op
    }
  }

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

// ==================== TOKEN REFRESH ====================

async function refreshAuthToken() {
  const { userRefreshToken } = await chrome.storage.local.get('userRefreshToken');
  if (!userRefreshToken) {
    console.warn('⚠️ No refresh token stored — user must log in again');
    return null;
  }
  if (!FIREBASE_WEB_API_KEY) {
    console.warn('⚠️ Missing FIREBASE_WEB_API_KEY — cannot refresh token');
    return null;
  }

  try {
    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(userRefreshToken)}`
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('❌ Token refresh failed:', response.status, err);
      return null;
    }

    const data = await response.json();
    // data.id_token is the new Firebase ID token; data.refresh_token may be rotated
    await chrome.storage.local.set({
      userAuthToken: data.id_token,
      userRefreshToken: data.refresh_token
    });
    console.log('🔄 Firebase ID token refreshed successfully');
    return data.id_token;
  } catch (error) {
    console.error('❌ Token refresh error:', error);
    return null;
  }
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
    const { userId, userEmail, userAuthToken, query_language } = await chrome.storage.local.get(['userId', 'userEmail', 'userAuthToken', 'query_language']);

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

    const querySlug = eventData.query
      ? eventData.query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      : 'no-query';
    const ts = new Date(eventData.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const docId = `${ts}_${eventData.event_type}_${querySlug}`;

    const collection = query_language || 'events';
    const url = `${FIRESTORE_BASE_URL}/users/${finalUserId}/${collection}/${encodeURIComponent(docId)}`;

    const payload = {
      fields: convertToFirestoreFields(eventData)
    };

    console.log('📤 Sending to Firestore:', eventData.event_type, 'User:', finalUserId.substr(0, 15) + '...');

    let activeToken = userAuthToken;
    let response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${activeToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // On 401 the ID token has expired — attempt a silent refresh and retry once.
    if (response.status === 401) {
      console.warn('🔄 Auth token expired, attempting refresh...');
      const newToken = await refreshAuthToken();
      if (newToken) {
        activeToken = newToken;
        response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${activeToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      }
    }

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

async function broadcastSettingsUpdated(settings) {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (typeof tab.id !== 'number') {
          return Promise.resolve();
        }

        return chrome.tabs.sendMessage(tab.id, {
          action: 'settingsUpdated',
          settings
        }).catch(() => {
          // Ignore tabs without this content script.
        });
      })
    );
  } catch (error) {
    console.warn('⚠️ Failed to broadcast settings update:', error);
  }
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
    settings: {
      ...normalizedSettings,
      _updated_at: Date.now()
    }
  });

  await broadcastSettingsUpdated(normalizedSettings);
  
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
