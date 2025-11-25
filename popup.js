/**
 * AI Overview Tracker - Popup Script
 * Handles UI interactions and displays statistics
 */

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('refreshBtn').addEventListener('click', loadStats);
  document.getElementById('optionsBtn').addEventListener('click', openOptions);
  document.getElementById('clearBtn').addEventListener('click', clearData);
}

// ==================== LOAD STATISTICS ====================

async function loadStats() {
  try {
    showLoading();
    const stats = await chrome.runtime.sendMessage({ action: 'getStats' });
    displayStats(stats);
    hideLoading();
  } catch (error) {
    console.error('Failed to load stats:', error);
    showError('Failed to load statistics');
  }
}

function showLoading() {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('content').style.display = 'none';
}

function hideLoading() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';
}

function showError(message) {
  hideLoading();
  // You can implement a proper error UI here
  alert(message);
}

// ==================== DISPLAY STATISTICS ====================

function displayStats(stats) {
  // Update stat cards
  updateElement('totalSearches', stats.total_searches || 0);
  updateElement('aiOverviewRate', `${stats.ai_overview_rate || 0}%`);
  updateElement('citationsClicked', stats.total_citations_clicked || 0);
  updateElement('avgCitations', stats.avg_citations_per_overview || 0);

  // Update additional metrics
  updateElement('clickThroughRate', `${stats.click_through_rate || 0}%`);
  updateElement('uniqueSessions', stats.unique_sessions || 0);

  // Update domain list
  displayDomainList(stats.top_cited_domains || []);
}

function updateElement(id, value) {
  const element = document.getElementById(id);
  if (element) {
    // Animate number changes
    animateValue(element, element.textContent, value, 500);
  }
}

function animateValue(element, start, end, duration) {
  // Only animate numbers
  const startNum = parseFloat(start) || 0;
  const endNum = parseFloat(end);
  
  if (isNaN(endNum)) {
    element.textContent = end;
    return;
  }

  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function
    const easeOutQuad = progress * (2 - progress);
    const current = startNum + (endNum - startNum) * easeOutQuad;
    
    // Preserve percentage or decimal formatting
    if (typeof end === 'string' && end.includes('%')) {
      element.textContent = `${current.toFixed(1)}%`;
    } else if (typeof end === 'string' && end.includes('.')) {
      element.textContent = current.toFixed(1);
    } else {
      element.textContent = Math.round(current);
    }
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = end;
    }
  }
  
  requestAnimationFrame(update);
}

function displayDomainList(domains) {
  const domainList = document.getElementById('domainList');
  
  if (!domains || domains.length === 0) {
    domainList.innerHTML = '<div class="no-data">No citations tracked yet. Start searching on Google!</div>';
    return;
  }

  domainList.innerHTML = domains.map((item, index) => `
    <div class="domain-item" style="animation-delay: ${index * 50}ms;">
      <span class="domain-name" title="${item.domain}">${item.domain}</span>
      <span class="domain-count">${item.count}</span>
    </div>
  `).join('');
}

// ==================== EXPORT DATA ====================

async function exportData() {
  try {
    const button = document.getElementById('exportBtn');
    const originalText = button.innerHTML;
    button.innerHTML = '<span class="btn-icon">⏳</span> Exporting...';
    button.disabled = true;

    const data = await chrome.runtime.sendMessage({ action: 'exportData' });
    
    // Convert to CSV
    const csv = convertToCSV(data.events);
    
    // Create download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai_overview_data_${formatDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    // Show success
    button.innerHTML = '<span class="btn-icon">✅</span> Exported!';
    setTimeout(() => {
      button.innerHTML = originalText;
      button.disabled = false;
    }, 2000);
  } catch (error) {
    console.error('Export failed:', error);
    alert('Export failed. Check console for details.');
    
    const button = document.getElementById('exportBtn');
    button.innerHTML = '<span class="btn-icon">💾</span> Export Data';
    button.disabled = false;
  }
}

function convertToCSV(events) {
  if (!events || events.length === 0) {
    return 'No data available';
  }

  // CSV headers
  const headers = [
    'Session ID',
    'Timestamp',
    'Event Type',
    'Query',
    'AI Overview Present',
    'Citation URL',
    'Citation Domain',
    'Citation Position',
    'Citation Count',
    'Page URL'
  ];

  // Convert events to CSV rows
  const rows = events.map(event => {
    const query = (event.query || '').replace(/"/g, '""'); // Escape quotes
    
    return [
      event.session_id || '',
      event.timestamp || '',
      event.event_type || '',
      `"${query}"`,
      event.ai_overview_present ? 'Yes' : 'No',
      event.citation_url || '',
      event.citation_domain || '',
      event.citation_position || '',
      event.citation_count || '',
      event.page_url || ''
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ==================== CLEAR DATA ====================

async function clearData() {
  const confirmed = confirm(
    'Are you sure you want to clear all tracked data?\n\n' +
    'This will delete:\n' +
    '• All search events\n' +
    '• All statistics\n' +
    '• Session history\n\n' +
    'This action cannot be undone.'
  );

  if (!confirmed) return;

  try {
    const button = document.getElementById('clearBtn');
    button.innerHTML = '<span class="btn-icon">⏳</span> Clearing...';
    button.disabled = true;

    await chrome.runtime.sendMessage({ action: 'clearData' });
    
    // Reload stats
    await loadStats();
    
    button.innerHTML = '<span class="btn-icon">✅</span> Cleared!';
    setTimeout(() => {
      button.innerHTML = '<span class="btn-icon">🗑️</span> Clear Data';
      button.disabled = false;
    }, 2000);
  } catch (error) {
    console.error('Clear failed:', error);
    alert('Failed to clear data. Check console for details.');
    
    const button = document.getElementById('clearBtn');
    button.innerHTML = '<span class="btn-icon">🗑️</span> Clear Data';
    button.disabled = false;
  }
}

// ==================== OPEN OPTIONS ====================

function openOptions() {
  chrome.runtime.openOptionsPage();
}

// ==================== UTILITY FUNCTIONS ====================

// Add CSS animation for domain items
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-10px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  
  .domain-item {
    animation: slideIn 0.3s ease forwards;
  }
`;
document.head.appendChild(style);
