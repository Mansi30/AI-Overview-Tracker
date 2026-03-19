# AI Overview Tracker Data Schema

This document formalizes the data model currently used by the extension for:

- `chrome.storage.local` (`events`, `stats`, `settings`)
- Firestore event documents at `users/{userId}/events/{eventId}`

## 1) Top-Level Storage Shape

```json
{
  "events": ["EventDocument"],
  "stats": "StatsDocument",
  "settings": "SettingsDocument"
}
```

## 2) Event Document (Collected Data)

Events are append-only records. The extension currently emits three event types:

- `ai_overview_shown`
- `citation_clicked`
- `search_without_ai_overview`

### 2.1 Shared Fields (All Event Types)

| Field | Type | Required | Notes |
|---|---|---|---|
| `session_id` | string | yes | Format: `session_<timestamp>_<random>` |
| `timestamp` | string (ISO 8601) | yes | Event occurrence time |
| `event_type` | enum | yes | One of the three event types above |
| `query` | string | yes | Google search query text |
| `query_topic` | enum | yes | `technology`, `business`, `politics`, `entertainment`, `sports`, `health`, `science`, `finance`, `education`, `travel`, `general` |
| `retention_days` | integer | yes | Currently written as `90` in content script |
| `ttl` | integer | yes | Unix epoch seconds for expiration |
| `created_at` | string (ISO 8601) | yes | Record creation time |
| `schema_version` | string | yes | Current in-code schema version (`1.0.0`) |
| `page_url` | string | yes | Search result page URL |
| `userEmail` | string | no | Added by background sync when available |

### 2.2 `ai_overview_shown` Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `query_category` | enum | yes | `informational`, `commercial`, `navigational`, `comparative`, `general` |
| `ai_overview_present` | boolean | yes | Always `true` for this event type |
| `ai_response_text` | string | yes | Truncated to max 5000 chars |
| `ai_response_length` | integer | yes | Character length of `ai_response_text` |
| `citation_count` | integer | yes | Number of extracted citations |
| `cited_sources` | CitationSource[] | yes | Non-Google links found in AI Overview |

### 2.3 `citation_clicked` Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `citation_url` | string | yes | Clicked citation URL |
| `citation_domain` | string | yes | Domain derived from URL |
| `citation_position` | integer | yes | Position in extracted citation list |
| `citation_text` | string | yes | Anchor text/label |
| `time_to_click_ms` | integer | yes | Milliseconds from overview detection to click |
| `click_timestamp` | string (ISO 8601) | yes | Click time |

### 2.4 `search_without_ai_overview` Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `query_category` | enum | yes | `informational`, `commercial`, `navigational`, `comparative`, `general` |
| `ai_overview_present` | boolean | yes | Always `false` for this event type |

## 3) CitationSource Subdocument

Used only inside `ai_overview_shown.cited_sources`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | Citation URL |
| `domain` | string | yes | Parsed domain |
| `position` | integer | yes | 1-based order in extracted links |
| `text` | string | yes | Visible link text or aria-label |
| `title` | string | yes | Link title attribute (may be empty) |
| `clicked` | boolean | yes | Initialized to `false` |
| `click_timestamp` | string\|null | yes | Initialized to `null` |
| `time_to_click_ms` | integer\|null | yes | Initialized to `null` |
| `detected_at` | string (ISO 8601) | yes | Citation detection time |
| `element_selector` | string | yes | Generated CSS-like selector path |
| `ttl` | integer | yes | Unix epoch seconds |

## 4) Formal JSON Schema (Draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ai-overview-tracker.local/schema/event-document.json",
  "title": "AI Overview Tracker Event Document",
  "type": "object",
  "required": [
    "session_id",
    "timestamp",
    "event_type",
    "query",
    "query_topic",
    "page_url",
    "retention_days",
    "ttl",
    "created_at"
  ],
  "properties": {
    "session_id": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "event_type": {
      "type": "string",
      "enum": ["ai_overview_shown", "citation_clicked", "search_without_ai_overview"]
    },
    "query": { "type": "string" },
    "query_topic": {
      "type": "string",
      "enum": [
        "technology",
        "business",
        "politics",
        "entertainment",
        "sports",
        "health",
        "science",
        "finance",
        "education",
        "travel",
        "general"
      ]
    },
    "page_url": { "type": "string" },
    "retention_days": { "type": "integer", "minimum": 1 },
    "ttl": { "type": "integer", "minimum": 0 },
    "created_at": { "type": "string", "format": "date-time" },
    "userEmail": { "type": "string" },

    "query_category": {
      "type": "string",
      "enum": ["informational", "commercial", "navigational", "comparative", "general"]
    },
    "ai_overview_present": { "type": "boolean" },
    "ai_response_text": { "type": "string", "maxLength": 5000 },
    "ai_response_length": { "type": "integer", "minimum": 0 },
    "citation_count": { "type": "integer", "minimum": 0 },
    "cited_sources": {
      "type": "array",
      "items": { "$ref": "#/$defs/CitationSource" }
    },

    "citation_url": { "type": "string" },
    "citation_domain": { "type": "string" },
    "citation_position": { "type": "integer", "minimum": 1 },
    "citation_text": { "type": "string" },
    "time_to_click_ms": { "type": "integer", "minimum": 0 },
    "click_timestamp": { "type": "string", "format": "date-time" }
  },
  "$defs": {
    "CitationSource": {
      "type": "object",
      "required": [
        "url",
        "domain",
        "position",
        "text",
        "title",
        "clicked",
        "click_timestamp",
        "time_to_click_ms",
        "detected_at",
        "element_selector",
        "ttl"
      ],
      "properties": {
        "url": { "type": "string" },
        "domain": { "type": "string" },
        "position": { "type": "integer", "minimum": 1 },
        "text": { "type": "string" },
        "title": { "type": "string" },
        "clicked": { "type": "boolean" },
        "click_timestamp": {
          "anyOf": [
            { "type": "string", "format": "date-time" },
            { "type": "null" }
          ]
        },
        "time_to_click_ms": {
          "anyOf": [
            { "type": "integer", "minimum": 0 },
            { "type": "null" }
          ]
        },
        "detected_at": { "type": "string", "format": "date-time" },
        "element_selector": { "type": "string" },
        "ttl": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": true
    }
  },
  "allOf": [
    {
      "if": {
        "properties": { "event_type": { "const": "ai_overview_shown" } },
        "required": ["event_type"]
      },
      "then": {
        "required": [
          "query_category",
          "ai_overview_present",
          "ai_response_text",
          "ai_response_length",
          "citation_count",
          "cited_sources"
        ],
        "properties": {
          "ai_overview_present": { "const": true }
        }
      }
    },
    {
      "if": {
        "properties": { "event_type": { "const": "citation_clicked" } },
        "required": ["event_type"]
      },
      "then": {
        "required": [
          "citation_url",
          "citation_domain",
          "citation_position",
          "citation_text",
          "time_to_click_ms",
          "click_timestamp"
        ]
      }
    },
    {
      "if": {
        "properties": { "event_type": { "const": "search_without_ai_overview" } },
        "required": ["event_type"]
      },
      "then": {
        "required": ["query_category", "ai_overview_present"],
        "properties": {
          "ai_overview_present": { "const": false }
        }
      }
    }
  ],
  "additionalProperties": true
}
```

## 5) Stats Document

```json
{
  "total_searches": 0,
  "ai_overview_shown": 0,
  "total_citations_clicked": 0,
  "sessions": [],
  "first_event_date": null,
  "last_event_date": null
}
```

Field semantics:

- `total_searches`: increments on `ai_overview_shown` and `search_without_ai_overview`
- `ai_overview_shown`: increments on `ai_overview_shown`
- `total_citations_clicked`: increments on `citation_clicked`
- `sessions`: unique `session_id` values observed on `ai_overview_shown`

## 6) Settings Document

```json
{
  "tracking_enabled": true,
  "auto_export": false,
  "data_retention_days": 90,
  "include_query_text": true,
  "search_mode_preference": "normal"
}
```

`search_mode_preference` accepted values:

- `ai`: Opens Google AI mode (`udm=50`) for searches.
- `no_ai`: Opens Google Web mode (`udm=14`) to avoid AI mode.
- `normal`: Opens Google All mode (no `udm` override).

## 7) Notes

- Event ingestion is blocked unless `userId` and `userEmail` are present in local storage (authenticated user).
- The code path currently uses `citation_clicked` (not `citation_click`).
- `retention_days` and `ttl` are currently set in the content script at event creation time.
- Runtime validation is enforced in `background.js` via `schema.js` before local storage and Firestore sync.
