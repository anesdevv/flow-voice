const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, clipboard } = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const dataStore = require("./data_store");

let dashboardWindow = null;
let overlayWindow = null;
let tray = null;
let engineProcess = null;
let isQuitting = false;

const WS_PORT = 48123;

function freePort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      const lines = out.split("\n");
      for (const line of lines) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== "0" && pid !== String(process.pid)) {
            console.log(`[Main] Freeing port ${port}: terminating stale process ${pid}...`);
            try {
              execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
            } catch (e) {}
          }
        }
      }
    }
  } catch (e) {
    // Port check is best-effort
  }
}

function stopEngine() {
  if (engineProcess && engineProcess.pid) {
    const pid = engineProcess.pid;
    console.log(`[Main] Terminating engine process tree (PID ${pid})...`);
    engineProcess = null;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch (e) {}
  }
}

function startEngine() {
  freePort(WS_PORT);

  const engineScript = path.join(__dirname, "..", "engine", "server.py");
  console.log(`[Main] Spawning FlowVoice Python engine: ${engineScript}`);

  const rootDir = path.join(__dirname, "..");
  engineProcess = spawn("python", ["-u", engineScript], {
    cwd: rootDir,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, PYTHONPATH: rootDir }
  });

  engineProcess.on("exit", (code) => {
    console.log(`[Main] Engine process exited with code ${code}`);
    if (!isQuitting && code !== 0) {
      console.log("[Main] Engine process stopped unexpectedly. Will retry in 2s...");
      setTimeout(() => {
        if (!isQuitting) {
          startEngine();
        }
      }, 2000);
    }
  });
}

// --- Floating Pill Overlay Window ---
function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const width = 300;
  const height = 70;
  const x = Math.round(primaryDisplay.workArea.x + (screenWidth - width) / 2);
  const y = Math.round(primaryDisplay.workArea.y + screenHeight - height - 35);

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    frame: false,
    type: "toolbar", // WS_EX_TOOLWINDOW: hidden from taskbar and Alt+Tab
    skipTaskbar: true,
    focusable: false, // Prevents focus stealing from active target window
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Highest always-on-top level (screen-saver tier)
  overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);

  // Click-through: clicks pass through to whatever application is behind
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));

  overlayWindow.once("ready-to-show", () => {
    overlayWindow.showInactive();
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

// --- Main Dashboard Window (Wispr Flow UI) ---
function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    backgroundColor: "#0d0e12",
    title: "FlowVoice",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dashboardWindow.loadFile(path.join(__dirname, "dashboard.html"));

  // Hide to tray on window close, keep background dictation alive
  dashboardWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      dashboardWindow.hide();
    }
  });

  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });
}

function setupIpcHandlers() {
  // Window controls
  ipcMain.on("window-minimize", () => {
    if (dashboardWindow) dashboardWindow.minimize();
  });
  ipcMain.on("window-maximize", () => {
    if (dashboardWindow) {
      if (dashboardWindow.isMaximized()) dashboardWindow.unmaximize();
      else dashboardWindow.maximize();
    }
  });
  ipcMain.on("window-close", () => {
    if (dashboardWindow) dashboardWindow.hide();
  });

  // History IPC
  ipcMain.handle("get-history", () => dataStore.getHistory());
  ipcMain.handle("add-history-item", (e, item) => dataStore.addHistoryItem(item));
  ipcMain.handle("delete-history-item", (e, id) => dataStore.deleteHistoryItem(id));
  ipcMain.handle("clear-history", () => dataStore.clearHistory());

  // Notes IPC
  ipcMain.handle("get-notes", () => dataStore.getNotes());
  ipcMain.handle("save-note", (e, note) => dataStore.saveNote(note));
  ipcMain.handle("delete-note", (e, id) => dataStore.deleteNote(id));

  // Settings IPC
  ipcMain.handle("get-settings", () => dataStore.getSettings());
  ipcMain.handle("save-settings", (e, s) => dataStore.saveSettings(s));

  // Dictionary IPC
  ipcMain.handle("get-dictionary", () => dataStore.getDictionary());
  ipcMain.handle("add-dictionary-word", (e, w) => dataStore.addDictionaryWord(w));
  ipcMain.handle("delete-dictionary-word", (e, w) => dataStore.deleteDictionaryWord(w));

  // Snippets IPC
  ipcMain.handle("get-snippets", () => dataStore.getSnippets());
  ipcMain.handle("save-snippet", (e, s) => dataStore.saveSnippet(s));
  ipcMain.handle("delete-snippet", (e, id) => dataStore.deleteSnippet(id));

  // Clipboard IPC
  ipcMain.handle("copy-to-clipboard", (e, text) => clipboard.writeText(text));
}

function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  stopEngine();
  app.quit();
}

function createTray() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open FlowVoice Dashboard",
      click: () => {
        if (dashboardWindow) {
          dashboardWindow.show();
          dashboardWindow.focus();
        } else {
          createDashboardWindow();
        }
      }
    },
    { type: "separator" },
    {
      label: "Toggle Floating Pill Overlay",
      click: () => {
        if (overlayWindow) {
          if (overlayWindow.isVisible()) overlayWindow.hide();
          else overlayWindow.showInactive();
        }
      }
    },
    { label: "Hotkey: F8 (Hold or Tap)", enabled: false },
    { label: "Engine: Local Whisper (base.en High-Precision)", enabled: false },
    { type: "separator" },
    {
      label: "Quit FlowVoice",
      click: () => {
        quitApp();
      }
    }
  ]);

  try {
    const iconPath = path.join(__dirname, "..", "icon.ico");
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray = new Tray(trayIcon);
    tray.setToolTip("FlowVoice - Desktop Voice Dictation (Press F8)");
    tray.setContextMenu(contextMenu);
    tray.on("double-click", () => {
      if (dashboardWindow) {
        dashboardWindow.show();
        dashboardWindow.focus();
      } else {
        createDashboardWindow();
      }
    });
  } catch (e) {
    console.log("[Main] Tray initialization skipped:", e.message);
  }
}

app.whenReady().then(() => {
  setupIpcHandlers();
  startEngine();
  createOverlayWindow();
  createDashboardWindow();
  createTray();

  app.on("activate", () => {
    if (dashboardWindow) {
      dashboardWindow.show();
      dashboardWindow.focus();
    } else {
      createDashboardWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopEngine();
});

app.on("will-quit", () => {
  isQuitting = true;
  stopEngine();
});

process.on("exit", () => {
  stopEngine();
});

process.on("SIGINT", () => {
  quitApp();
  process.exit(0);
});

process.on("SIGTERM", () => {
  quitApp();
  process.exit(0);
});

app.on("window-all-closed", (e) => {
  // Keep app running in tray even if dashboard is closed
  e.preventDefault();
});
