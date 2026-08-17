const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");

class UpdateManager extends EventEmitter {
  constructor({ app, configStore, runtimeStore, serviceManager }) {
    super();
    this.app = app;
    this.configStore = configStore;
    this.runtimeStore = runtimeStore;
    this.serviceManager = serviceManager;
    this.timer = null;
    this.installScheduled = false;
    this.state = {
      currentVersion: app.getVersion(),
      status: app.isPackaged ? "checking" : "development",
      gate: app.isPackaged ? "checking" : "open",
      mandatory: app.isPackaged,
      availableVersion: null,
      progress: null,
      downloaded: false,
      error: null,
      checkedAt: null,
      releaseNotes: null,
      releaseName: null,
      catalogue: this.loadCatalogue()
    };

    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoDownload = true;
    this.bind();
  }

  config() { return this.configStore.get().updates || {}; }

  loadCatalogue() {
    try {
      const file = path.join(__dirname, "..", "..", "config", "release-catalog.json");
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(value?.releases) ? value.releases : [];
    } catch {
      return [];
    }
  }

  emitState() { this.emit("state", this.snapshot()); }
  isOperational() { return !this.app.isPackaged || this.state.gate === "open"; }

  hasConfiguredFeed() {
    const cfg = this.config();
    if (cfg.genericUrl) return true;
    if (!this.app.isPackaged) return false;
    try {
      const updateFile = path.join(process.resourcesPath, "app-update.yml");
      const text = fs.readFileSync(updateFile, "utf8");
      return !text.includes("updates.invalid");
    } catch {
      return false;
    }
  }

  snapshot() {
    return { ...this.state, catalogue: this.loadCatalogue() };
  }

  configureFeed() {
    const cfg = this.config();
    autoUpdater.autoDownload = true;
    autoUpdater.allowPrerelease = cfg.channel && cfg.channel !== "latest";
    if (cfg.channel) autoUpdater.channel = cfg.channel;
    if (cfg.genericUrl) autoUpdater.setFeedURL({ provider: "generic", url: cfg.genericUrl });
  }

  bind() {
    autoUpdater.on("checking-for-update", () => {
      this.state = { ...this.state, status: "checking", gate: "checking", error: null, checkedAt: new Date().toISOString() };
      this.emitState();
    });

    autoUpdater.on("update-available", (info) => {
      this.state = {
        ...this.state,
        status: "downloading",
        gate: "locked",
        mandatory: true,
        availableVersion: info.version,
        releaseName: info.releaseName || null,
        releaseNotes: info.releaseNotes || null,
        error: null
      };
      this.emitState();
    });

    autoUpdater.on("update-not-available", (info) => {
      this.state = {
        ...this.state,
        status: "up-to-date",
        gate: "open",
        mandatory: false,
        availableVersion: null,
        downloaded: false,
        progress: null,
        releaseName: info?.releaseName || null,
        releaseNotes: info?.releaseNotes || null,
        error: null
      };
      this.emitState();
    });

    autoUpdater.on("download-progress", (progress) => {
      this.state = {
        ...this.state,
        status: "downloading",
        gate: "locked",
        progress: {
          percent: Number(progress.percent || 0),
          bytesPerSecond: Number(progress.bytesPerSecond || 0),
          transferred: Number(progress.transferred || 0),
          total: Number(progress.total || 0)
        }
      };
      this.emitState();
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.state = {
        ...this.state,
        status: "installing",
        gate: "locked",
        availableVersion: info.version,
        releaseName: info.releaseName || this.state.releaseName,
        releaseNotes: info.releaseNotes || this.state.releaseNotes,
        downloaded: true,
        progress: { percent: 100 },
        error: null
      };
      this.emitState();
      if (!this.installScheduled) {
        this.installScheduled = true;
        setTimeout(() => this.install(true).catch(() => {}), 900);
      }
    });

    autoUpdater.on("error", (error) => {
      this.state = {
        ...this.state,
        status: "error",
        gate: this.app.isPackaged ? "error" : "open",
        mandatory: this.app.isPackaged,
        error: error?.message || String(error)
      };
      this.emitState();
    });
  }

  async check() {
    if (!this.app.isPackaged) {
      this.state = { ...this.state, status: "development", gate: "open", mandatory: false, error: "Les mises à jour automatiques sont testables uniquement sur la version installée (.exe)." };
      this.emitState();
      return this.snapshot();
    }
    if (!this.hasConfiguredFeed()) {
      this.state = { ...this.state, status: "unconfigured", gate: "error", mandatory: true, error: "Aucun canal de mise à jour configuré." };
      this.emitState();
      return this.snapshot();
    }
    try {
      this.configureFeed();
      this.state = { ...this.state, status: "checking", gate: "checking", mandatory: true, error: null };
      this.emitState();
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.state = { ...this.state, status: "error", gate: "error", mandatory: true, error: error?.message || String(error) };
      this.emitState();
    }
    return this.snapshot();
  }

  async download() {
    if (!this.app.isPackaged) return this.check();
    try {
      this.configureFeed();
      this.state = { ...this.state, status: "downloading", gate: "locked", mandatory: true, error: null };
      this.emitState();
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.state = { ...this.state, status: "error", gate: "error", mandatory: true, error: error?.message || String(error) };
      this.emitState();
    }
    return this.snapshot();
  }

  async install(silent = true) {
    if (!this.state.downloaded) return { ok: false, error: "Aucune mise à jour téléchargée." };
    this.state = { ...this.state, status: "installing", gate: "locked", mandatory: true, error: null };
    this.emitState();

    await this.serviceManager.refreshStates();
    const snapshot = this.serviceManager.snapshot();
    const restoreServices = Object.values(snapshot.services)
      .filter((service) => service.name !== "docker" && service.managed && service.portOpen)
      .map((service) => service.name);

    this.runtimeStore.patch({
      restoreServicesAfterUpdate: restoreServices,
      lastInstalledUpdate: {
        from: this.state.currentVersion,
        to: this.state.availableVersion,
        at: new Date().toISOString(),
        releaseNotes: this.state.releaseNotes || null
      }
    });

    for (const name of [...restoreServices].reverse()) {
      try { await this.serviceManager.stopService(name); } catch {}
    }

    setTimeout(() => autoUpdater.quitAndInstall(Boolean(silent), true), 300);
    return { ok: true, restoring: restoreServices };
  }

  startSchedule() {
    this.stopSchedule();
    if (!this.app.isPackaged || !this.hasConfiguredFeed()) return;
    const hours = Math.max(1, Number(this.config().checkIntervalHours || 6));
    this.timer = setInterval(() => this.check(), hours * 60 * 60 * 1000);
  }

  stopSchedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { UpdateManager };
