# AI Overview Tracker - Feature Documentation

## Overview
This document provides detailed information about the Journey and Timeline features implemented in the AI Overview Tracker extension.

---

## 1. Journey Feature

### What is the Journey Feature?
The Journey feature tracks user navigation paths after clicking on AI Overview citations. It records the complete navigation tree, including:
- Starting point (citation clicked in AI Overview)
- All subsequent page navigations
- Time spent on each page (dwell time)
- Navigation depth and breadth

### How It Works
1. **Journey Initialization**: When a user clicks a citation in an AI Overview, a journey begins
2. **Navigation Tracking**: The extension monitors all subsequent navigations from that page
3. **Tree Building**: Creates a hierarchical tree structure of visited pages
4. **Journey Termination**: Ends when the tab is closed, timeout occurs, or max depth is reached

### Key Data Captured
- `journey_id`: Unique identifier for each journey
- `query`: Original search query that led to the citation
- `root_citation`: The clicked citation (URL, domain, position)
- `navigation_tree`: Hierarchical structure of all visited pages
- `summary`: Aggregated statistics
  - Total pages visited
  - Maximum navigation depth
  - Total journey time
  - Unique domains visited
- `dwell_time_ms`: Time spent on each page in the journey

### Testing the Journey Feature

#### Prerequisites
- Chrome extension must be installed and active
- User must be logged in (Firebase authentication required)
- Extension must have proper permissions

#### Test Steps

1. **Basic Journey Test**
   ```
   a. Perform a Google search
   b. Wait for AI Overview to appear
   c. Click on any citation link
   d. Navigate to 2-3 additional pages from that site
   e. Close the tab
   f. Check dashboard for the journey data
   ```

2. **Multi-Domain Journey Test**
   ```
   a. Click a citation from AI Overview
   b. From the opened page, click a link to a different domain
   c. Continue navigating across different domains
   d. Verify all domains are captured in the journey tree
   ```

3. **Timeout Test**
   ```
   a. Click a citation
   b. Wait for 5+ minutes without any navigation
   c. Verify journey is finalized with end_reason: "timeout"
   ```

4. **Max Depth Test**
   ```
   a. Click a citation
   b. Navigate through 10+ consecutive pages
   c. Verify journey stops at depth limit (10)
   d. Check end_reason: "max_depth_reached"
   ```

### Viewing Journey Data
- Navigate to the dashboard
- Look for "Journey Analysis" section
- View metrics:
  - Total journeys tracked
  - Average journey depth
  - Average pages per journey
- Expand individual journeys to see the navigation tree

### Limitations & Constraints

**Constraints:**
- Maximum navigation depth: 10 levels
- Journey timeout: 5 minutes of inactivity
- Journey transfer timeout: 10 seconds (for new tab navigation)
- Only tracks journeys starting from AI Overview citations

**Known Limitations:**
1. **New Tab Navigation**: If citation opens in a new tab, journey may not track if navigation happens too quickly
2. **Redirect Handling**: Some redirect chains may not be perfectly captured
3. **Service Worker Restart**: Active journeys are lost if the extension service worker restarts
4. **Cross-Origin Restrictions**: Cannot track navigation within iframes or cross-origin frames
5. **Multiple Windows**: Journey tracking is tab-specific; opening links in new windows may not be tracked

**Browser Requirements:**
- Chrome 88+ (for webNavigation API features)
- Manifest V3 support

---

## 2. Timeline Feature

### What is the Timeline Feature?
The Timeline feature provides a chronological view of all user interactions with AI Overviews, including:
- Searches performed
- AI Overviews shown/not shown
- Citations clicked
- Dwell time on destination pages
- Journey navigation paths

### How It Works
1. **Event Capture**: All user interactions are timestamped and stored
2. **Categorization**: Events are grouped by:
   - Time (chronological order)
   - Query topic (technology, health, business, etc.)
   - User (admin view only)
3. **Visualization**: Events are displayed in an interactive timeline interface

### Key Data Captured
- `timestamp`: ISO 8601 format timestamp for each event
- `event_type`: Type of interaction
  - `ai_overview_shown`
  - `search_without_ai_overview`
  - `citation_clicked`
  - `citation_dwelled`
  - `navigation_journey`
- `query`: Search query text
- `query_topic`: Classified topic (11 categories)
- `session_id`: Links related events within a browsing session

### Testing the Timeline Feature

#### Prerequisites
- Chrome extension installed and active
- User logged in
- Dashboard application running

#### Test Steps

1. **Basic Timeline View**
   ```
   a. Open dashboard
   b. Navigate to Timeline section
   c. Verify events are displayed in reverse chronological order
   d. Check that timestamps are accurate
   ```

2. **Event Type Filtering**
   ```
   a. Generate different event types:
      - Perform searches with AI Overviews
      - Perform searches without AI Overviews
      - Click citations
   b. In dashboard, filter by event type
   c. Verify correct events are shown/hidden
   ```

3. **Topic-Based Filtering**
   ```
   a. Perform searches across different topics:
      - Technology: "how to use python"
      - Health: "symptoms of flu"
      - Business: "marketing strategies"
   b. View timeline grouped by topic
   c. Verify accurate topic classification
   ```

4. **Admin Multi-User View** (Admin role only)
   ```
   a. Log in as admin user
   b. View timeline with multiple users' data
   c. Verify events are properly attributed to users
   d. Test user-based filtering
   ```

5. **Dwell Time Integration**
   ```
   a. Click a citation
   b. Keep tab active for 30+ seconds
   c. Switch to another tab
   d. Check timeline for dwell_time_ms value
   ```

6. **Real-Time Updates**
   ```
   a. Open dashboard in one tab
   b. Perform searches in another tab
   c. Refresh dashboard
   d. Verify new events appear in timeline
   ```

### Viewing Timeline Data

**Dashboard Access:**
1. Navigate to: `http://localhost:3000` (or deployed URL)
2. Log in with Firebase credentials
3. Access "Timeline" or "Recent Events" section

**Data Display:**
- Events shown in reverse chronological order (newest first)
- Each event card shows:
  - Timestamp
  - Event type (icon + label)
  - Query text
  - Topic classification
  - Relevant metadata (citations, dwell time, etc.)

### Limitations & Constraints

**Constraints:**
- Timeline displays up to 50 most recent events by default
- Events older than retention period (90 days default) are auto-deleted
- Real-time updates require page refresh (no WebSocket/polling)

**Known Limitations:**
1. **Retention Period**: Events are automatically deleted after configured retention period (7/15/30/90 days)
2. **Selective Deletion**: Can only delete events from past 30 days (safety limit)
3. **Performance**: Large datasets (>1000 events) may cause slow rendering
4. **Offline Mode**: Events not synced to Firestore while offline will only appear locally
5. **Topic Classification**: 
   - LLM-based classification requires Firebase Cloud Function
   - Falls back to keyword matching (English only) if LLM unavailable
   - May misclassify ambiguous queries

**Browser Compatibility:**
- Dashboard: Modern browsers (Chrome 90+, Firefox 88+, Safari 14+)
- Extension: Chrome/Edge 88+ only

**Privacy Constraints:**
- Query text storage can be disabled in settings
- Admin users see all users' data (GDPR consideration)
- No encryption at rest in Firestore

---

## Data Flow Architecture

### Journey Data Flow
```
User Click → content.js (startJourney) 
→ background.js (activeJourneys Map) 
→ webNavigation listeners 
→ finalizeJourney 
→ Firestore sync
```

### Timeline Event Flow
```
User Interaction → content.js (trackEvent) 
→ background.js (storeEvent) 
→ Chrome Storage (local) 
→ Firestore sync 
→ Dashboard (useDashboardData hook)
```

---

## Firestore Data Structure

### Journey Documents
```
users/{userId}/events/{journeyId}
{
  event_type: "navigation_journey",
  journey_id: string,
  query: string,
  started_at: ISO timestamp,
  ended_at: ISO timestamp,
  end_reason: "tab_closed" | "timeout" | "max_depth_reached",
  root_citation: {
    url: string,
    domain: string,
    position: number
  },
  navigation_tree: {
    node_id: string,
    url: string,
    domain: string,
    visited_at: ISO timestamp,
    dwell_time_ms: number,
    children: [recursive tree structure]
  },
  summary: {
    total_pages_visited: number,
    max_depth: number,
    total_journey_time_ms: number,
    unique_domains_count: number
  }
}
```

### Timeline Event Documents
```
users/{userId}/events/{eventId}
{
  event_type: string,
  timestamp: ISO timestamp,
  session_id: string,
  query: string,
  query_topic: string,
  query_category: string,
  // Type-specific fields...
}
```

---

## Troubleshooting

### Journey Not Tracking
- **Check**: Extension service worker is running (`chrome://extensions`)
- **Check**: User is authenticated (Firebase ID token present)
- **Check**: Console logs in background.js for journey creation
- **Debug**: Use `getJourneyStatus` message to inspect active journeys

### Timeline Missing Events
- **Check**: Extension tracking is enabled in settings
- **Check**: Firestore sync is working (check console for errors)
- **Check**: User has permission to read their own events
- **Verify**: Chrome Storage has events locally

### Inaccurate Dwell Time
- **Cause**: Tab focus changes affect dwell time measurement
- **Cause**: Browser throttling background tabs
- **Limitation**: Only active tab dwell time is measured

---

## Configuration Options

### Extension Settings (options.html)
- **Tracking Enabled**: Master toggle for all tracking
- **Data Retention**: 7/15/30/90 days
- **Include Query Text**: Privacy option to exclude search queries

### Dashboard Configuration
- **Language Filtering**: Filter events by query language (EN/IN)
- **Date Range**: Filter events by time period
- **Topic Filter**: View events for specific topics only

---

## Best Practices for Testing

1. **Use Incognito Mode**: Avoid interference from other extensions
2. **Clear Data Between Tests**: Reset extension data for clean testing
3. **Check Firestore Console**: Verify data is being synced correctly
4. **Monitor Console Logs**: Both content.js and background.js log detailed info
5. **Test Edge Cases**: Rapid navigation, tab closing, redirect chains
6. **Verify Timestamps**: Ensure all times are in correct timezone (ISO UTC)

---

## Future Enhancements

### Planned Features
- Real-time timeline updates (WebSocket integration)
- Journey visualization (interactive tree diagram)
- Export journey data as JSON/CSV
- Journey comparison across queries
- Predictive journey path analysis

### Known Issues
- See GitHub Issues: https://github.com/Mansi30/AI-Overview-Tracker/issues

---

## Support & Contact

For questions or issues:
- GitHub Issues: https://github.com/Mansi30/AI-Overview-Tracker/issues
- Check console logs for detailed error messages
- Review Firestore security rules if sync fails
