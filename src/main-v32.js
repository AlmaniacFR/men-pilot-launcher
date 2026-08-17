const path = require("path");
const { app, ipcMain, shell } = require("electron");

// Preserve the existing Control Center runtime.
require("./main");

const { ConfigStore } = require("./launcher/config-store");
const { HistoryStore } = require("./launcher/history-store");
const { LogStore } = require("./launcher/log-store");
const { SessionStore } = require("./launcher/session-store");
const { QualityStore } = require("./launcher/quality-store");
const { EnvironmentManager } = require("./launcher/environment-manager");
const { ServiceManager } = require("./launcher/service-manager");
const { ProjectInspector } = require("./launcher/project-inspector");
const { HealthManager } = require("./launcher/health-manager");
const { DatabaseManager } = require("./launcher/database-manager");
const { GitManager } = require("./launcher/git-manager");
const { RoadmapManager } = require("./launcher/roadmap-manager");
const { TelemetryManager } = require("./launcher/telemetry-manager");
const { DiagnosticReportManager } = require("./launcher/diagnostic-report-manager");
const { RestorePointManager } = require("./launcher/restore-point-manager");
const { ReleaseReadinessManager } = require("./launcher/release-readiness-manager");
const { ClaudeContextManager } = require("./launcher/claude-context-manager");

let telemetryManager = null;

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  const configStore = new ConfigStore(userData, path.join(__dirname, "..", "config", "default-config.json"));
  const historyStore = new HistoryStore(userData);
  const logStore = new LogStore(userData);
  const sessionStore = new SessionStore(userData);
  const qualityStore = new QualityStore(userData);
  const environmentManager = new EnvironmentManager(configStore);
  const serviceManager = new ServiceManager(configStore, historyStore, logStore, sessionStore, environmentManager);
  const inspector = new ProjectInspector(configStore);
  const healthManager = new HealthManager(configStore, environmentManager, inspector, serviceManager);
  const databaseManager = new DatabaseManager(configStore, inspector, historyStore, logStore);
  const gitManager = new GitManager(configStore, historyStore);
  const roadmapManager = new RoadmapManager(configStore);

  telemetryManager = new TelemetryManager(userData, serviceManager, healthManager);
  const reportManager = new DiagnosticReportManager(userData, { healthManager, environmentManager, serviceManager, gitManager, roadmapManager, qualityStore, databaseManager, logStore, configStore });
  const restoreManager = new RestorePointManager(userData, configStore, gitManager, databaseManager, historyStore);
  const readinessManager = new ReleaseReadinessManager({ healthManager, gitManager, qualityStore, databaseManager, roadmapManager });
  const claudeManager = new ClaudeContextManager(userData, { configStore, roadmapManager, gitManager, qualityStore, healthManager, logStore });

  telemetryManager.start();

  ipcMain.handle("pilotage:telemetry", (_e, hours) => telemetryManager.snapshot(hours));
  ipcMain.handle("pilotage:report-create", () => reportManager.create());
  ipcMain.handle("pilotage:restore-list", () => restoreManager.list());
  ipcMain.handle("pilotage:restore-create", (_e, label) => restoreManager.create(label));
  ipcMain.handle("pilotage:restore-run", (_e, id) => restoreManager.restore(id));
  ipcMain.handle("pilotage:readiness", () => readinessManager.snapshot());
  ipcMain.handle("pilotage:claude-create", () => claudeManager.create());
  ipcMain.handle("pilotage:open-file", (_e, file) => shell.showItemInFolder(path.resolve(file)));
});

app.on("before-quit", () => telemetryManager?.stop());
