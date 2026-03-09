const activeRefreshers = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startRefresh(message.tabId, message.interval);
    sendResponse({ success: true });
  } else if (message.action === 'stop') {
    stopRefresh(message.tabId);
    sendResponse({ success: true });
  }
  return true;
});

async function startRefresh(tabId, intervalSeconds) {
  stopRefresh(tabId);

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
}

async function stopRefresh(tabId) {
  const alarmName = `refresh_${tabId}`;
  await chrome.alarms.clear(alarmName);
  await chrome.storage.local.remove(`refresh_${tabId}`);
  activeRefreshers.delete(tabId);
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

chrome.runtime.onStartup.addListener(async () => {
  const allAlarms = await chrome.alarms.getAll();
  for (const alarm of allAlarms) {
    if (alarm.name.startsWith('refresh_')) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  await chrome.storage.local.clear();
});
