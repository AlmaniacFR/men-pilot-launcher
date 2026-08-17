const path = require("path");
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification
} = require("electron");

const { ConfigStore } = require("./launcher/config-store");
const { HistoryStore } = require("./launcher/history-store");
const { LogStore } = require("./launcher/log-store");
const { RuntimeStore } = require("./launcher/runtime-store");
const { SessionStore } = require("./launcher/session-store");
const { ServiceManager } = require("./launcher/service-manager");
const { ProjectInspector } = require("./launcher/project-inspector");
const { TaskRunner } = require("./launcher/task-runner");
const { UpdateManager } = require("./launcher/update-manager");
const { runDiagnostics } = require("./launcher/diagnostics");

const APP_ID = "fr.marseilleexpert.menpilot.launcher";
app.setAppUserModelId(APP_ID);
app.setName("MEN Pilot Launcher");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let tray = null;
let configStore, historyStore, logStore, runtimeStore, sessionStore;
let manager, inspector, taskRunner, updateManager;
let quitting = false;

const iconPath = path.join(__dirname, "..", "assets", "men-pilot.ico");

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0b0f16",
    title: "MEN Pilot Launcher",
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  tray.setToolTip("MEN Pilot Launcher");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir MEN Pilot Launcher", click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: "separator" },
    { label: "Démarrer MEN Pilot", click: () => manager.startAll() },
    { label: "Arrêter MEN Pilot", click: () => manager.stopAll() },
    { type: "separator" },
    { label: "Vérifier les mises à jour", click: () => updateManager.check() },
    { type: "separator" },
    { label: "Quitter le launcher", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
}

function applyWindowsSettings() {
  if (!app.isPackaged) return;
  const enabled = Boolean(configStore.get().windows?.launchAtLogin);
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
}

function showManagerNotification(payload) {
  const cfg = configStore.get().notifications || {};
  if (!cfg.enabled || !Notification.isSupported()) return;
  if (payload.type === "crash" && cfg.notifyOnCrash === false) return;
  if (payload.type === "build-error" && cfg.notifyOnBuildError === false) return;
  new Notification({ title: payload.title || "MEN Pilot Launcher", body: payload.body || "" }).show();
}

async function setProfile(profile) {
  const cfg = configStore.get();
  if (!cfg.profiles?.[profile]) return { ok: false, error: "Profil inconnu." };
  await manager.refreshStates();
  if (Object.values(manager.snapshot().services).some((s) => s.portOpen)) {
    return { ok: false, error: "Arrête MEN Pilot avant de changer de profil." };
  }
  cfg.activeProfile = profile;
  configStore.save(cfg);
  await manager.refreshStates();
  return { ok: true, profile };
}

async function restoreAfterUpdate() {
  const names = runtimeStore.consume("restoreServicesAfterUpdate", []);
  if (!Array.isArray(names) || !names.length) return;
  await new Promise((r) => setTimeout(r, 1800));
  for (const name of ["postgres", "backend", "frontend"]) {
    if (!names.includes(name)) continue;
    try { await manager.startService(name); } catch {}
  }
}

function registerIpc() {
  ipcMain.handle("men:snapshot", async () => { await manager.refreshStates(); return manager.snapshot(); });
  ipcMain.handle("men:start-service", (_e, name) => manager.startService(name));
  ipcMain.handle("men:stop-service", (_e, name) => manager.stopService(name));
  ipcMain.handle("men:restart-service", (_e, name) => manager.restartService(name));
  ipcMain.handle("men:start-all", () => manager.startAll());
  ipcMain.handle("men:stop-all", () => manager.stopAll());
  ipcMain.handle("men:set-profile", (_e, profile) => setProfile(profile));

  ipcMain.handle("men:get-logs", (_e, service) => service === "all" ? logStore.getAll() : logStore.get(service));
  ipcMain.handle("men:get-config", () => configStore.get());
  ipcMain.handle("men:save-config", async (_e, config) => {
    const saved = configStore.save(config);
    applyWindowsSettings();
    manager.stopPolling();
    manager.startPolling();
    updateManager.startSchedule();
    await manager.refreshStates();
    return saved;
  });

  ipcMain.handle("men:diagnostics", () => runDiagnostics(configStore.get()));
  ipcMain.handle("men:project-overview", () => inspector.overview(manager.snapshot().services));
  ipcMain.handle("men:task-snapshot", () => taskRunner.snapshot());
  ipcMain.handle("men:run-task", (_e, kind) => taskRunner.run(kind));

  ipcMain.handle("men:reset-database", async (_e, token) => {
    const cfg = configStore.get();
    if (!cfg.safety?.allowDatabaseReset) return { ok: false, error: "Le reset DB est désactivé dans Configuration > Sécurité." };
    if (token !== "RESET") return { ok: false, error: "Confirmation invalide." };
    await manager.refreshStates();
    const backend = manager.snapshot().services.backend;
    if (backend?.managed) await manager.stopService("backend");
    else if (backend?.portOpen) return { ok: false, error: "Backend externe détecté : reset refusé." };
    const result = await taskRunner.run("databaseReset");
    await manager.refreshStates();
    return result;
  });

  ipcMain.handle("men:session-start", async () => {
    const git = await inspector.git();
    const session = sessionStore.start({ profile: configStore.get().activeProfile, git: git.available ? { branch: git.branch, commit: git.commit, dirty: git.dirty } : null });
    historyStore.add({ service: "session", action: "session-start", outcome: "success", detail: session.id });
    send("men:session", sessionStore.snapshot());
    return sessionStore.snapshot();
  });
  ipcMain.handle("men:session-stop", async () => {
    const git = await inspector.git();
    const completed = sessionStore.stop({ endingGit: git.available ? { branch: git.branch, commit: git.commit, dirty: git.dirty } : null });
    if (completed) historyStore.add({ service: "session", action: "session-stop", outcome: "success", durationMs: completed.durationMs, detail: completed.id });
    send("men:session", sessionStore.snapshot());
    return sessionStore.snapshot();
  });
  ipcMain.handle("men:session-snapshot", () => sessionStore.snapshot());

  ipcMain.handle("men:update-snapshot", () => updateManager.snapshot());
  ipcMain.handle("men:update-check", () => updateManager.check());
  ipcMain.handle("men:update-download", () => updateManager.download());
  ipcMain.handle("men:update-install", () => updateManager.install());

  ipcMain.handle("men:clear-history", () => { historyStore.clear(); manager.emit("state", manager.snapshot()); return true; });
  ipcMain.handle("men:open-application", () => shell.openExternal(configStore.get().urls.application));
  ipcMain.handle("men:open-backend", () => shell.openExternal(configStore.get().urls.backend));
  ipcMain.handle("men:open-swagger", () => shell.openExternal(configStore.get().urls.swagger));
  ipcMain.handle("men:open-pgadmin", () => configStore.get().urls.pgadmin ? shell.openExternal(configStore.get().urls.pgadmin) : null);
  ipcMain.handle("men:open-workspace", () => shell.openPath(configStore.get().workspace));
  ipcMain.handle("men:open-log-directory", () => shell.openPath(logStore.getLogDirectory()));
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath("userData"), path.join(__dirname, "..", "config", "default-config.json"));
  historyStore = new HistoryStore(app.getPath("userData"));
  logStore = new LogStore(app.getPath("userData"));
  runtimeStore = new RuntimeStore(app.getPath("userData"));
  sessionStore = new SessionStore(app.getPath("userData"));
  manager = new ServiceManager(configStore, historyStore, logStore, sessionStore);
  inspector = new ProjectInspector(configStore);
  taskRunner = new TaskRunner(configStore, historyStore, logStore, sessionStore);
  updateManager = new UpdateManager({ app, configStore, runtimeStore, serviceManager: manager });

  createWindow();
  createTray();
  registerIpc();
  applyWindowsSettings();

  manager.on("state", (snapshot) => send("men:state", snapshot));
  manager.on("log", (entry) => send("men:log", entry));
  manager.on("notification", showManagerNotification);
  taskRunner.on("log", (entry) => send("men:log", entry));
  taskRunner.on("state", (value) => send("men:task", value));
  updateManager.on("state", (value) => send("men:update", value));

  manager.startPolling();
  updateManager.startSchedule();
  restoreAfterUpdate();
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("before-quit", () => {
  quitting = true;
  manager?.stopPolling();
  updateManager?.stopSchedule();
});

app.on("window-all-closed", () => {
  // Le launcher reste actif dans la zone de notification Windows.
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
