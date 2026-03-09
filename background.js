const activeRefreshers = new Map();
const badgeIntervals = new Map();
const pendingTextChecks = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startRefresh(message.tabId, message.interval, message.searchText).then(() => {
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

async function checkTextOnPage(tabId, searchText) {
  if (!searchText) return;

  console.log(`Checking for text "${searchText}" on tab ${tabId}`);

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

          // Open bold popup alert window
          const alertUrl = chrome.runtime.getURL('alert.html') + 
            `?text=${encodeURIComponent(searchText)}&title=${encodeURIComponent(pageTitle)}`;
          
          chrome.windows.create({
            url: alertUrl,
            type: 'popup',
            width: 550,
            height: 500,
            focused: true
          });

          // Flash the original tab's title to grab attention
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: (text) => {
                const originalTitle = document.title;
                let flashCount = 0;
                const maxFlashes = 30; // Flash for 15 seconds
                
                const flashInterval = setInterval(() => {
                  if (flashCount >= maxFlashes) {
                    document.title = originalTitle;
                    clearInterval(flashInterval);
                    return;
                  }
                  document.title = flashCount % 2 === 0 
                    ? `🚨 TEXT NOT FOUND: "${text}"` 
                    : `⚠️ CHECK NOW!`;
                  flashCount++;
                }, 500);
              },
              args: [searchText]
            });
          } catch (flashError) {
            console.error('Flash title error:', flashError);
          }

          // Show Chrome notification as backup
          try {
            await chrome.notifications.create(`text-missing-${tabId}-${Date.now()}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: '🚨 Text Not Found - Refresh Stopped!',
              message: `"${searchText}" is missing from ${pageTitle}. Auto-refresh has been stopped.`,
              priority: 2,
              requireInteraction: true
            });
            console.log('Notification created successfully');
          } catch (notifError) {
            console.error('Notification error:', notifError);
          }

          // Update badge to show warning (keep it since refresh is stopped)
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
    const searchText = pendingTextChecks.get(tabId);
    pendingTextChecks.delete(tabId);

    // Small delay to ensure DOM is ready
    setTimeout(() => checkTextOnPage(tabId, searchText), 500);
  }
});

async function startRefresh(tabId, intervalSeconds, searchText = '') {
  await stopRefresh(tabId);

  const intervalMs = intervalSeconds * 1000;
  const nextRefresh = Date.now() + intervalMs;

  await chrome.storage.local.set({
    [`refresh_${tabId}`]: {
      isActive: true,
      interval: intervalSeconds,
      nextRefresh: nextRefresh,
      searchText: searchText
    }
  });

  const alarmName = `refresh_${tabId}`;
  await chrome.alarms.create(alarmName, {
    periodInMinutes: intervalSeconds / 60
  });

  activeRefreshers.set(tabId, {
    interval: intervalSeconds,
    alarmName: alarmName,
    searchText: searchText
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
