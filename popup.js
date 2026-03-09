document.addEventListener('DOMContentLoaded', () => {
  const intervalInput = document.getElementById('interval');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  const nextRefreshEl = document.getElementById('nextRefresh');

  let countdownInterval = null;

  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function updateUI() {
    const tab = await getCurrentTab();
    const data = await chrome.storage.local.get([`refresh_${tab.id}`]);
    const refreshData = data[`refresh_${tab.id}`];

    if (refreshData && refreshData.isActive) {
      statusEl.textContent = 'ON';
      statusEl.className = 'status-on';
      intervalInput.value = refreshData.interval;
      intervalInput.disabled = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      startCountdown(refreshData.nextRefresh);
    } else {
      statusEl.textContent = 'OFF';
      statusEl.className = 'status-off';
      intervalInput.disabled = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      nextRefreshEl.textContent = '';
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }
  }

  function startCountdown(nextRefreshTime) {
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }

    function updateCountdown() {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((nextRefreshTime - now) / 1000));

      if (remaining > 0) {
        nextRefreshEl.textContent = `Next refresh in ${remaining} second${remaining !== 1 ? 's' : ''}`;
      } else {
        nextRefreshEl.textContent = 'Refreshing...';
      }
    }

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  startBtn.addEventListener('click', async () => {
    const interval = parseInt(intervalInput.value, 10);

    if (isNaN(interval) || interval < 1 || interval > 3600) {
      alert('Please enter a valid interval between 1 and 3600 seconds');
      return;
    }

    const tab = await getCurrentTab();

    await chrome.runtime.sendMessage({
      action: 'start',
      tabId: tab.id,
      interval: interval
    });

    await updateUI();
  });

  stopBtn.addEventListener('click', async () => {
    const tab = await getCurrentTab();

    await chrome.runtime.sendMessage({
      action: 'stop',
      tabId: tab.id
    });

    await updateUI();
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      updateUI();
    }
  });

  updateUI();
});
