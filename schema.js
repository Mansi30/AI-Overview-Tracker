/**
 * AI Overview Tracker - Lightweight Event Schema
 * Shared by content and background scripts.
 */

(function() {
  'use strict';

  const VERSION = '1.0.0';

  const EVENT_TYPES = Object.freeze({
    AI_OVERVIEW_SHOWN: 'ai_overview_shown',
    CITATION_CLICKED: 'citation_clicked',
    SEARCH_WITHOUT_AI_OVERVIEW: 'search_without_ai_overview'
  });

  const QUERY_TOPICS = Object.freeze([
    'technology',
    'business',
    'politics',
    'entertainment',
    'sports',
    'health',
    'science',
    'finance',
    'education',
    'travel',
    'general'
  ]);

  const QUERY_CATEGORIES = Object.freeze([
    'informational',
    'commercial',
    'navigational',
    'comparative',
    'general'
  ]);

  function isString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function isInteger(value) {
    return Number.isInteger(value);
  }

  function isIsoDateString(value) {
    if (!isString(value)) return false;
    return !Number.isNaN(Date.parse(value));
  }

  function hasAllowedValue(value, allowed) {
    return allowed.includes(value);
  }

  function requireField(eventData, key, predicate, errors, message) {
    if (!predicate(eventData[key])) {
      errors.push(message || `Invalid or missing field: ${key}`);
    }
  }

  function validateCitationSource(source, index, errors) {
    const prefix = `cited_sources[${index}]`;

    if (!source || typeof source !== 'object') {
      errors.push(`${prefix} must be an object`);
      return;
    }

    requireField(source, 'url', isString, errors, `${prefix}.url must be a non-empty string`);
    requireField(source, 'domain', isString, errors, `${prefix}.domain must be a non-empty string`);
    requireField(source, 'position', isInteger, errors, `${prefix}.position must be an integer`);
    requireField(source, 'text', (v) => typeof v === 'string', errors, `${prefix}.text must be a string`);
    requireField(source, 'title', (v) => typeof v === 'string', errors, `${prefix}.title must be a string`);
    requireField(source, 'clicked', (v) => typeof v === 'boolean', errors, `${prefix}.clicked must be a boolean`);

    if (!(source.click_timestamp === null || isIsoDateString(source.click_timestamp))) {
      errors.push(`${prefix}.click_timestamp must be null or an ISO date string`);
    }

    if (!(source.time_to_click_ms === null || isInteger(source.time_to_click_ms))) {
      errors.push(`${prefix}.time_to_click_ms must be null or an integer`);
    }

    requireField(source, 'detected_at', isIsoDateString, errors, `${prefix}.detected_at must be an ISO date string`);
    requireField(source, 'element_selector', isString, errors, `${prefix}.element_selector must be a non-empty string`);
    requireField(source, 'ttl', isInteger, errors, `${prefix}.ttl must be an integer`);
  }

  function validateBaseEvent(eventData, errors) {
    requireField(eventData, 'session_id', isString, errors, 'session_id must be a non-empty string');
    requireField(eventData, 'timestamp', isIsoDateString, errors, 'timestamp must be an ISO date string');
    requireField(eventData, 'event_type', (v) => hasAllowedValue(v, Object.values(EVENT_TYPES)), errors, 'event_type is invalid');
    requireField(eventData, 'query', isString, errors, 'query must be a non-empty string');
    requireField(eventData, 'query_topic', (v) => hasAllowedValue(v, QUERY_TOPICS), errors, 'query_topic is invalid');
    requireField(eventData, 'page_url', isString, errors, 'page_url must be a non-empty string');
    requireField(eventData, 'retention_days', isInteger, errors, 'retention_days must be an integer');
    requireField(eventData, 'ttl', isInteger, errors, 'ttl must be an integer');
    requireField(eventData, 'created_at', isIsoDateString, errors, 'created_at must be an ISO date string');

    if (eventData.schema_version !== undefined && !isString(eventData.schema_version)) {
      errors.push('schema_version must be a non-empty string when provided');
    }
  }

  function validateByEventType(eventData, errors) {
    if (eventData.event_type === EVENT_TYPES.AI_OVERVIEW_SHOWN) {
      requireField(eventData, 'query_category', (v) => hasAllowedValue(v, QUERY_CATEGORIES), errors, 'query_category is invalid');
      requireField(eventData, 'ai_overview_present', (v) => v === true, errors, 'ai_overview_present must be true');
      requireField(eventData, 'ai_response_text', (v) => typeof v === 'string', errors, 'ai_response_text must be a string');
      requireField(eventData, 'ai_response_length', isInteger, errors, 'ai_response_length must be an integer');
      requireField(eventData, 'citation_count', isInteger, errors, 'citation_count must be an integer');

      if (!Array.isArray(eventData.cited_sources)) {
        errors.push('cited_sources must be an array');
      } else {
        eventData.cited_sources.forEach((source, index) => {
          validateCitationSource(source, index, errors);
        });
      }
    }

    if (eventData.event_type === EVENT_TYPES.CITATION_CLICKED) {
      requireField(eventData, 'citation_url', isString, errors, 'citation_url must be a non-empty string');
      requireField(eventData, 'citation_domain', isString, errors, 'citation_domain must be a non-empty string');
      requireField(eventData, 'citation_position', isInteger, errors, 'citation_position must be an integer');
      requireField(eventData, 'citation_text', (v) => typeof v === 'string', errors, 'citation_text must be a string');
      requireField(eventData, 'time_to_click_ms', isInteger, errors, 'time_to_click_ms must be an integer');
      requireField(eventData, 'click_timestamp', isIsoDateString, errors, 'click_timestamp must be an ISO date string');
    }

    if (eventData.event_type === EVENT_TYPES.SEARCH_WITHOUT_AI_OVERVIEW) {
      requireField(eventData, 'query_category', (v) => hasAllowedValue(v, QUERY_CATEGORIES), errors, 'query_category is invalid');
      requireField(eventData, 'ai_overview_present', (v) => v === false, errors, 'ai_overview_present must be false');
    }
  }

  function validateEventDocument(eventData) {
    const errors = [];

    if (!eventData || typeof eventData !== 'object') {
      return {
        valid: false,
        errors: ['eventData must be an object']
      };
    }

    validateBaseEvent(eventData, errors);
    validateByEventType(eventData, errors);

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  globalThis.AIO_SCHEMA = {
    VERSION,
    EVENT_TYPES,
    QUERY_TOPICS,
    QUERY_CATEGORIES,
    validateEventDocument
  };
})();
