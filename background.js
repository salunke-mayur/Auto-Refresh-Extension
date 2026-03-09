const activeRefreshers = new Map();
const badgeIntervals = new Map();
const pendingTextChecks = new Map();
let creatingOffscreen = false;

async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Prevent race condition
  if (creatingOffscreen) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return setupOffscreenDocument();
  }

  creatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing alert sound when monitored text is not found'
    });
  } catch (error) {
    console.error('Error creating offscreen document:', error);
  }
  creatingOffscreen = false;
}

async function playAlarmSound() {
  await setupOffscreenDocument();
  try {
    await chrome.runtime.sendMessage({ action: 'playAlarm' });
  } catch (error) {
    console.error('Error playing alarm:', error);
  }
}

async function stopAlarmSound() {
  try {
    await chrome.runtime.sendMessage({ action: 'stopAlarm' });
  } catch (error) {
    console.error('Error stopping alarm:', error);
  }
}

// Stop alarm when notification is clicked
chrome.notifications.onClicked.addListener(async (notificationId) => {
  console.log('Notification clicked:', notificationId);
  if (notificationId.startsWith('text-missing-')) {
    await stopAlarmSound();
    chrome.notifications.clear(notificationId);
  }
});

// Stop alarm when notification is closed
chrome.notifications.onClosed.addListener(async (notificationId) => {
  console.log('Notification closed:', notificationId);
  if (notificationId.startsWith('text-missing-')) {
    await stopAlarmSound();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startRefresh(message.tabId, message.interval, message.searchText, message.notificationPrefs).then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (message.action === 'stop') {
    stopRefresh(message.tabId).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  return false;
});

async function updateBadge(tabId) {
  try {
    const data = await chrome.storage.local.get([`refresh_${tabId}`]);
    const refreshData = data[`refresh_${tabId}`];

    if (refreshData && refreshData.isActive) {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((refreshData.nextRefresh - now) / 1000));

      let badgeText;
      if (remaining >= 60) {
        badgeText = `${Math.floor(remaining / 60)}m`;
      } else {
        badgeText = `${remaining}s`;
      }

      await chrome.action.setBadgeText({ text: badgeText, tabId: tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#00c853', tabId: tabId });
    } else {
      await chrome.action.setBadgeText({ text: '', tabId: tabId });
    }
  } catch (error) {
    // Tab might not exist anymore
  }
}

function startBadgeCountdown(tabId) {
  stopBadgeCountdown(tabId);

  updateBadge(tabId);
  const intervalId = setInterval(() => updateBadge(tabId), 1000);
  badgeIntervals.set(tabId, intervalId);
}

function stopBadgeCountdown(tabId) {
  const intervalId = badgeIntervals.get(tabId);
  if (intervalId) {
    clearInterval(intervalId);
    badgeIntervals.delete(tabId);
  }
}

async function checkTextOnPage(tabId, searchText, notificationPrefs = {}) {
  if (!searchText) return;

  console.log(`Checking for text "${searchText}" on tab ${tabId}`);

  // Default preferences to true if not specified
  const prefs = {
    sound: notificationPrefs.sound !== false,
    popup: notificationPrefs.popup !== false
  };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (text) => {
        const bodyText = document.body ? document.body.innerText : '';
        return bodyText.toLowerCase().includes(text.toLowerCase());
      },
      args: [searchText]
    });

    console.log('Script execution results:', results);

    if (results && results[0]) {
      const textFound = results[0].result;
      console.log(`Text found: ${textFound}`);

      if (!textFound) {
          const tab = await chrome.tabs.get(tabId);
          const pageTitle = tab.title || 'the page';

          // Stop the auto-refresh
          await stopRefresh(tabId);

          // Play alert sound using offscreen document (if enabled)
          if (prefs.sound) {
            await playAlarmSound();
          }

          // Show system notification (if enabled)
          if (prefs.popup) {
            try {
              await chrome.notifications.create(`text-missing-${tabId}-${Date.now()}`, {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: '🚨 AUTO REFRESH ALERT',
                message: `Text "${searchText}" is MISSING from: ${pageTitle}\n\nAuto-refresh has been stopped.`,
                priority: 2,
                requireInteraction: true,
                silent: false
              });
              console.log('System notification created successfully');
            } catch (notifError) {
              console.error('Notification error:', notifError);
            }
          }

          // Always update badge to show warning
          await chrome.action.setBadgeText({ text: '!', tabId: tabId });
          await chrome.action.setBadgeBackgroundColor({ color: '#ff5252', tabId: tabId });
        }
    }
  } catch (error) {
    console.error('Error checking text on page:', error);
  }
}

// Listen for tab updates to check text after page loads
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && pendingTextChecks.has(tabId)) {
    const checkData = pendingTextChecks.get(tabId);
    pendingTextChecks.delete(tabId);

    // Get the notification preferences from storage
    const data = await chrome.storage.local.get([`refresh_${tabId}`]);
    const refreshData = data[`refresh_${tabId}`];
    const notificationPrefs = refreshData?.notificationPrefs || {};

    // Small delay to ensure DOM is ready
    setTimeout(() => checkTextOnPage(tabId, checkData, notificationPrefs), 500);
  }
});

async function startRefresh(tabId, intervalSeconds, searchText = '', notificationPrefs = {}) {
  await stopRefresh(tabId);

  const intervalMs = intervalSeconds * 1000;
  const nextRefresh = Date.now() + intervalMs;

  await chrome.storage.local.set({
    [`refresh_${tabId}`]: {
      isActive: true,
      interval: intervalSeconds,
      nextRefresh: nextRefresh,
      searchText: searchText,
      notificationPrefs: notificationPrefs
    }
  });

  const alarmName = `refresh_${tabId}`;
  await chrome.alarms.create(alarmName, {
    periodInMinutes: intervalSeconds / 60
  });

  activeRefreshers.set(tabId, {
    interval: intervalSeconds,
    alarmName: alarmName,
    searchText: searchText,
    notificationPrefs: notificationPrefs
  });

  startBadgeCountdown(tabId);
}

async function stopRefresh(tabId) {
  const alarmName = `refresh_${tabId}`;
  await chrome.alarms.clear(alarmName);
  await chrome.storage.local.remove(`refresh_${tabId}`);
  activeRefreshers.delete(tabId);
  pendingTextChecks.delete(tabId);

  stopBadgeCountdown(tabId);
  try {
    await chrome.action.setBadgeText({ text: '', tabId: tabId });
  } catch (error) {
    // Tab might not exist
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('refresh_')) {
    const tabId = parseInt(alarm.name.replace('refresh_', ''), 10);

    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        const data = await chrome.storage.local.get([`refresh_${tabId}`]);
        const refreshData = data[`refresh_${tabId}`];

        // Schedule text check for after page loads
        if (refreshData && refreshData.searchText) {
          pendingTextChecks.set(tabId, refreshData.searchText);
        }

        await chrome.tabs.reload(tabId);

        if (refreshData && refreshData.isActive) {
          const nextRefresh = Date.now() + (refreshData.interval * 1000);
          await chrome.storage.local.set({
            [`refresh_${tabId}`]: {
              ...refreshData,
              nextRefresh: nextRefresh
            }
          });
        }
      }
    } catch (error) {
      console.error('Alarm error:', error);
      stopRefresh(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopRefresh(tabId);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const data = await chrome.storage.local.get([`refresh_${tabId}`]);
  const refreshData = data[`refresh_${tabId}`];

  if (refreshData && refreshData.isActive) {
    if (!badgeIntervals.has(tabId)) {
      startBadgeCountdown(tabId);
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const allAlarms = await chrome.alarms.getAll();
  for (const alarm of allAlarms) {
    if (alarm.name.startsWith('refresh_')) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  await chrome.storage.local.clear();
});
