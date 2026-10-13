const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Window controls
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),

  // History API
  getHistory: () => ipcRenderer.invoke("get-history"),
  addHistoryItem: (item) => ipcRenderer.invoke("add-history-item", item),
  deleteHistoryItem: (id) => ipcRenderer.invoke("delete-history-item", id),
  clearHistory: () => ipcRenderer.invoke("clear-history"),

  // Notes API
  getNotes: () => ipcRenderer.invoke("get-notes"),
  saveNote: (note) => ipcRenderer.invoke("save-note", note),
  deleteNote: (id) => ipcRenderer.invoke("delete-note", id),

  // Settings API
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // Dictionary API
  getDictionary: () => ipcRenderer.invoke("get-dictionary"),
  addDictionaryWord: (word) => ipcRenderer.invoke("add-dictionary-word", word),
  deleteDictionaryWord: (word) => ipcRenderer.invoke("delete-dictionary-word", word),

  // Snippets API
  getSnippets: () => ipcRenderer.invoke("get-snippets"),
  saveSnippet: (snippet) => ipcRenderer.invoke("save-snippet", snippet),
  deleteSnippet: (id) => ipcRenderer.invoke("delete-snippet", id),

  // Utilities
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),
  onDictationCompleted: (callback) => {
    ipcRenderer.on("dictation-completed", (event, data) => callback(data));
  }
});
