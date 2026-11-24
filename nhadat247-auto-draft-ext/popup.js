// popup.js - Nhadat247 Auto Drafts Control Panel

const DRAFT_URL = "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft";

// DOM Elements
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const statCount = document.getElementById("stat-count");
const statMode = document.getElementById("stat-mode");
const activeDesc = document.getElementById("active-desc");

const btnTest2 = document.getElementById("btn-test-2");
const btnRunAll = document.getElementById("btn-run-all");
const btnStop = document.getElementById("btn-stop");
const btnReset = document.getElementById("btn-reset");
const btnOpenDrafts = document.getElementById("btn-open-drafts");
const btnClearLogs = document.getElementById("btn-clear-logs");
const logBox = document.getElementById("log-box");

function addLog(msg, type = "info") {
  const timeStr = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  chrome.storage.local.get(["logs"], (res) => {
    const logs = res.logs || [];
    logs.push({ time: timeStr, msg: msg, type: type });
    if (logs.length > 50) logs.shift();
    chrome.storage.local.set({ logs: logs });
  });
}

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logBox.innerHTML = '<div class="log-entry log-system">[Hệ thống] Chưa có lịch sử thao tác.</div>';
    return;
  }
  logBox.innerHTML = "";
  logs.forEach((item) => {
    const el = document.createElement("div");
    el.className = "log-entry";
    let colorClass = "log-system";
    if (item.type === "success") colorClass = "log-success";
    else if (item.type === "warn") colorClass = "log-warn";
    else if (item.type === "err") colorClass = "log-err";

    el.innerHTML = `<span class="log-time">[${item.time}]</span> <span class="${colorClass}">${escapeHtml(item.msg)}</span>`;
    logBox.appendChild(el);
  });
  logBox.scrollTop = logBox.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function updateUI(state) {
  const isRunning = !!state.isRunning;
  const count = state.processedCount || (state.processedIds ? state.processedIds.length : 0);
  const limit = state.limit || 0;
  const desc = state.currentStatusText || "Sẵn sàng.";

  // Status Pill
  if (isRunning) {
    statusPill.className = "status-pill status-running";
    statusText.textContent = "Đang chạy...";
    btnTest2.disabled = true;
    btnRunAll.disabled = true;
    btnStop.disabled = false;
  } else {
    statusPill.className = "status-pill status-stopped";
    statusText.textContent = "Đang dừng";
    btnTest2.disabled = false;
    btnRunAll.disabled = false;
    btnStop.disabled = true;
  }

  // Count & Mode
  statCount.textContent = count;
  if (!isRunning && count === 0) {
    statMode.textContent = "Chưa chạy";
    statMode.className = "stat-val mode-idle";
  } else if (limit === 2) {
    statMode.textContent = "Thử 2 tin";
    statMode.className = "stat-val mode-test";
  } else if (limit === 0) {
    statMode.textContent = "Tất cả";
    statMode.className = "stat-val mode-all";
  } else {
    statMode.textContent = `Tối đa ${limit}`;
    statMode.className = "stat-val mode-test";
  }

  activeDesc.textContent = desc;

  if (state.logs) {
    renderLogs(state.logs);
  }
}

// Ensure active tab navigates to draft list if user clicks start
function ensureOnDraftPage(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      const activeTab = tabs[0];
      const url = activeTab.url || "";
      if (url.includes("nhadat247.vn")) {
        if (!url.includes("status=draft") && !url.includes("/dang-tin/")) {
          chrome.tabs.update(activeTab.id, { url: DRAFT_URL }, () => {
            if (callback) callback();
          });
        } else {
          if (callback) callback();
        }
      } else {
        // Tab not on nhadat247, open or navigate
        chrome.tabs.update(activeTab.id, { url: DRAFT_URL }, () => {
          if (callback) callback();
        });
      }
    } else {
      chrome.tabs.create({ url: DRAFT_URL }, () => {
        if (callback) callback();
      });
    }
  });
}

// Initial load
chrome.storage.local.get(
  ["isRunning", "limit", "processedCount", "processedIds", "currentStatusText", "logs"],
  (state) => {
    updateUI(state || {});
  }
);

// Listen for storage changes in real-time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    chrome.storage.local.get(
      ["isRunning", "limit", "processedCount", "processedIds", "currentStatusText", "logs"],
      (state) => {
        updateUI(state || {});
      }
    );
  }
});

// Button Handlers
btnTest2.addEventListener("click", () => {
  ensureOnDraftPage(() => {
    chrome.storage.local.set({
      isRunning: true,
      limit: 2,
      currentStatusText: "Đang bắt đầu chạy thử nghiệm 2 tin nháp..."
    });
    addLog("Bắt đầu chạy thử nghiệm: Giới hạn 2 tin nháp.", "info");
  });
});

btnRunAll.addEventListener("click", () => {
  ensureOnDraftPage(() => {
    chrome.storage.local.set({
      isRunning: true,
      limit: 0,
      currentStatusText: "Đang bắt đầu chạy tự động toàn bộ tin nháp..."
    });
    addLog("Bắt đầu chạy tự động: Toàn bộ danh sách tin nháp.", "info");
  });
});

btnStop.addEventListener("click", () => {
  chrome.storage.local.set({
    isRunning: false,
    currentStatusText: "Đã dừng lại theo yêu cầu."
  });
  addLog("Đã dừng tự động hóa theo lệnh người dùng.", "warn");
});

btnReset.addEventListener("click", () => {
  if (confirm("Bạn có chắc chắn muốn xóa lịch sử các tin đã xử lý để chạy lại từ đầu?")) {
    chrome.storage.local.set({
      processedIds: [],
      processedCount: 0,
      currentDraftId: "",
      currentStatusText: "Đã xóa lịch sử. Có thể chạy lại từ đầu."
    });
    addLog("Đã xóa trắng danh sách tin đã xử lý.", "warn");
  }
});

btnOpenDrafts.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url && tabs[0].url.includes("nhadat247.vn")) {
      chrome.tabs.update(tabs[0].id, { url: DRAFT_URL });
    } else {
      chrome.tabs.create({ url: DRAFT_URL });
    }
  });
});

btnClearLogs.addEventListener("click", () => {
  chrome.storage.local.set({ logs: [] });
  renderLogs([]);
});
