/**
 * FlowVoice Local Data Store
 * Persists History, Notes, and Settings to local JSON storage.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

function readJSON(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8");
      return JSON.parse(content);
    }
  } catch (e) {
    console.error(`[DataStore] Error reading ${file}:`, e);
  }
  return defaultVal;
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(`[DataStore] Error writing ${file}:`, e);
  }
}

// --- History API ---
function getHistory() {
  return readJSON(HISTORY_FILE, []);
}

function addHistoryItem(item) {
  const history = getHistory();
  const entry = {
    id: item.id || "item_" + Date.now(),
    text: item.text || "",
    appTitle: item.appTitle || "Desktop",
    duration: item.duration || 0,
    latency: item.latency || 0,
    timestamp: item.timestamp || new Date().toISOString(),
    wordCount: (item.text || "").trim().split(/\s+/).filter(Boolean).length
  };
  history.unshift(entry); // newest first
  // Keep last 500 entries
  if (history.length > 500) history.pop();
  writeJSON(HISTORY_FILE, history);
  return entry;
}

function deleteHistoryItem(id) {
  let history = getHistory();
  history = history.filter(h => h.id !== id);
  writeJSON(HISTORY_FILE, history);
  return history;
}

function clearHistory() {
  writeJSON(HISTORY_FILE, []);
  return [];
}

// --- Notes API ---
const DEFAULT_NOTES = [
  {
    id: "welcome_note",
    title: "Welcome to FlowVoice Notes 🎙️",
    content: "## Welcome to your voice-powered scratchpad!\n\nThis is your private, offline note-taking hub.\n\n### How to use:\n- **Dictate directly into this note**: Click the **Start Dictation** button above, or press **F8** anywhere while this window is active!\n- **Formatting**: Supports markdown headers (`##`), bullet points, and quick voice commands.\n- **Voice Commands**: Say *'new line'* for line breaks, *'comma'* for `,`, or *'period'* for `.`.\n\nEnjoy 100% private, offline speech-to-text without limits!",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  }
];

function getNotes() {
  const notes = readJSON(NOTES_FILE, null);
  if (!notes || notes.length === 0) {
    writeJSON(NOTES_FILE, DEFAULT_NOTES);
    return DEFAULT_NOTES;
  }
  return notes;
}

function saveNote(note) {
  const notes = getNotes();
  const index = notes.findIndex(n => n.id === note.id);
  const now = new Date().toISOString();
  if (index >= 0) {
    notes[index] = { ...notes[index], ...note, updatedAt: now };
  } else {
    const newNote = {
      id: note.id || "note_" + Date.now(),
      title: note.title || "Untitled Note",
      content: note.content || "",
      createdAt: now,
      updatedAt: now
    };
    notes.unshift(newNote);
  }
  writeJSON(NOTES_FILE, notes);
  return notes;
}

function deleteNote(id) {
  let notes = getNotes();
  notes = notes.filter(n => n.id !== id);
  writeJSON(NOTES_FILE, notes);
  return notes;
}

// --- Settings API ---
const DEFAULT_SETTINGS = {
  hotkey: "F8",
  mode: "hybrid", // hybrid, ptt, toggle
  model: "tiny.en",
  micDevice: "default",
  showOverlay: true,
  overlayPosition: "bottom-center",
  autoPunctuation: true,
  verbalCommands: true,
  soundEffects: true,
  theme: "dark"
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON(SETTINGS_FILE, {}) };
}

function saveSettings(newSettings) {
  const current = getSettings();
  const updated = { ...current, ...newSettings };
  writeJSON(SETTINGS_FILE, updated);
  return updated;
}

// --- Dictionary API (Custom Vocabulary) ---
const DICTIONARY_FILE = path.join(DATA_DIR, "dictionary.json");
const DEFAULT_DICTIONARY = [
  "Whisper",
  "FlowVoice",
  "Antigravity",
  "PyTorch",
  "Electron",
  "Faster-Whisper",
  "Kubernetes",
  "TypeScript",
  "API",
  "UI/UX"
];

function getDictionary() {
  const dict = readJSON(DICTIONARY_FILE, null);
  if (!dict || dict.length === 0) {
    writeJSON(DICTIONARY_FILE, DEFAULT_DICTIONARY);
    return DEFAULT_DICTIONARY;
  }
  return dict;
}

function addDictionaryWord(word) {
  const cleaned = (word || "").trim();
  if (!cleaned) return getDictionary();
  const dict = getDictionary();
  if (!dict.includes(cleaned)) {
    dict.push(cleaned);
    dict.sort((a, b) => a.localeCompare(b));
    writeJSON(DICTIONARY_FILE, dict);
  }
  return dict;
}

function deleteDictionaryWord(word) {
  let dict = getDictionary();
  dict = dict.filter(w => w.toLowerCase() !== (word || "").toLowerCase());
  writeJSON(DICTIONARY_FILE, dict);
  return dict;
}

// --- Snippets API (Text Expansions) ---
const SNIPPETS_FILE = path.join(DATA_DIR, "snippets.json");
const DEFAULT_SNIPPETS = [
  {
    id: "snip_email",
    shortcut: ";email",
    text: "alex@example.com",
    label: "My Personal Email"
  },
  {
    id: "snip_meet",
    shortcut: ";meet",
    text: "Looking forward to speaking with you! Here is my calendar link to grab 15 minutes that work for you.",
    label: "Meeting Invite Pitch"
  },
  {
    id: "snip_sig",
    shortcut: ";sig",
    text: "Best regards,\nAlex | AI Engineer & Product Designer",
    label: "Professional Email Signature"
  }
];

function getSnippets() {
  const snips = readJSON(SNIPPETS_FILE, null);
  if (!snips || snips.length === 0) {
    writeJSON(SNIPPETS_FILE, DEFAULT_SNIPPETS);
    return DEFAULT_SNIPPETS;
  }
  return snips;
}

function saveSnippet(snippet) {
  const snips = getSnippets();
  const idx = snips.findIndex(s => s.id === snippet.id);
  if (idx >= 0) {
    snips[idx] = { ...snips[idx], ...snippet };
  } else {
    snips.unshift({
      id: snippet.id || "snip_" + Date.now(),
      shortcut: snippet.shortcut || ";shortcut",
      text: snippet.text || "",
      label: snippet.label || "Untitled Snippet"
    });
  }
  writeJSON(SNIPPETS_FILE, snips);
  return snips;
}

function deleteSnippet(id) {
  let snips = getSnippets();
  snips = snips.filter(s => s.id !== id);
  writeJSON(SNIPPETS_FILE, snips);
  return snips;
}

module.exports = {
  getHistory,
  addHistoryItem,
  deleteHistoryItem,
  clearHistory,
  getNotes,
  saveNote,
  deleteNote,
  getSettings,
  saveSettings,
  getDictionary,
  addDictionaryWord,
  deleteDictionaryWord,
  getSnippets,
  saveSnippet,
  deleteSnippet
};

