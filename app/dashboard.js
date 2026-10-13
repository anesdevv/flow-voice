/**
 * FlowVoice Dashboard Interactive Client
 * Powers History, Notes, and Settings with real-time WebSocket sync.
 */

// State
let currentTab = "history";
let historyItems = [];
let notesList = [];
let dictionaryWords = [];
let snippetsList = [];
let activeNoteId = null;
let currentSettings = {};
let ws = null;
let isRecording = false;
let noteSaveTimeout = null;

// DOM Elements
const navItems = document.querySelectorAll(".nav-item");
const tabPanes = document.querySelectorAll(".tab-pane");
const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toastMsg");

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", async () => {
  setupWindowControls();
  setupNavigation();
  setupWebSocket();

  await loadSettings();
  await loadHistory();
  await loadNotes();
  await loadDictionary();
  await loadSnippets();

  setupHistoryFilters();
  setupNotesHandlers();
  setupDictionaryHandlers();
  setupSnippetsHandlers();
  setupSettingsHandlers();
});

// --- Toast Feedback ---
function showToast(message) {
  toastMsg.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

// --- Window Controls ---
function setupWindowControls() {
  document.getElementById("btnMinimize")?.addEventListener("click", () => {
    window.api?.minimizeWindow();
  });
  document.getElementById("btnMaximize")?.addEventListener("click", () => {
    window.api?.maximizeWindow();
  });
  document.getElementById("btnClose")?.addEventListener("click", () => {
    window.api?.closeWindow();
  });
}

// --- Navigation Tabs ---
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });
}

function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.getAttribute("data-tab") === tabName);
  });
  document.querySelectorAll(".tab-pane").forEach(pane => {
    pane.classList.toggle("active", pane.id === `pane-${tabName}`);
  });
}
window.switchTab = switchTab;


// --- WebSocket Sync with FlowEngine ---
function setupWebSocket() {
  const dictateBtn = document.getElementById("btnManualDictate");
  const dictateLabel = document.getElementById("dictateBtnLabel");

  function connect() {
    ws = new WebSocket("ws://127.0.0.1:48123");

    ws.onopen = () => {
      console.log("[Dashboard] Connected to FlowVoice WebSocket engine");
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        handleEngineMessage(data);
      } catch (e) {
        console.error("[Dashboard] Error parsing WebSocket message:", e);
      }
    };

    ws.onclose = () => {
      console.log("[Dashboard] WebSocket disconnected, reconnecting in 2s...");
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  connect();

  // Manual Dictate Button
  dictateBtn?.addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast("Engine connecting...");
      return;
    }
    if (!isRecording) {
      ws.send(JSON.stringify({ action: "manual_start" }));
    } else {
      ws.send(JSON.stringify({ action: "manual_stop" }));
    }
  });
}

async function handleEngineMessage(data) {
  const dictateBtn = document.getElementById("btnManualDictate");
  const dictateLabel = document.getElementById("dictateBtnLabel");
  const noteMicBtn = document.getElementById("btnDictateIntoNote");
  const micLevelFill = document.getElementById("micLevelFill");
  const micLevelLabel = document.getElementById("micLevelLabel");

  if (data.type === "status") {
    const status = data.status;
    if (status === "recording") {
      isRecording = true;
      dictateLabel.textContent = "Listening...";
      dictateBtn.style.background = "linear-gradient(135deg, #e11d48, #be123c)";
      noteMicBtn?.classList.add("recording");
    } else if (status === "transcribing") {
      dictateLabel.textContent = "Transcribing...";
      dictateBtn.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
      noteMicBtn?.classList.remove("recording");
    } else if (status === "pasting") {
      dictateLabel.textContent = "Pasting...";
      dictateBtn.style.background = "linear-gradient(135deg, #059669, #047857)";
    } else if (status === "idle") {
      isRecording = false;
      dictateLabel.textContent = "Dictate Now";
      dictateBtn.style.background = "";
      noteMicBtn?.classList.remove("recording");
      if (micLevelFill) micLevelFill.style.width = "0%";
      if (micLevelLabel) micLevelLabel.textContent = "0%";
    }
  } else if (data.type === "volume") {
    const vol = data.value || 0;
    const pct = Math.round(vol * 100);
    if (micLevelFill) micLevelFill.style.width = `${Math.min(100, pct)}%`;
    if (micLevelLabel) micLevelLabel.textContent = `${Math.min(100, pct)}%`;
  } else if (data.type === "dictation_completed") {
    // New dictation item arrived!
    const newItem = {
      id: "item_" + Date.now(),
      text: data.text,
      appTitle: data.appTitle || "Active App",
      duration: data.duration || 0,
      latency: data.latency || 0,
      timestamp: new Date().toISOString()
    };

    // Save to local DataStore
    if (window.api?.addHistoryItem) {
      await window.api.addHistoryItem(newItem);
    }
    historyItems.unshift(newItem);
    renderHistory(historyItems);
    updateHistoryCountBadge();

    // If active in Notes tab with a note open, append directly to note!
    if (currentTab === "notes" && activeNoteId) {
      appendDictationToActiveNote(data.text);
    }

    showToast(`Dictated: "${data.text.slice(0, 35)}${data.text.length > 35 ? "..." : ""}"`);
  }
}

// --- History Feature ---
async function loadHistory() {
  if (window.api?.getHistory) {
    historyItems = await window.api.getHistory();
  }
  renderHistory(historyItems);
  updateHistoryCountBadge();
}

function updateHistoryCountBadge() {
  const badge = document.getElementById("historyCountBadge");
  if (badge) badge.textContent = historyItems.length;
}

function renderHistory(items) {
  const feed = document.getElementById("historyFeed");
  const empty = document.getElementById("historyEmptyState");

  if (!items || items.length === 0) {
    feed.innerHTML = "";
    empty.style.display = "flex";
    return;
  }

  empty.style.display = "none";
  feed.innerHTML = items.map(item => {
    const relativeTime = formatRelativeTime(item.timestamp);
    const words = (item.text || "").trim().split(/\s+/).filter(Boolean).length;
    const appLogo = getAppLogo(item.appTitle);

    return `
      <div class="history-card" data-id="${item.id}">
        <div class="history-card-header">
          <div class="history-app-info">
            <div class="app-icon-badge">
              <img src="${appLogo.src}" class="app-card-logo-img" alt="${appLogo.name}" onerror="this.onerror=null;this.src='assets/logos/flow-symbol.svg'">
            </div>
            <span class="app-name-label" title="${escapeHtml(item.appTitle)}">${escapeHtml(appLogo.name)}</span>
          </div>
          <div class="history-meta-group">
            <span>${relativeTime}</span>
          </div>
        </div>
        <div class="history-text">${escapeHtml(item.text)}</div>
        <div class="history-card-actions">
          <span class="history-metrics">${words} words · ${item.duration ? item.duration + "s" : ""}</span>
          <div class="history-buttons">
            <button class="card-action-btn copy-btn" data-text="${escapeHtml(item.text)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy
            </button>
            <button class="card-action-btn add-note-btn" data-text="${escapeHtml(item.text)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              Add to Note
            </button>
            <button class="card-action-btn delete delete-btn" data-id="${item.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Attach card event listeners
  feed.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-text");
      copyText(text);
    });
  });

  feed.querySelectorAll(".add-note-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-text");
      createNoteFromText(text);
    });
  });

  feed.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await deleteHistory(id);
    });
  });
}

async function deleteHistory(id) {
  if (window.api?.deleteHistoryItem) {
    historyItems = await window.api.deleteHistoryItem(id);
  } else {
    historyItems = historyItems.filter(h => h.id !== id);
  }
  renderHistory(historyItems);
  updateHistoryCountBadge();
  showToast("Dictation deleted");
}

function setupHistoryFilters() {
  const searchInput = document.getElementById("historySearchInput");
  const clearSearchBtn = document.getElementById("btnClearSearch");
  const filterPills = document.querySelectorAll(".filter-pill");
  const clearBtn = document.getElementById("btnClearHistory");

  let activeFilter = "all";

  function applyFilters() {
    const q = (searchInput.value || "").trim().toLowerCase();
    clearSearchBtn.style.display = q ? "block" : "none";

    let filtered = historyItems;
    if (activeFilter === "notepad") {
      filtered = filtered.filter(h => h.appTitle.toLowerCase().includes("notepad"));
    } else if (activeFilter === "chrome") {
      filtered = filtered.filter(h => h.appTitle.toLowerCase().includes("chrome") || h.appTitle.toLowerCase().includes("edge") || h.appTitle.toLowerCase().includes("youtube"));
    } else if (activeFilter === "code") {
      filtered = filtered.filter(h => h.appTitle.toLowerCase().includes("code") || h.appTitle.toLowerCase().includes("visual studio"));
    } else if (activeFilter === "terminal") {
      filtered = filtered.filter(h => h.appTitle.toLowerCase().includes("terminal") || h.appTitle.toLowerCase().includes("powershell") || h.appTitle.toLowerCase().includes("cmd"));
    }

    if (q) {
      filtered = filtered.filter(h => (h.text && h.text.toLowerCase().includes(q)) || (h.appTitle && h.appTitle.toLowerCase().includes(q)));
    }

    renderHistory(filtered);
  }

  searchInput?.addEventListener("input", applyFilters);
  clearSearchBtn?.addEventListener("click", () => {
    searchInput.value = "";
    applyFilters();
  });

  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.getAttribute("data-filter");
      applyFilters();
    });
  });

  clearBtn?.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear your entire dictation history?")) {
      if (window.api?.clearHistory) {
        historyItems = await window.api.clearHistory();
      } else {
        historyItems = [];
      }
      renderHistory(historyItems);
      updateHistoryCountBadge();
      showToast("History cleared");
    }
  });
}

// --- Notes Feature ---
async function loadNotes() {
  if (window.api?.getNotes) {
    notesList = await window.api.getNotes();
  }
  if (notesList.length > 0 && !activeNoteId) {
    activeNoteId = notesList[0].id;
  }
  renderNotesList();
  renderActiveNote();
  updateNotesCountBadge();
}

function updateNotesCountBadge() {
  const badge = document.getElementById("notesCountBadge");
  const listCount = document.getElementById("notesListCount");
  if (badge) badge.textContent = notesList.length;
  if (listCount) listCount.textContent = notesList.length;
}

function renderNotesList() {
  const container = document.getElementById("notesCardList");
  const q = (document.getElementById("notesSearchInput")?.value || "").toLowerCase();

  let filtered = notesList;
  if (q) {
    filtered = filtered.filter(n => (n.title && n.title.toLowerCase().includes(q)) || (n.content && n.content.toLowerCase().includes(q)));
  }

  container.innerHTML = filtered.map(note => {
    const isActive = note.id === activeNoteId;
    const preview = note.content ? note.content.replace(/[#*`\n]/g, " ").trim().slice(0, 60) : "No content";
    const dateStr = formatRelativeTime(note.updatedAt || note.createdAt);

    return `
      <div class="note-card-item ${isActive ? "active" : ""}" data-id="${note.id}">
        <div class="note-card-title">${escapeHtml(note.title || "Untitled")}</div>
        <div class="note-card-preview">${escapeHtml(preview)}</div>
        <div class="note-card-date">${dateStr}</div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".note-card-item").forEach(item => {
    item.addEventListener("click", () => {
      activeNoteId = item.getAttribute("data-id");
      renderNotesList();
      renderActiveNote();
    });
  });
}

function renderActiveNote() {
  const titleField = document.getElementById("activeNoteTitle");
  const contentField = document.getElementById("activeNoteContent");
  const timestampLabel = document.getElementById("noteTimestampLabel");
  const statsLabel = document.getElementById("noteStatsLabel");

  const note = notesList.find(n => n.id === activeNoteId);
  if (!note) {
    if (notesList.length > 0) {
      activeNoteId = notesList[0].id;
      renderActiveNote();
    } else {
      titleField.value = "";
      contentField.value = "";
      timestampLabel.textContent = "No notes";
      statsLabel.textContent = "0 words";
    }
    return;
  }

  titleField.value = note.title || "";
  contentField.value = note.content || "";
  timestampLabel.textContent = "Last edited: " + formatRelativeTime(note.updatedAt || note.createdAt);
  updateNoteStats(note.content || "");
}

function updateNoteStats(text) {
  const statsLabel = document.getElementById("noteStatsLabel");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  if (statsLabel) {
    statsLabel.textContent = `${words} words, ${chars} characters`;
  }
}

function setupNotesHandlers() {
  const titleField = document.getElementById("activeNoteTitle");
  const contentField = document.getElementById("activeNoteContent");
  const btnNew = document.getElementById("btnNewNote");
  const btnCopy = document.getElementById("btnCopyNote");
  const btnDelete = document.getElementById("btnDeleteNote");
  const btnDictateNote = document.getElementById("btnDictateIntoNote");
  const notesSearch = document.getElementById("notesSearchInput");

  function triggerAutoSave() {
    clearTimeout(noteSaveTimeout);
    noteSaveTimeout = setTimeout(async () => {
      if (!activeNoteId) return;
      const note = notesList.find(n => n.id === activeNoteId);
      if (note) {
        note.title = titleField.value.trim() || "Untitled Note";
        note.content = contentField.value;
        note.updatedAt = new Date().toISOString();
        if (window.api?.saveNote) {
          notesList = await window.api.saveNote(note);
        }
        renderNotesList();
        updateNoteStats(note.content);
      }
    }, 400);
  }

  titleField?.addEventListener("input", triggerAutoSave);
  contentField?.addEventListener("input", () => {
    updateNoteStats(contentField.value);
    triggerAutoSave();
  });

  btnNew?.addEventListener("click", async () => {
    const newNote = {
      id: "note_" + Date.now(),
      title: "New Note",
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (window.api?.saveNote) {
      notesList = await window.api.saveNote(newNote);
    } else {
      notesList.unshift(newNote);
    }
    activeNoteId = newNote.id;
    renderNotesList();
    renderActiveNote();
    updateNotesCountBadge();
    titleField.focus();
    showToast("New note created");
  });

  btnCopy?.addEventListener("click", () => {
    const note = notesList.find(n => n.id === activeNoteId);
    if (note && note.content) {
      copyText(note.content);
    }
  });

  btnDelete?.addEventListener("click", async () => {
    if (!activeNoteId) return;
    if (confirm("Delete this note?")) {
      if (window.api?.deleteNote) {
        notesList = await window.api.deleteNote(activeNoteId);
      } else {
        notesList = notesList.filter(n => n.id !== activeNoteId);
      }
      activeNoteId = notesList.length > 0 ? notesList[0].id : null;
      renderNotesList();
      renderActiveNote();
      updateNotesCountBadge();
      showToast("Note deleted");
    }
  });

  btnDictateNote?.addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast("Engine connecting...");
      return;
    }
    if (!isRecording) {
      ws.send(JSON.stringify({ action: "manual_start" }));
      btnDictateNote.classList.add("recording");
    } else {
      ws.send(JSON.stringify({ action: "manual_stop" }));
      btnDictateNote.classList.remove("recording");
    }
  });

  notesSearch?.addEventListener("input", renderNotesList);
}

function appendDictationToActiveNote(text) {
  const contentField = document.getElementById("activeNoteContent");
  if (!contentField) return;

  const current = contentField.value;
  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  contentField.value = current + separator + text;

  // Auto-save
  const note = notesList.find(n => n.id === activeNoteId);
  if (note) {
    note.content = contentField.value;
    note.updatedAt = new Date().toISOString();
    if (window.api?.saveNote) {
      window.api.saveNote(note);
    }
    renderNotesList();
    updateNoteStats(note.content);
  }
}

function createNoteFromText(text) {
  const words = text.trim().split(/\s+/).slice(0, 5).join(" ");
  const newNote = {
    id: "note_" + Date.now(),
    title: words ? words + "..." : "Dictation Note",
    content: text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (window.api?.saveNote) {
    window.api.saveNote(newNote).then(updated => {
      notesList = updated;
      activeNoteId = newNote.id;
      switchTab("notes");
      renderNotesList();
      renderActiveNote();
      updateNotesCountBadge();
      showToast("Saved to Notes!");
    });
  }
}

// --- Settings Feature ---
async function loadSettings() {
  if (window.api?.getSettings) {
    currentSettings = await window.api.getSettings();
  }

  const hotkeySelect = document.getElementById("settingHotkey");
  const modeSelect = document.getElementById("settingMode");
  const modelSelect = document.getElementById("settingModel");
  const verbalCheck = document.getElementById("settingVerbalCommands");
  const autoPunctCheck = document.getElementById("settingAutoPunctuation");
  const overlayCheck = document.getElementById("settingShowOverlay");
  const overlayPos = document.getElementById("settingOverlayPos");
  const sidebarModelLabel = document.getElementById("sidebarModelLabel");

  if (hotkeySelect) hotkeySelect.value = currentSettings.hotkey || "F8";
  if (modeSelect) modeSelect.value = currentSettings.mode || "hybrid";
  if (modelSelect) modelSelect.value = currentSettings.model || "base.en";
  if (verbalCheck) verbalCheck.checked = currentSettings.verbalCommands !== false;
  if (autoPunctCheck) autoPunctCheck.checked = currentSettings.autoPunctuation !== false;
  if (overlayCheck) overlayCheck.checked = currentSettings.showOverlay !== false;
  if (overlayPos) overlayPos.value = currentSettings.overlayPosition || "bottom-center";
  if (sidebarModelLabel) sidebarModelLabel.textContent = `${currentSettings.model || "base.en"} (INT8)`;
}

function setupSettingsHandlers() {
  const btnSave = document.getElementById("btnSaveSettings");

  btnSave?.addEventListener("click", async () => {
    const updated = {
      hotkey: document.getElementById("settingHotkey").value,
      mode: document.getElementById("settingMode").value,
      model: document.getElementById("settingModel").value,
      verbalCommands: document.getElementById("settingVerbalCommands").checked,
      autoPunctuation: document.getElementById("settingAutoPunctuation").checked,
      showOverlay: document.getElementById("settingShowOverlay").checked,
      overlayPosition: document.getElementById("settingOverlayPos").value
    };

    if (window.api?.saveSettings) {
      currentSettings = await window.api.saveSettings(updated);
    }

    // Sync with WebSocket native engine
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "update_settings",
        settings: updated
      }));
    }

    const sidebarModelLabel = document.getElementById("sidebarModelLabel");
    if (sidebarModelLabel) sidebarModelLabel.textContent = `${updated.model} (INT8)`;

    showToast("Settings saved successfully!");
  });
}

// --- Utilities ---
function copyText(text) {
  if (window.api?.copyToClipboard) {
    window.api.copyToClipboard(text);
  } else {
    navigator.clipboard.writeText(text);
  }
  showToast("Copied to clipboard!");
}

function formatRelativeTime(dateString) {
  if (!dateString) return "Recently";
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getAppLogo(appTitle) {
  const lower = (appTitle || "").toLowerCase();
  if (lower.includes("youtube")) return { src: "assets/appLogos/youtube.jpg", name: "YouTube" };
  if (lower.includes("chrome") || lower.includes("brave") || lower.includes("edge") || lower.includes("browser")) {
    return { src: "assets/appLogos/chrome.png", name: "Google Chrome" };
  }
  if (lower.includes("cursor")) return { src: "assets/appLogos/cursor.png", name: "Cursor" };
  if (lower.includes("code") || lower.includes("studio")) return { src: "assets/appLogos/vscode.jpg", name: "VS Code" };
  if (lower.includes("discord")) return { src: "assets/appLogos/discord.jpg", name: "Discord" };
  if (lower.includes("slack")) return { src: "assets/appLogos/slack.png", name: "Slack" };
  if (lower.includes("notion")) return { src: "assets/appLogos/notion.png", name: "Notion" };
  if (lower.includes("chatgpt")) return { src: "assets/appLogos/chatgpt.png", name: "ChatGPT" };
  if (lower.includes("claude")) return { src: "assets/appLogos/claude.png", name: "Claude" };
  if (lower.includes("terminal") || lower.includes("powershell") || lower.includes("cmd")) {
    return { src: "assets/appLogos/terminal.jpg", name: "Terminal" };
  }
  if (lower.includes("word") || lower.includes("doc")) return { src: "assets/appLogos/word.jpg", name: "Word" };
  if (lower.includes("excel") || lower.includes("sheet")) return { src: "assets/appLogos/excel.jpg", name: "Excel" };
  if (lower.includes("notepad") || lower.includes("notes") || lower.includes("scratchpad")) {
    return { src: "assets/appLogos/notes.png", name: "Notepad" };
  }
  if (lower.includes("telegram")) return { src: "assets/appLogos/telegram.png", name: "Telegram" };
  if (lower.includes("whatsapp")) return { src: "assets/appLogos/whatsapp.png", name: "WhatsApp" };
  if (lower.includes("teams")) return { src: "assets/appLogos/teams.png", name: "Teams" };
  if (lower.includes("github")) return { src: "assets/appLogos/github.jpg", name: "GitHub" };
  if (lower.includes("figma")) return { src: "assets/appLogos/figma.jpg", name: "Figma" };
  if (lower.includes("spotify")) return { src: "assets/appLogos/spotify.jpg", name: "Spotify" };
  return { src: "assets/logos/flow-symbol.svg", name: appTitle || "Desktop App" };
}

// --- Dictionary Implementation ---
async function loadDictionary() {
  if (window.api?.getDictionary) {
    dictionaryWords = await window.api.getDictionary();
  } else {
    dictionaryWords = ["Wispr Flow", "Antigravity", "PyTorch", "Kubernetes", "Whisper", "TypeScript"];
  }
  renderDictionary();
}

function renderDictionary() {
  const container = document.getElementById("dictionaryTagCloud");
  const countBadge = document.getElementById("dictCountBadge");
  if (countBadge) countBadge.textContent = dictionaryWords.length;
  if (!container) return;

  if (dictionaryWords.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13.5px;">No custom vocabulary added yet. Type a word above.</p>`;
    return;
  }

  container.innerHTML = dictionaryWords.map(word => `
    <div class="dict-tag">
      <span>${escapeHtml(word)}</span>
      <span class="dict-tag-remove" data-word="${escapeHtml(word)}" title="Delete word">×</span>
    </div>
  `).join("");

  container.querySelectorAll(".dict-tag-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      const word = btn.getAttribute("data-word");
      if (window.api?.deleteDictionaryWord) {
        dictionaryWords = await window.api.deleteDictionaryWord(word);
      } else {
        dictionaryWords = dictionaryWords.filter(w => w !== word);
      }
      renderDictionary();
      showToast(`Removed "${word}" from dictionary`);
    });
  });
}

function setupDictionaryHandlers() {
  const input = document.getElementById("newWordInput");
  const addBtn = document.getElementById("btnAddWord");

  async function handleAdd() {
    const val = (input.value || "").trim();
    if (!val) return;
    if (window.api?.addDictionaryWord) {
      dictionaryWords = await window.api.addDictionaryWord(val);
    } else {
      if (!dictionaryWords.includes(val)) dictionaryWords.push(val);
    }
    input.value = "";
    renderDictionary();
    showToast(`Added "${val}" to dictionary`);
  }

  addBtn?.addEventListener("click", handleAdd);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAdd();
  });
}

// --- Snippets Implementation ---
async function loadSnippets() {
  if (window.api?.getSnippets) {
    snippetsList = await window.api.getSnippets();
  } else {
    snippetsList = [];
  }
  renderSnippets();
}

function renderSnippets() {
  const container = document.getElementById("snippetsContainer");
  const countBadge = document.getElementById("snipCountBadge");
  if (countBadge) countBadge.textContent = snippetsList.length;
  if (!container) return;

  if (snippetsList.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13.5px;">No snippets created yet. Click "New Snippet" above to add one.</p>`;
    return;
  }

  container.innerHTML = snippetsList.map(snip => `
    <div class="snippet-card" data-id="${snip.id}">
      <div class="snippet-header">
        <span class="snippet-shortcut-badge">${escapeHtml(snip.shortcut)}</span>
        <span class="snippet-title">${escapeHtml(snip.label)}</span>
      </div>
      <div class="snippet-text-preview">${escapeHtml(snip.text)}</div>
      <div class="snippet-actions">
        <button class="card-action-btn copy-snip-btn" data-text="${escapeHtml(snip.text)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 13px; height: 13px;">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
        <button class="card-action-btn delete delete-snip-btn" data-id="${snip.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 13px; height: 13px;">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".copy-snip-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      copyText(btn.getAttribute("data-text"));
    });
  });

  container.querySelectorAll(".delete-snip-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (window.api?.deleteSnippet) {
        snippetsList = await window.api.deleteSnippet(id);
      } else {
        snippetsList = snippetsList.filter(s => s.id !== id);
      }
      renderSnippets();
      showToast("Snippet removed");
    });
  });
}

function setupSnippetsHandlers() {
  const modal = document.getElementById("snippetModal");
  const openBtn = document.getElementById("btnOpenNewSnippetModal");
  const closeBtn = document.getElementById("btnCloseSnippetModal");
  const cancelBtn = document.getElementById("btnCancelSnippet");
  const saveBtn = document.getElementById("btnSaveSnippet");

  const shortcutInput = document.getElementById("snippetShortcutInput");
  const labelInput = document.getElementById("snippetLabelInput");
  const textInput = document.getElementById("snippetTextInput");

  function openModal() {
    shortcutInput.value = ";";
    labelInput.value = "";
    textInput.value = "";
    modal.style.display = "flex";
    shortcutInput.focus();
  }

  function closeModal() {
    modal.style.display = "none";
  }

  openBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  saveBtn?.addEventListener("click", async () => {
    const shortcut = (shortcutInput.value || "").trim();
    const label = (labelInput.value || "").trim();
    const text = (textInput.value || "").trim();

    if (!shortcut || !text) {
      showToast("Please enter shortcut and text");
      return;
    }

    const newSnippet = {
      id: "snip_" + Date.now(),
      shortcut,
      label: label || shortcut,
      text
    };

    if (window.api?.saveSnippet) {
      snippetsList = await window.api.saveSnippet(newSnippet);
    } else {
      snippetsList.unshift(newSnippet);
    }

    closeModal();
    renderSnippets();
    showToast("Snippet saved!");
  });
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
