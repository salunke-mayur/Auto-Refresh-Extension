const $ = id => document.getElementById(id);
let tabId = null;
let timer;

async function init() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  tabId = tabs[0].id;

  const data = await chrome.storage.local.get([`refresh_${tabId}`]);
  const d = data[`refresh_${tabId}`];
  if (d?.isActive) {
    $('status').textContent = 'ON';
    $('status').className = 'status on';
    $('interval').value = d.interval;
    $('interval').disabled = true;
    $('text').value = d.searchText || '';
    $('text').disabled = true;
    $('sound').checked = d.notificationPrefs?.sound !== false;
    $('popup').checked = d.notificationPrefs?.popup !== false;
    $('sound').disabled = $('popup').disabled = true;
    $('startBtn').disabled = true;
    $('stopBtn').disabled = false;
    countdown(d.nextRefresh);
  }
}

function countdown(next) {
  clearInterval(timer);
  const tick = () => {
    const s = Math.max(0, Math.ceil((next - Date.now()) / 1000));
    $('info').textContent = s > 0 ? `Refreshing in ${s}s` : 'Refreshing...';
  };
  tick();
  timer = setInterval(tick, 1000);
}

$('startBtn').onclick = async () => {
  if (!tabId) {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    tabId = tabs[0].id;
  }
  const interval = parseInt($('interval').value);
  if (isNaN(interval) || interval < 1 || interval > 3600) {
    alert('Enter 1-3600 seconds');
    return;
  }
  await chrome.runtime.sendMessage({
    action: 'start',
    tabId,
    interval,
    searchText: $('text').value.trim(),
    notificationPrefs: { sound: $('sound').checked, popup: $('popup').checked }
  });
  window.close();
};

$('stopBtn').onclick = async () => {
  if (!tabId) {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    tabId = tabs[0].id;
  }
  await chrome.runtime.sendMessage({ action: 'stop', tabId });
  window.close();
};

init();
