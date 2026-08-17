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
    this.state = {
      currentVersion: app.getVersion(),
      status: app.isPackaged ? "idle" : "development",
      availableVersion: null,
      progress: null,
      downloaded: false,
      error: null,
      checkedAt: null
    };

    autoUpdater.autoInstallOnAppQuit = true;
    this.bind();
  }

  config() { return this.configStore.get().updates || {}; }

  emitState() {
    this.emit("state", this.snapshot());
  }

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
    return { ...this.state };
  }

  configureFeed() {
    const cfg = this.config();
    autoUpdater.autoDownload = cfg.autoDownload !== false;
    autoUpdater.allowPrerelease = cfg.channel && cfg.channel !== "latest";
    if (cfg.channel) autoUpdater.channel = cfg.channel;

    if (cfg.genericUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url: cfg.genericUrl });
    }
  }

  bind() {
    autoUpdater.on("checking-for-update", () => {
      this.state = { ...this.state, status: "checking", error: null, checkedAt: new Date().toISOString() };
      this.emitState();
    });

    autoUpdater.on("update-available", (info) => {
      this.state = {
        ...this.state,
        status: this.config().autoDownload === false ? "available" : "downloading",
        availableVersion: info.version,
        error: null
      };
      this.emitState();
    });

    autoUpdater.on("update-not-available", () => {
      this.state = { ...this.state, status: "up-to-date", availableVersion: null, downloaded: false, progress: null };
      this.emitState();
    });

    autoUpdater.on("download-progress", (progress) => {
      this.state = {
        ...this.state,
        status: "downloading",
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
        status: "downloaded",
        availableVersion: info.version,
        downloaded: true,
        progress: { percent: 100 }
      };
      this.emitState();
    });

    autoUpdater.on("error", (error) => {
      this.state = { ...this.state, status: "error", error: error?.message || String(error) };
      this.emitState();
    });
  }

  async check() {
    if (!this.app.isPackaged) {
      this.state = { ...this.state, status: "development", error: "Les mises à jour automatiques sont testables uniquement sur la version installée (.exe)." };
      this.emitState();
      return this.snapshot();
    }
    if (!this.hasConfiguredFeed()) {
      this.state = { ...this.state, status: "unconfigured", error: "Aucun canal de mise à jour configuré. Configure une URL générique ou installe une build publiée via GitHub Releases." };
      this.emitState();
      return this.snapshot();
    }
    try {
      this.configureFeed();
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.state = { ...this.state, status: "error", error: error?.message || String(error) };
      this.emitState();
    }
    return this.snapshot();
  }

  async download() {
    if (!this.app.isPackaged) return this.check();
    try {
      this.configureFeed();
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.state = { ...this.state, status: "error", error: error?.message || String(error) };
      this.emitState();
    }
    return this.snapshot();
  }

  async install() {
    if (!this.state.downloaded) return { ok: false, error: "Aucune mise à jour téléchargée." };

    // Le launcher mémorise les services qu'il contrôle, les arrête proprement,
    // puis les relancera automatiquement après la mise à jour.
    await this.serviceManager.refreshStates();
    const snapshot = this.serviceManager.snapshot();
    const restoreServices = Object.values(snapshot.services)
      .filter((service) => service.managed && service.portOpen)
      .map((service) => service.name);

    this.runtimeStore.patch({ restoreServicesAfterUpdate: restoreServices });
    for (const name of [...restoreServices].reverse()) {
      try { await this.serviceManager.stopService(name); } catch {}
    }

    setTimeout(() => autoUpdater.quitAndInstall(false, true), 250);
    return { ok: true, restoring: restoreServices };
  }

  startSchedule() {
    this.stopSchedule();
    const cfg = this.config();
    if (!cfg.autoCheck || !this.app.isPackaged || !this.hasConfiguredFeed()) return;
    setTimeout(() => this.check(), 6000);
    const hours = Math.max(1, Number(cfg.checkIntervalHours || 6));
    this.timer = setInterval(() => this.check(), hours * 60 * 60 * 1000);
  }

  stopSchedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { UpdateManager };
