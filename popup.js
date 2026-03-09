// Get DOM elements synchronously
const intervalInput = document.getElementById('interval');
const searchTextInput = document.getElementById('searchText');
const notifSoundCheckbox = document.getElementById('notifSound');
const notifPopupCheckbox = document.getElementById('notifPopup');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const nextRefreshEl = document.getElementById('nextRefresh');

let countdownInterval = null;
let cachedTabId = null;

// Get current tab - cache result
function getCurrentTab() {
  return new Promise((resolve) => {
    if (cachedTabId) {
      resolve({ id: cachedTabId });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        cachedTabId = tabs[0]?.id;
        resolve(tabs[0]);
      });
    }
  });
}

// Update UI with stored data
function updateUI() {
  getCurrentTab().then(tab => {
    if (!tab) return;
    
    chrome.storage.local.get([`refresh_${tab.id}`], (data) => {
      const refreshData = data[`refresh_${tab.id}`];

      if (refreshData && refreshData.isActive) {
        statusEl.textContent = 'ON';
        statusEl.className = 'status-on';
        intervalInput.value = refreshData.interval;
        intervalInput.disabled = true;
        searchTextInput.value = refreshData.searchText || '';
        searchTextInput.disabled = true;

        const prefs = refreshData.notificationPrefs || {};
        notifSoundCheckbox.checked = prefs.sound !== false;
        notifPopupCheckbox.checked = prefs.popup !== false;
        notifSoundCheckbox.disabled = true;
        notifPopupCheckbox.disabled = true;

        startBtn.disabled = true;
        stopBtn.disabled = false;
        startCountdown(refreshData.nextRefresh);
      } else {
        statusEl.textContent = 'OFF';
        statusEl.className = 'status-off';
        intervalInput.disabled = false;
        searchTextInput.disabled = false;
        notifSoundCheckbox.disabled = false;
        notifPopupCheckbox.disabled = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        nextRefreshEl.textContent = '';
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
      }
    });
  });
}

function startCountdown(nextRefreshTime) {
  if (countdownInterval) clearInterval(countdownInterval);

  function tick() {
    const remaining = Math.max(0, Math.ceil((nextRefreshTime - Date.now()) / 1000));
    nextRefreshEl.textContent = remaining > 0 ? `Next refresh in ${remaining}s` : 'Refreshing...';
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

// Button handlers
startBtn.onclick = () => {
  const interval = parseInt(intervalInput.value, 10);
  if (isNaN(interval) || interval < 1 || interval > 3600) {
    alert('Enter a valid interval (1-3600 seconds)');
    return;
  }

  getCurrentTab().then(tab => {
    chrome.runtime.sendMessage({
      action: 'start',
      tabId: tab.id,
      interval: interval,
      searchText: searchTextInput.value.trim(),
      notificationPrefs: {
        sound: notifSoundCheckbox.checked,
        popup: notifPopupCheckbox.checked
      }
    });
    window.close();
  });
};

stopBtn.onclick = () => {
  getCurrentTab().then(tab => {
    chrome.runtime.sendMessage({ action: 'stop', tabId: tab.id });
    window.close();
  });
};

// Initialize
updateUI();
