/**
 * AI Overview Tracker - Enhanced Content Script V3
 * ✅ Topic Classification (Tech, Health, Business, etc.)
 * ✅ Tracks citations with metadata, click status, timestamps
 * ✅ Firebase-ready data structure
 */

(function() {
  'use strict';

  const CONFIG = {
    DEBOUNCE_DELAY: 1000,
    SESSION_ID: generateSessionId(),
    TRACKED_QUERIES: new Set(),
    AI_OVERVIEW_FOUND: null,
    MODE_REDIRECT_PENDING: false
  };

  const SCHEMA_VERSION =
    globalThis.AIO_SCHEMA && globalThis.AIO_SCHEMA.VERSION
      ? globalThis.AIO_SCHEMA.VERSION
      : '1.0.0';

  const DEFAULT_SEARCH_MODE_PREFERENCE = 'all';
  const SEARCH_MODE_TO_UDM = {
    ai: '50',
    no_ai: '14'
  };
  const RANDOM_MODE_UDM_VALUES = ['50', '14'];
  const MODE_REDIRECT_GUARD_KEY = 'aio_mode_redirect_guard';
  const MODE_REDIRECT_GUARD_WINDOW_MS = 4000;
  const MODE_REDIRECT_GUARD_MAX_COUNT = 2;
  const MODE_ENFORCED_QUERIES_KEY = 'aio_mode_enforced_queries';
  const MODE_ENFORCED_QUERIES_MAX_ENTRIES = 50;

  function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  function getSearchQuery() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('q') || '';
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function isExtensionContextValid() {
    try {
      chrome.runtime.getURL('');
      return true;
    } catch (e) {
      return false;
    }
  }

  function normalizeSearchModePreference(value) {
    if (value === 'ai' || value === 'no_ai') {
      return value;
    }

    if (value === 'random') {
      return 'random';
    }

    // Keep old saved values compatible.
    if (value === 'all' || value === 'normal') {
      return 'all';
    }

    return DEFAULT_SEARCH_MODE_PREFERENCE;
  }

  function selectRandomSearchModeUdm() {
    const index = Math.floor(Math.random() * RANDOM_MODE_UDM_VALUES.length);
    return RANDOM_MODE_UDM_VALUES[index];
  }

  function getModeRedirectGuard() {
    try {
      const raw = sessionStorage.getItem(MODE_REDIRECT_GUARD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setModeRedirectGuard(targetUrl) {
    const now = Date.now();
    const previous = getModeRedirectGuard();
    const sameTargetRecent =
      previous &&
      previous.targetUrl === targetUrl &&
      now - previous.timestamp < MODE_REDIRECT_GUARD_WINDOW_MS;

    const next = {
      targetUrl,
      timestamp: now,
      count: sameTargetRecent ? previous.count + 1 : 1
    };

    sessionStorage.setItem(MODE_REDIRECT_GUARD_KEY, JSON.stringify(next));
  }

  function shouldSkipModeRedirect(targetUrl) {
    const guard = getModeRedirectGuard();
    if (!guard) {
      return false;
    }

    const now = Date.now();
    return (
      guard.targetUrl === targetUrl &&
      now - guard.timestamp < MODE_REDIRECT_GUARD_WINDOW_MS &&
      guard.count >= MODE_REDIRECT_GUARD_MAX_COUNT
    );
  }

  function clearModeRedirectGuard() {
    sessionStorage.removeItem(MODE_REDIRECT_GUARD_KEY);
  }

  function getModeEnforcedQueries() {
    try {
      const raw = sessionStorage.getItem(MODE_ENFORCED_QUERIES_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveModeEnforcedQueries(state) {
    try {
      sessionStorage.setItem(MODE_ENFORCED_QUERIES_KEY, JSON.stringify(state));
    } catch {
      // Ignore sessionStorage quota errors.
    }
  }

  function hasHandledQueryPreference(query, preference) {
    if (!query) {
      return false;
    }

    const state = getModeEnforcedQueries();
    return Boolean(state[`${preference}::${query}`]);
  }

  function markQueryPreferenceHandled(query, preference) {
    if (!query) {
      return;
    }

    const state = getModeEnforcedQueries();
    const key = `${preference}::${query}`;
    state[key] = Date.now();

    const entries = Object.entries(state);
    if (entries.length > MODE_ENFORCED_QUERIES_MAX_ENTRIES) {
      entries
        .sort((a, b) => Number(a[1]) - Number(b[1]))
        .slice(0, entries.length - MODE_ENFORCED_QUERIES_MAX_ENTRIES)
        .forEach(([entryKey]) => {
          delete state[entryKey];
        });
    }

    saveModeEnforcedQueries(state);
  }

  function isGoogleSearchURL(url) {
    try {
      const parsed = new URL(url);
      return (
        (parsed.hostname === 'www.google.com' || parsed.hostname === 'google.com') &&
        parsed.pathname === '/search'
      );
    } catch {
      return false;
    }
  }

  function computePreferredSearchUrl(currentUrl, preference) {
    if (!isGoogleSearchURL(currentUrl)) {
      return null;
    }

    const parsed = new URL(currentUrl);
    if (!parsed.searchParams.get('q')) {
      return null;
    }

    const normalizedPreference = normalizeSearchModePreference(preference);
    const targetUdm = SEARCH_MODE_TO_UDM[normalizedPreference] || null;
    const currentUdm = parsed.searchParams.get('udm');

    if (targetUdm) {
      if (currentUdm === targetUdm) {
        return null;
      }

      parsed.searchParams.set('udm', targetUdm);
      return parsed.toString();
    }

    if (normalizedPreference === 'random') {
      if (RANDOM_MODE_UDM_VALUES.includes(currentUdm)) {
        return null;
      }

      parsed.searchParams.set('udm', selectRandomSearchModeUdm());
      return parsed.toString();
    }

    if (!currentUdm) {
      return null;
    }

    parsed.searchParams.delete('udm');
    return parsed.toString();
  }

  async function getSearchModePreference() {
    if (!isExtensionContextValid()) {
      return DEFAULT_SEARCH_MODE_PREFERENCE;
    }

    try {
      const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
      return normalizeSearchModePreference(settings && settings.search_mode_preference);
    } catch (error) {
      console.warn('⚠️ Failed to read search mode preference:', error);
      return DEFAULT_SEARCH_MODE_PREFERENCE;
    }
  }

  async function enforceSearchModePreference() {
    const preference = await getSearchModePreference();
    const query = getSearchQuery();

    // Apply opening mode once per query so users can switch tabs manually after load.
    if (hasHandledQueryPreference(query, preference)) {
      CONFIG.MODE_REDIRECT_PENDING = false;
      clearModeRedirectGuard();
      return false;
    }

    const targetUrl = computePreferredSearchUrl(window.location.href, preference);
    markQueryPreferenceHandled(query, preference);

    if (!targetUrl) {
      CONFIG.MODE_REDIRECT_PENDING = false;
      clearModeRedirectGuard();
      return false;
    }

    if (shouldSkipModeRedirect(targetUrl)) {
      console.warn('⚠️ Skipping repeated mode redirect to avoid loop');
      CONFIG.MODE_REDIRECT_PENDING = false;
      return false;
    }

    CONFIG.MODE_REDIRECT_PENDING = true;
    setModeRedirectGuard(targetUrl);
    window.location.replace(targetUrl);
    return true;
  }

  // ==================== VISIBILITY CHECK ====================
  
  function isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    
    if (style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0') {
      return false;
    }
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    if (rect.top > window.innerHeight) {
      return false;
    }
    
    return true;
  }

  // ==================== AI OVERVIEW DETECTION ====================
  
  function findAIOverviewContainer() {
    console.log('🔍 Searching for VISIBLE "AI Overview" heading...');
    
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let textNode;
    const matchingHeadings = [];
    
    while (textNode = walker.nextNode()) {
      if (textNode.textContent.trim() === 'AI Overview' ||
          textNode.textContent.trim() === 'AI overview') {
        
        let parent = textNode.parentElement;
        
        while (parent && parent !== document.body) {
          const tagName = parent.tagName.toLowerCase();
          
          if (['h1', 'h2', 'h3', 'button', 'div'].includes(tagName)) {
            if (parent.textContent.trim().split('\n')[0].trim() === 'AI Overview' ||
                parent.textContent.trim() === 'AI Overview') {
              
              if (isElementVisible(parent)) {
                console.log(`  ✅ Found VISIBLE "AI Overview" heading`);
                console.log(`     Tag: <${tagName}>`);
                matchingHeadings.push(parent);
                break;
              } else {
                console.log(`  ❌ "AI Overview" found but NOT visible`);
              }
            }
          }
          
          parent = parent.parentElement;
        }
      }
    }
    
    console.log(`  Found ${matchingHeadings.length} visible "AI Overview" headings`);
    
    if (matchingHeadings.length === 0) {
      console.log('❌ No visible AI Overview heading found');
      return null;
    }
    
    for (const heading of matchingHeadings) {
      console.log(`\n  Processing heading...`);
      
      let container = heading;
      let depth = 0;
      
      while (container && depth < 15) {
        const text = container.textContent || '';
        const links = container.querySelectorAll('a[href]');
        
        const realCitations = Array.from(links).filter(link => {
          const href = link.href;
          return href && 
                 !href.includes('google.com/search') &&
                 !href.includes('support.google') &&
                 !href.includes('accounts.google') &&
                 !href.includes('policies.google') &&
                 !href.includes('consent.google') &&
                 !href.startsWith('#') &&
                 !href.startsWith('javascript:');
        });
        
        if (text.includes('AI Overview') && 
            text.length > 300 && 
            realCitations.length >= 3) {
          
          console.log(`  ✅ FOUND REAL AI OVERVIEW CONTAINER`);
          console.log(`     Depth: ${depth} levels from heading`);
          console.log(`     Content: ${text.length} chars`);
          console.log(`     Real citations: ${realCitations.length}`);
          
          container.setAttribute('data-ai-overview-container', 'true');
          return container;
        }
        
        container = container.parentElement;
        depth++;
      }
    }
    
    console.log('❌ No valid AI Overview container found');
    return null;
  }

  // ==================== ENHANCED DATA EXTRACTION ====================
  
  function extractCitations(aiOverviewContainer) {
    const citations = [];
    const seenUrls = new Set();
    
    const allLinks = aiOverviewContainer.querySelectorAll('a[href]');
    console.log(`🔗 Extracting citations from ${allLinks.length} total links...`);
    
    allLinks.forEach((link) => {
      const href = link.href;
      
      // Filter out Google domains and invalid URLs
      const domain = extractDomain(href);
      const isGoogleDomain = domain && (domain === 'google.com' || domain.endsWith('.google.com'));
      
      if (href && 
          !isGoogleDomain &&
          !href.startsWith('javascript:') &&
          !href.startsWith('#') &&
          !href.startsWith('about:') &&
          !seenUrls.has(href)) {
        
        seenUrls.add(href);
        
        const citation = {
          url: href,
          domain: extractDomain(href),
          position: citations.length + 1,
          text: link.textContent.trim() || link.getAttribute('aria-label') || '',
          title: link.getAttribute('title') || '',
          
          // Click tracking
          clicked: false,
          click_timestamp: null,
          time_to_click_ms: null,
          
          // Metadata
          detected_at: new Date().toISOString(),
          element_selector: generateSelector(link),
          
          // Data retention
          ttl: calculateTTL(90)
        };
        
        citations.push(citation);
        console.log(`  📎 Citation ${citation.position}: ${citation.domain}`);
      }
    });

    console.log(`✅ Extracted ${citations.length} valid citations`);
    return citations;
  }

  function generateSelector(element) {
    if (element.id) return `#${element.id}`;
    
    let path = [];
    let el = element;
    
    while (el && el !== document.body) {
      const tag = el.tagName.toLowerCase();
      let selector = tag;
      
      if (el.className) {
        selector += '.' + el.className.split(' ').join('.');
      }
      
      path.unshift(selector);
      el = el.parentElement;
    }
    
    return path.join(' > ');
  }

  function calculateTTL(days) {
    return Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60);
  }

  function extractAIResponseText(aiOverviewContainer) {
    const clone = aiOverviewContainer.cloneNode(true);
    clone.querySelectorAll('script, style, svg, img, button, input').forEach(el => el.remove());
    
    const text = clone.textContent || '';
    return text.trim().substring(0, 5000);
  }

  // ==================== 🆕 TOPIC CLASSIFICATION ====================
  
  async function determineQueryTopic(query) {
    // Try LLM-based classification first (for multilingual support)
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'classifyTopic',
        query: query
      });
      
      if (response && response.topic && response.topic !== 'general') {
        console.log(`🤖 LLM classified "${query}" as: ${response.topic}`);
        return response.topic;
      }
    } catch (error) {
      console.warn('⚠️ LLM classification failed, falling back to keyword matching:', error);
    }
    
    // Fallback to keyword-based classification (English only)
    const lowerQuery = query.toLowerCase();
    
    // Technology
    if (lowerQuery.match(/\b(ai|artificial intelligence|machine learning|ml|python|javascript|java|coding|programming|software|tech|computer|web|app|developer|database|algorithm|cloud|extension|html|css|react|node|api|github|code|debug|compile)\b/)) {
      return 'technology';
    }
    
    // Business/Marketing
    if (lowerQuery.match(/\b(marketing|business|sales|seo|advertising|brand|startup|company|revenue|profit|strategy|management|entrepreneur|commerce|product|service)\b/)) {
      return 'business';
    }
    
    // Politics
    if (lowerQuery.match(/\b(election|president|government|politics|vote|congress|senate|policy|law|democrat|republican|minister|parliament|political)\b/)) {
      return 'politics';
    }
    
    // Entertainment
    if (lowerQuery.match(/\b(movie|film|actor|actress|celebrity|drama|series|show|netflix|tv|entertainment|music|song|concert|band|album|artist|streaming)\b/)) {
      return 'entertainment';
    }
    
    // Sports
    if (lowerQuery.match(/\b(football|basketball|cricket|soccer|sports|game|player|team|match|tournament|league|championship|athlete|olympic|fifa|nba|ipl)\b/)) {
      return 'sports';
    }
    
    // Health/Fitness
    if (lowerQuery.match(/\b(health|medical|doctor|disease|medicine|hospital|treatment|symptom|diet|fitness|skinny|fat|weight|muscle|lose|exercise|workout|nutrition|vitamin|therapy)\b/)) {
      return 'health';
    }
    
    // Science
    if (lowerQuery.match(/\b(science|research|study|experiment|biology|chemistry|physics|astronomy|space|laboratory|scientist|hypothesis|theory|discovery)\b/)) {
      return 'science';
    }
    
    // Finance
    if (lowerQuery.match(/\b(stock|investment|finance|money|bank|crypto|bitcoin|trading|market|economy|currency|forex|portfolio|dividend|asset)\b/)) {
      return 'finance';
    }
    
    // Education
    if (lowerQuery.match(/\b(school|university|college|education|learning|course|degree|student|teacher|exam|study|academic|tutorial|lesson)\b/)) {
      return 'education';
    }
    
    // Travel
    if (lowerQuery.match(/\b(travel|hotel|flight|vacation|tourism|destination|trip|booking|airline|resort|passport|visa|adventure)\b/)) {
      return 'travel';
    }
    
    return 'general';
  }

  // ==================== EVENT TRACKING ====================
  
  async function storeEvent(eventData) {
    if (!isExtensionContextValid()) {
      console.warn('⚠️ Extension reloaded. Refresh page.');
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        action: 'storeEvent',
        data: eventData
      });
      console.log('✅ Event stored:', eventData.event_type);
    } catch (e) {
      if (e.message.includes('Extension context invalidated')) {
        console.warn('⚠️ Extension context lost. Refresh page.');
      }
    }
  }

  async function trackAIOverviewShown(aiOverviewContainer, query) {
    const citations = extractCitations(aiOverviewContainer);
    const aiResponseText = extractAIResponseText(aiOverviewContainer);
    const queryTopic = await determineQueryTopic(query);
    
    const eventData = {
      session_id: CONFIG.SESSION_ID,
      timestamp: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
      event_type: 'ai_overview_shown',
      
      // Query details
      query: query,
      query_category: categorizeQuery(query),
      query_topic: queryTopic,  // 🆕 TOPIC!
      
      // AI Overview details
      ai_overview_present: true,
      ai_response_text: aiResponseText,
      ai_response_length: aiResponseText.length,
      
      // Citations with metadata
      cited_sources: citations,
      citation_count: citations.length,
      
      // Page context
      page_url: window.location.href,
      page_title: document.title,
      
      // Data retention
      retention_days: 90,
      ttl: calculateTTL(90),
      
      // System fields
      created_at: new Date().toISOString()
    };

    storeEvent(eventData);
    console.log(`📊 Tracked AI Overview: "${query}" (${eventData.query_topic}) with ${citations.length} citations`);
    
    return citations;
  }

  async function trackCitationClick(citationData, query, timeToClick) {
    const queryTopic = await determineQueryTopic(query);
    const eventData = {
      session_id: CONFIG.SESSION_ID,
      timestamp: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
      event_type: 'citation_clicked',
      
      // Citation details
      query: query,
      query_topic: queryTopic,  // 🆕 TOPIC!
      citation_url: citationData.url,
      citation_domain: citationData.domain,
      citation_position: citationData.position,
      citation_text: citationData.text,
      
      // Click metadata
      time_to_click_ms: timeToClick,
      click_timestamp: new Date().toISOString(),
      
      // Page context
      page_url: window.location.href,
      
      // Data retention
      retention_days: 90,
      ttl: calculateTTL(90),
      
      // System fields
      created_at: new Date().toISOString()
    };

    storeEvent(eventData);
    console.log(`🖱️ Citation clicked: Position ${citationData.position} - ${citationData.domain} (${timeToClick}ms)`);
  }

  async function trackSearchWithoutAIOverview(query) {
    const queryTopic = await determineQueryTopic(query);
    const eventData = {
      session_id: CONFIG.SESSION_ID,
      timestamp: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
      event_type: 'search_without_ai_overview',
      
      query: query,
      query_category: categorizeQuery(query),
      query_topic: queryTopic,  // 🆕 TOPIC!
      ai_overview_present: false,
      
      page_url: window.location.href,
      
      // Data retention
      retention_days: 90,
      ttl: calculateTTL(90),
      
      created_at: new Date().toISOString()
    };

    storeEvent(eventData);
    console.log(`📭 No AI Overview for: "${query}" (${eventData.query_topic})`);
  }

  function categorizeQuery(query) {
    const lower = query.toLowerCase();
    
    if (lower.match(/how|why|what|when|where|who/i)) return 'informational';
    if (lower.match(/buy|price|cost|cheap/i)) return 'commercial';
    if (lower.match(/visit|site:|official/i)) return 'navigational';
    if (lower.match(/vs|compare|difference/i)) return 'comparative';
    
    return 'general';
  }

  // ==================== CLICK TRACKING ====================
  
  function setupClickTracking(aiOverviewContainer, citations, query) {
    const links = aiOverviewContainer.querySelectorAll('a[href]');
    const overviewDetectionTime = Date.now();
    
    console.log(`🔗 Setting up click tracking for ${links.length} links`);
    
    links.forEach(link => {
      const href = link.href;
      const citation = citations.find(c => c.url === href);
      
      if (citation) {
        link.setAttribute('data-ai-citation', 'true');
        link.setAttribute('data-citation-position', citation.position);
        
        if (link._aiClickHandler) {
          link.removeEventListener('click', link._aiClickHandler);
        }
        
        link._aiClickHandler = (e) => {
          const timeToClick = Date.now() - overviewDetectionTime;
          trackCitationClick(citation, query, timeToClick);
        };
        
        link.addEventListener('click', link._aiClickHandler, { 
          passive: true, 
          capture: true 
        });
      }
    });
  }

  // ==================== CLEANUP ====================
  
  function cleanup() {
    console.log('🧹 Cleaning up event listeners...');
    
    document.querySelectorAll('[data-ai-citation]').forEach(link => {
      if (link._aiClickHandler) {
        link.removeEventListener('click', link._aiClickHandler);
        delete link._aiClickHandler;
      }
    });
  }

  // ==================== MAIN DETECTION ====================
  
  async function detectAndTrackAIOverviews() {
    if (CONFIG.MODE_REDIRECT_PENDING) {
      return;
    }

    const query = getSearchQuery();
    
    if (!query) {
      console.log('⚠️ No query');
      return;
    }

    const queryKey = `${query}_${window.location.href}`;
    
    if (CONFIG.TRACKED_QUERIES.has(queryKey)) {
      console.log('⏭️ Already tracked');
      return;
    }

    console.log('═══════════════════════════════════════');
    console.log(`🔍 Search: "${query}"`);
    console.log('═══════════════════════════════════════');

    CONFIG.TRACKED_QUERIES.add(queryKey);

    const aiOverviewContainer = findAIOverviewContainer();

    if (aiOverviewContainer) {
      console.log('🎯 AI OVERVIEW DETECTED ✅');
      CONFIG.AI_OVERVIEW_FOUND = aiOverviewContainer;
      
      const citations = await trackAIOverviewShown(aiOverviewContainer, query);
      setupClickTracking(aiOverviewContainer, citations, query);
      
      console.log('═══════════════════════════════════════');
    } else {
      console.log('📭 NO AI OVERVIEW ❌');
      CONFIG.AI_OVERVIEW_FOUND = null;
      await trackSearchWithoutAIOverview(query);
      console.log('═══════════════════════════════════════');
    }
  }

  // ==================== OBSERVERS ====================
  
  let detectionTimeout;
  
  function scheduleDetection() {
    if (CONFIG.MODE_REDIRECT_PENDING) {
      return;
    }

    clearTimeout(detectionTimeout);
    detectionTimeout = setTimeout(detectAndTrackAIOverviews, 2000);
  }

  function observeDOMChanges() {
    const observer = new MutationObserver(
      debounce(() => {
        if (!CONFIG.AI_OVERVIEW_FOUND) {
          scheduleDetection();
        }
      }, CONFIG.DEBOUNCE_DELAY)
    );

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function observeURLChanges() {
    let lastUrl = location.href;
    
    const urlObserver = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        console.log('🔄 New page');
        
        CONFIG.TRACKED_QUERIES.clear();
        CONFIG.AI_OVERVIEW_FOUND = null;

        enforceSearchModePreference().then((redirected) => {
          if (!redirected) {
            scheduleDetection();
          }
        });
      }
    });

    urlObserver.observe(document, { subtree: true, childList: true });
  }

  // ==================== INIT ====================
  
  function init() {
    console.log('═══════════════════════════════════════');
    console.log('🚀 AI Overview Tracker - ENHANCED V3');
    console.log('✅ Topic Classification (11 categories)');
    console.log('✅ Full citation URLs & domains saved');
    console.log('✅ Click status & timestamps tracked');
    console.log('✅ Data retention (7/15/30/90 days)');
    console.log('✅ Firebase-ready structure');
    console.log('═══════════════════════════════════════');
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        enforceSearchModePreference().then((redirected) => {
          if (!redirected) {
            scheduleDetection();
          }
        });
      });
    } else {
      enforceSearchModePreference().then((redirected) => {
        if (!redirected) {
          scheduleDetection();
        }
      });
    }

    observeDOMChanges();
    observeURLChanges();
    
    window.addEventListener('beforeunload', cleanup);
  }

  init();
})();
