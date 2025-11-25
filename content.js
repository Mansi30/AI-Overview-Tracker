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
    AI_OVERVIEW_FOUND: null
  };

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
      
      if (href && 
          !href.includes('google.com/search') && 
          !href.includes('accounts.google.com') &&
          !href.includes('support.google.com') &&
          !href.includes('policies.google.com') &&
          !href.includes('google.com/intl') &&
          !href.includes('consent.google.com') &&
          !href.includes('myaccount.google.com') &&
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
  
  function determineQueryTopic(query) {
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

  function trackAIOverviewShown(aiOverviewContainer, query) {
    const citations = extractCitations(aiOverviewContainer);
    const aiResponseText = extractAIResponseText(aiOverviewContainer);
    
    const eventData = {
      session_id: CONFIG.SESSION_ID,
      timestamp: new Date().toISOString(),
      event_type: 'ai_overview_shown',
      
      // Query details
      query: query,
      query_category: categorizeQuery(query),
      query_topic: determineQueryTopic(query),  // 🆕 TOPIC!
      
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

  function trackCitationClick(citationData, query, timeToClick) {
    const eventData = {
      session_id: CONFIG.SESSION_ID,
      timestamp: new Date().toISOString(),
      event_type: 'citation_clicked',
      
      // Citation details
      query: query,
      query_topic: determineQueryTopic(query),  // 🆕 TOPIC!
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

  function trackSearchWithoutAIOverview(query) {
    const eventData = {
      session_id: CONFIG.SESSION_ID,
      timestamp: new Date().toISOString(),
      event_type: 'search_without_ai_overview',
      
      query: query,
      query_category: categorizeQuery(query),
      query_topic: determineQueryTopic(query),  // 🆕 TOPIC!
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
  
  function detectAndTrackAIOverviews() {
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
      
      const citations = trackAIOverviewShown(aiOverviewContainer, query);
      setupClickTracking(aiOverviewContainer, citations, query);
      
      console.log('═══════════════════════════════════════');
    } else {
      console.log('📭 NO AI OVERVIEW ❌');
      CONFIG.AI_OVERVIEW_FOUND = null;
      trackSearchWithoutAIOverview(query);
      console.log('═══════════════════════════════════════');
    }
  }

  // ==================== OBSERVERS ====================
  
  let detectionTimeout;
  
  function scheduleDetection() {
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
        
        scheduleDetection();
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
      document.addEventListener('DOMContentLoaded', scheduleDetection);
    } else {
      scheduleDetection();
    }

    observeDOMChanges();
    observeURLChanges();
    
    window.addEventListener('beforeunload', cleanup);
  }

  init();
})();
