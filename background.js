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

          // Open bold popup alert window - MAXIMIZED for multi-monitor visibility
          const alertUrl = chrome.runtime.getURL('alert.html') +
            `?text=${encodeURIComponent(searchText)}&title=${encodeURIComponent(pageTitle)}`;

          chrome.windows.create({
            url: alertUrl,
            type: 'popup',
            state: 'maximized',
            focused: true
          });

          // Add a flashing red overlay on the original page for visibility
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: (text) => {
                // Create fullscreen flashing overlay
                const overlay = document.createElement('div');
                overlay.id = 'auto-refresh-alert-overlay';
                overlay.innerHTML = `
                  <div style="
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: rgba(255, 0, 0, 0.9);
                    z-index: 2147483647;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    flex-direction: column;
                    animation: flash 0.5s ease-in-out infinite alternate;
                  ">
                    <div style="font-size: 100px; margin-bottom: 20px;">🚨</div>
                    <div style="color: white; font-size: 48px; font-weight: bold; text-align: center; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                      TEXT NOT FOUND!
                    </div>
                    <div style="color: white; font-size: 24px; margin-top: 20px; text-align: center; max-width: 80%;">
                      "${text}" is missing from this page
                    </div>
                    <div style="color: #ffcdd2; font-size: 18px; margin-top: 30px;">
                      Auto-refresh has been stopped
                    </div>
                    <button onclick="this.parentElement.parentElement.remove()" style="
                      margin-top: 40px;
                      padding: 20px 60px;
                      font-size: 24px;
                      font-weight: bold;
                      background: white;
                      color: #d50000;
                      border: none;
                      border-radius: 50px;
                      cursor: pointer;
                    ">
                      DISMISS
                    </button>
                  </div>
                `;

                // Add flash animation
                const style = document.createElement('style');
                style.textContent = `
                  @keyframes flash {
                    0% { background: rgba(255, 0, 0, 0.9); }
                    100% { background: rgba(180, 0, 0, 0.95); }
                  }
                `;
                document.head.appendChild(style);
                document.body.appendChild(overlay);

                // Flash the title
                const originalTitle = document.title;
                let flashCount = 0;
                const maxFlashes = 60; // Flash for 30 seconds

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
            console.error('Flash overlay error:', flashError);
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
