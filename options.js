/**
 * AI Overview Tracker - Options/Settings Script
 * Handles settings UI and user preferences
 */

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  const dashboardLink = document.getElementById('dashboardLink');
  if (dashboardLink) {
    dashboardLink.href = DASHBOARD_URL;
  }

  await loadAuthStatus();
  await loadSettings();
  await loadStorageInfo();
  setupEventListeners();
  displayVersionInfo();
});

const DEFAULT_SEARCH_MODE_PREFERENCE = 'all';
const ENV = globalThis.AIO_ENV || {};
const FIREBASE_WEB_API_KEY = typeof ENV.FIREBASE_WEB_API_KEY === 'string' ? ENV.FIREBASE_WEB_API_KEY.trim() : '';
const FIREBASE_PROJECT_ID = typeof ENV.FIREBASE_PROJECT_ID === 'string' ? ENV.FIREBASE_PROJECT_ID.trim() : '';
const DASHBOARD_URL = typeof ENV.DASHBOARD_URL === 'string' && ENV.DASHBOARD_URL.trim()
  ? ENV.DASHBOARD_URL.trim()
  : '#';
const FIREBASE_AUTH_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIRESTORE_BASE_URL = FIREBASE_PROJECT_ID
  ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`
  : '';

function getFirebaseAuthUrl(path) {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error('Missing Firebase config: FIREBASE_WEB_API_KEY');
  }

  return `${FIREBASE_AUTH_BASE_URL}/${path}?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`;
}

function getFirestoreUserUrl(userId) {
  if (!FIRESTORE_BASE_URL) {
    throw new Error('Missing Firebase config: FIREBASE_PROJECT_ID');
  }

  return `${FIRESTORE_BASE_URL}/users/${userId}`;
}

function normalizeSearchModePreference(value) {
  if (value === 'all' || value === 'random' || value === 'ai' || value === 'no_ai') {
    return value;
  }

  // Keep old saved values compatible.
  if (value === 'normal') {
    return 'all';
  }

  return DEFAULT_SEARCH_MODE_PREFERENCE;
}

function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  document.getElementById('privacyLink').addEventListener('click', showPrivacyPolicy);
  document.getElementById('createAccountBtn').addEventListener('click', () => {
    showConfirmPassword();
    createUserAccount();
  });
  document.getElementById('loginBtn').addEventListener('click', () => {
    hideConfirmPassword();
    loginUser();
  });
  document.getElementById('logoutBtn').addEventListener('click', logoutUser);
  document.getElementById('forgotPasswordBtn').addEventListener('click', resetPassword);
  document.getElementById('manageDataBtn').addEventListener('click', showDataModal);
  
  // Modal event listeners
  document.getElementById('cancelDataDeleteBtn').addEventListener('click', hideDataModal);
  document.getElementById('confirmDataDeleteBtn').addEventListener('click', handleDataDelete);
  document.getElementById('deleteByDateOptions').addEventListener('change', handleDeleteByDateOptionsChange);
}

function showConfirmPassword() {
  document.getElementById('confirmPasswordSection').style.display = 'flex';
  document.getElementById('confirmPassword').required = true;
}

function hideConfirmPassword() {
  document.getElementById('confirmPasswordSection').style.display = 'none';
  document.getElementById('confirmPassword').required = false;
  document.getElementById('confirmPassword').value = '';
}

// ==================== AUTHENTICATION ====================

async function loadAuthStatus() {
  try {
    const { userEmail, userId } = await chrome.storage.local.get(['userEmail', 'userId']);
    
    if (userEmail && userId) {
      // User is authenticated
      document.getElementById('notAuthenticatedView').style.display = 'none';
      document.getElementById('authenticatedView').style.display = 'block';
      document.getElementById('displayEmail').textContent = userEmail;
      document.getElementById('displayUserId').textContent = userId.substring(0, 20) + '...';
    } else {
      // User is not authenticated
      document.getElementById('notAuthenticatedView').style.display = 'block';
      document.getElementById('authenticatedView').style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to load auth status:', error);
  }
}

async function createUserAccount() {
  try {
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    // Validation
    if (!email || !password) {
      showStatus('Please enter email and password', 'error');
      return;
    }

    if (password.length < 6) {
      showStatus('Password must be at least 6 characters', 'error');
      return;
    }

    if (confirmPassword && password !== confirmPassword) {
      showStatus('Passwords do not match', 'error');
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showStatus('Please enter a valid email address', 'error');
      return;
    }

    const button = document.getElementById('createAccountBtn');
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> Creating Account...';

    // Send request to Firebase Auth via dashboard URL
    const response = await fetch(getFirebaseAuthUrl('accounts:signUp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Account creation failed');
    }

    // Store user credentials locally using Firebase Auth UID
    await chrome.storage.local.set({
      userEmail: email,
      userAuthToken: data.idToken,
      userRefreshToken: data.refreshToken,
      userId: data.localId // Use Firebase Auth UID instead of random ID
    });

    // Create user document in Firestore with role
    await createUserInFirestore(data.localId, email, data.idToken);

    showStatus('Account created successfully! You can now access the dashboard.', 'success');
    
    button.innerHTML = '<span class="btn-icon">✅</span> Account Created!';
    setTimeout(() => {
      loadAuthStatus();
    }, 1500);
  } catch (error) {
    console.error('Account creation failed:', error);
    showStatus(error.message || 'Account creation failed. Email may already be in use.', 'error');
    
    const button = document.getElementById('createAccountBtn');
    button.disabled = false;
    button.innerHTML = '<span class="btn-icon">🚀</span> Create Account & Setup';
  }
}

async function createUserInFirestore(userId, email, idToken) {
  try {
    const url = getFirestoreUserUrl(userId);
    
    const payload = {
      fields: {
        email: { stringValue: email },
        role: { stringValue: 'user' }, // Regular user role
        createdAt: { stringValue: new Date().toISOString() },
        userId: { stringValue: userId }
      }
    };

    await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Failed to create user in Firestore:', error);
  }
}

async function loginUser() {
  try {
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userPassword').value;

    // Validation
    if (!email || !password) {
      showStatus('Please enter email and password', 'error');
      return;
    }

    const button = document.getElementById('loginBtn');
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> Logging In...';

    // Sign in with Firebase Auth
    const response = await fetch(getFirebaseAuthUrl('accounts:signInWithPassword'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Login failed');
    }

    // Store user credentials locally using Firebase Auth UID
    await chrome.storage.local.set({
      userEmail: email,
      userAuthToken: data.idToken,
      userRefreshToken: data.refreshToken,
      userId: data.localId // Use Firebase Auth UID
    });

    showStatus('Login successful! You can now access the dashboard.', 'success');
    
    button.innerHTML = '<span class="btn-icon">✅</span> Logged In!';
    setTimeout(() => {
      loadAuthStatus();
    }, 1500);
  } catch (error) {
    console.error('Login failed:', error);
    showStatus(error.message || 'Login failed. Please check your credentials.', 'error');
    
    const button = document.getElementById('loginBtn');
    button.disabled = false;
    button.innerHTML = '<span class="btn-icon">🔓</span> Login to Existing Account';
  }
}

async function logoutUser() {
  const confirmed = confirm('Are you sure you want to logout? You will need to login again to access the dashboard.');
  
  if (!confirmed) return;

  try {
    await chrome.storage.local.remove(['userEmail', 'userAuthToken']);
    showStatus('Logged out successfully', 'success');
    setTimeout(() => {
      loadAuthStatus();
    }, 1000);
  } catch (error) {
    console.error('Logout failed:', error);
    showStatus('Logout failed', 'error');
  }
}

async function resetPassword() {
  const email = prompt('Enter your email address to reset your password:');
  
  if (!email) return;

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showStatus('Please enter a valid email address', 'error');
    return;
  }

  try {
    const button = document.getElementById('forgotPasswordBtn');
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> Sending Email...';

    const response = await fetch(getFirebaseAuthUrl('accounts:sendOobCode'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: email
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Password reset failed');
    }

    showStatus('Password reset email sent! Check your inbox.', 'success');
    
    button.innerHTML = '<span class="btn-icon">✅</span> Email Sent!';
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = '<span class="btn-icon">🔑</span> Forgot Password?';
    }, 3000);
  } catch (error) {
    console.error('Password reset failed:', error);
    showStatus(error.message || 'Failed to send password reset email', 'error');
    
    const button = document.getElementById('forgotPasswordBtn');
    button.disabled = false;
    button.innerHTML = '<span class="btn-icon">🔑</span> Forgot Password?';
  }
}

async function deleteAccount() {
  const confirmed = confirm(
    '⚠️ WARNING: DELETE ACCOUNT\n\n' +
    'This will permanently delete:\n' +
    '• Your account and credentials\n' +
    '• All your search history and events\n' +
    '• All analytics data\n' +
    '• This action CANNOT be undone!\n\n' +
    'Are you absolutely sure you want to continue?'
  );

  if (!confirmed) return;

  // Double confirmation
  const doubleConfirm = confirm(
    'FINAL CONFIRMATION\n\n' +
    'This is your last chance to cancel.\n\n' +
    'Delete everything permanently?'
  );

  if (!doubleConfirm) return;

  try {
    const button = document.getElementById('deleteAccountBtn');
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">⏳</span> Deleting...';

    const { userEmail, userAuthToken, userId } = await chrome.storage.local.get(['userEmail', 'userAuthToken', 'userId']);

    if (!userEmail || !userAuthToken || !userId) {
      throw new Error('No account found to delete');
    }

    // Delete user from Firebase Auth
    const authResponse = await fetch(getFirebaseAuthUrl('accounts:delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: userAuthToken
      })
    });

    if (!authResponse.ok) {
      const authData = await authResponse.json();
      console.warn('Auth deletion failed:', authData.error?.message);
      // Continue anyway to clean up local data
    }

    // Delete user document and events from Firestore
    try {
      const firestoreUrl = getFirestoreUserUrl(userId);
      
      await fetch(firestoreUrl, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${userAuthToken}` }
      });
    } catch (firestoreError) {
      console.warn('Firestore deletion warning:', firestoreError);
    }

    // Clear all local data
    await chrome.storage.local.clear();
    
    // Reinitialize with default settings
    await chrome.runtime.sendMessage({ action: 'clearData' });

    showStatus('Account deleted successfully. All data removed.', 'success');
    
    button.innerHTML = '<span class="btn-icon">✅</span> Deleted!';
    
    // Reload page after 2 seconds
    setTimeout(() => {
      window.location.reload();
    }, 2000);

  } catch (error) {
    console.error('Account deletion failed:', error);
    showStatus(error.message || 'Failed to delete account. Please try again.', 'error');
    
    const button = document.getElementById('deleteAccountBtn');
    button.disabled = false;
    button.innerHTML = '<span class="btn-icon">🗑️</span> Delete Account & Data';
  }
}

// ==================== LOAD SETTINGS ====================

async function loadSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
    
    // Populate form with current settings
    document.getElementById('trackingEnabled').checked = settings.tracking_enabled !== false;
    document.getElementById('includeQueryText').checked = settings.include_query_text !== false;
    document.getElementById('dataRetentionDays').value = settings.data_retention_days || 90;
    document.getElementById('searchModePreference').value = normalizeSearchModePreference(settings.search_mode_preference);
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
      search_mode_preference: normalizeSearchModePreference(document.getElementById('searchModePreference').value),
      auto_export: false // Reserved for future use
    };

    // Save to storage
    const result = await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: settings
    });

    if (!result || result.success !== true) {
      throw new Error((result && result.error) || 'Settings save failed');
    }

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
      include_query_text: true,
      search_mode_preference: DEFAULT_SEARCH_MODE_PREFERENCE
    };

    // Save defaults
    const result = await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: defaultSettings
    });

    if (!result || result.success !== true) {
      throw new Error((result && result.error) || 'Settings reset failed');
    }

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

// ==================== DATA MANAGEMENT MODAL ====================

function showDataModal() {
  document.getElementById('dataModal').style.display = 'flex';
}

function hideDataModal() {
  document.getElementById('dataModal').style.display = 'none';
  // Reset checkboxes
  document.getElementById('deleteByDateOptions').checked = false;
  document.getElementById('dateRangeOptions').disabled = true;
}

function handleDeleteByDateOptionsChange(e) {
  document.getElementById('dateRangeOptions').disabled = !e.target.checked;
}

async function handleDataDelete() {
  const deleteByDate = document.getElementById('deleteByDateOptions').checked;
  const dateRange = parseInt(document.getElementById('dateRangeOptions').value);

  // Validation
  if (!deleteByDate) {
    showStatus('Please select the date range option', 'error');
    return;
  }

  // Build confirmation message
  let message = `Are you sure you want to delete data from the past ${dateRange} days?\n\n`;
  message += '⚠️ This will delete from BOTH:\n';
  message += '   • Your browser storage\n';
  message += '   • Cloud dashboard (Firestore)\n\n';
  message += 'This action is PERMANENT and cannot be undone.';

  if (!confirm(message)) return;

  try {
    const button = document.getElementById('confirmDataDeleteBtn');
    button.innerHTML = '<span class="btn-icon">⏳</span> Deleting...';
    button.disabled = true;

    // Send delete request to background
    await chrome.runtime.sendMessage({
      action: 'selectiveDelete',
      options: {
        deleteAll: false,
        deleteByDate: true,
        dateRange,
        deleteSearches: false,
        deleteClicks: false,
        deleteStats: false
      }
    });

    hideDataModal();
    await loadStorageInfo(); // Refresh storage display
    
    showStatus('✅ Selected data has been deleted from browser and cloud.', 'success');
  } catch (error) {
    console.error('Delete failed:', error);
    showStatus('Failed to delete data. Please try again.', 'error');
  } finally {
    const button = document.getElementById('confirmDataDeleteBtn');
    button.innerHTML = '<span class="btn-icon">🗑️</span> Delete Selected';
    button.disabled = false;
  }
}
