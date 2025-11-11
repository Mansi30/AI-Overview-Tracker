/**
 * AI Overview Tracker - Options/Settings Script
 * Handles settings UI and user preferences
 */

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadStorageInfo();
  setupEventListeners();
  displayVersionInfo();
});

function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  document.getElementById('privacyLink').addEventListener('click', showPrivacyPolicy);
}

// ==================== LOAD SETTINGS ====================

async function loadSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
    
    // Populate form with current settings
    document.getElementById('trackingEnabled').checked = settings.tracking_enabled !== false;
    document.getElementById('includeQueryText').checked = settings.include_query_text !== false;
    document.getElementById('dataRetentionDays').value = settings.data_retention_days || 90;
  } catch (error) {
    console.error('Failed to load settings:', error);
    showStatus('Failed to load settings', 'error');
  }
}

async function loadStorageInfo() {
  try {
    const data = await chrome.runtime.sendMessage({ action: 'exportData' });
    const events = data.events || [];
    
    // Update total events
    document.getElementById('totalEvents').textContent = events.length;
    
    // Find oldest event
    if (events.length > 0) {
      const timestamps = events.map(e => new Date(e.timestamp)).filter(d => !isNaN(d));
      if (timestamps.length > 0) {
        const oldest = new Date(Math.min(...timestamps));
        document.getElementById('oldestEvent').textContent = formatDate(oldest);
      } else {
        document.getElementById('oldestEvent').textContent = 'N/A';
      }
    } else {
      document.getElementById('oldestEvent').textContent = 'No data';
    }
  } catch (error) {
    console.error('Failed to load storage info:', error);
    document.getElementById('totalEvents').textContent = 'Error';
    document.getElementById('oldestEvent').textContent = 'Error';
  }
}

// ==================== SAVE SETTINGS ====================

async function saveSettings() {
  try {
    const button = document.getElementById('saveBtn');
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> Saving...';

    // Collect settings from form
    const settings = {
      tracking_enabled: document.getElementById('trackingEnabled').checked,
      include_query_text: document.getElementById('includeQueryText').checked,
      data_retention_days: parseInt(document.getElementById('dataRetentionDays').value),
      auto_export: false // Reserved for future use
    };

    // Save to storage
    await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: settings
    });

    // Show success message
    showStatus('Settings saved successfully!', 'success');
    
    button.innerHTML = '<span class="btn-icon">✅</span> Saved!';
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = '<span class="btn-icon">💾</span> Save Settings';
    }, 2000);
  } catch (error) {
    console.error('Failed to save settings:', error);
    showStatus('Failed to save settings', 'error');
    
    const button = document.getElementById('saveBtn');
    button.disabled = false;
    button.innerHTML = '<span class="btn-icon">💾</span> Save Settings';
  }
}

// ==================== RESET SETTINGS ====================

async function resetSettings() {
  const confirmed = confirm(
    'Are you sure you want to reset all settings to their default values?\n\n' +
    'This will not delete your tracked data.'
  );

  if (!confirmed) return;

  try {
    const button = document.getElementById('resetBtn');
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> Resetting...';

    // Default settings
    const defaultSettings = {
      tracking_enabled: true,
      auto_export: false,
      data_retention_days: 90,
      include_query_text: true
    };

    // Save defaults
    await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: defaultSettings
    });

    // Reload form
    await loadSettings();

    showStatus('Settings reset to defaults', 'success');
    
    button.innerHTML = '<span class="btn-icon">✅</span> Reset!';
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = '<span class="btn-icon">🔄</span> Reset to Defaults';
    }, 2000);
  } catch (error) {
    console.error('Failed to reset settings:', error);
    showStatus('Failed to reset settings', 'error');
    
    const button = document.getElementById('resetBtn');
    button.disabled = false;
    button.innerHTML = '<span class="btn-icon">🔄</span> Reset to Defaults';
  }
}

// ==================== DISPLAY VERSION ====================

function displayVersionInfo() {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('extensionVersion').textContent = manifest.version;
}

// ==================== SHOW STATUS MESSAGE ====================

function showStatus(message, type = 'success') {
  const statusElement = document.getElementById('statusMessage');
  statusElement.textContent = message;
  statusElement.className = `status-message ${type}`;
  statusElement.style.display = 'block';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusElement.style.display = 'none';
  }, 5000);
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(date) {
  const options = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  };
  return date.toLocaleDateString(undefined, options);
}

function showPrivacyPolicy(e) {
  e.preventDefault();
  
  alert(
    'PRIVACY POLICY\n\n' +
    'Data Collection:\n' +
    '• Search queries on Google (if enabled)\n' +
    '• AI Overview content and citations\n' +
    '• User click interactions\n' +
    '• Timestamps and session identifiers\n\n' +
    'Data Storage:\n' +
    '• All data is stored locally on your device\n' +
    '• No data is transmitted to external servers\n' +
    '• You can export or delete data at any time\n\n' +
    'Data Usage:\n' +
    '• Data is used solely for research purposes\n' +
    '• Helps understand AI Overview engagement\n' +
    '• Aggregated statistics only, no individual tracking\n\n' +
    'For more information, contact the extension developer.'
  );
}

// ==================== AUTO-REFRESH STORAGE INFO ====================

// Refresh storage info every 30 seconds
setInterval(loadStorageInfo, 30000);
