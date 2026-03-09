const activeRefreshers = new Map();
const badgeIntervals = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startRefresh(message.tabId, message.interval).then(() => {
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

async function startRefresh(tabId, intervalSeconds) {
  await stopRefresh(tabId);

  const intervalMs = intervalSeconds * 1000;
  const nextRefresh = Date.now() + intervalMs;

  await chrome.storage.local.set({
    [`refresh_${tabId}`]: {
      isActive: true,
      interval: intervalSeconds,
      nextRefresh: nextRefresh
    }
  });

  const alarmName = `refresh_${tabId}`;
  await chrome.alarms.create(alarmName, {
    periodInMinutes: intervalSeconds / 60
  });

  activeRefreshers.set(tabId, {
    interval: intervalSeconds,
    alarmName: alarmName
  });

  startBadgeCountdown(tabId);
}

async function stopRefresh(tabId) {
  const alarmName = `refresh_${tabId}`;
  await chrome.alarms.clear(alarmName);
  await chrome.storage.local.remove(`refresh_${tabId}`);
  activeRefreshers.delete(tabId);

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
        await chrome.tabs.reload(tabId);

        const data = await chrome.storage.local.get([`refresh_${tabId}`]);
        const refreshData = data[`refresh_${tabId}`];

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
