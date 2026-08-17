const path = require("path");
const EventEmitter = require("events");
const {
  runCommand,
  runOneShot,
  killTree,
  isPortOpen,
  findPidByPort,
  waitForPort
} = require("./process-utils");

class ServiceManager extends EventEmitter {
  constructor(configStore, historyStore, logStore, sessionStore, environmentManager) {
    super();
    this.configStore = configStore;
    this.historyStore = historyStore;
    this.logStore = logStore;
    this.sessionStore = sessionStore;
    this.environmentManager = environmentManager;
    this.children = new Map();
    this.states = new Map();
    this.startedAt = new Map();
    this.buildStatus = new Map();
    this.pollTimer = null;
    this.operationLock = false;

    for (const name of Object.keys(this.config().services)) {
      this.states.set(name, this.initialState(name));
    }
  }

  initialState(name) {
    return {
      name,
      status: "unknown",
      portOpen: false,
      managed: false,
      pid: null,
      startedAt: null,
      lastError: null,
      buildStatus: name === "frontend" ? "unknown" : null
    };
  }

  config() { return this.configStore.get(); }

  profileEnv() {
    const cfg = this.config();
    return {
      ...(this.environmentManager?.runtimeEnv?.() || {}),
      ...(cfg.profiles?.[cfg.activeProfile]?.env || {})
    };
  }

  absCwd(service) {
    return path.resolve(this.config().workspace, service.cwd || ".");
  }

  analyzeLine(service, message) {
    if (service !== "frontend") return;
    const text = String(message || "");
    const current = this.buildStatus.get(service) || "unknown";
    const errorPattern = /(application bundle generation failed|compilation failed|failed to compile|\berror\s+ts\d+|\[error\]|✘ \[error\])/i;
    const successPattern = /(application bundle generation complete|compiled successfully|watch mode enabled|local:\s+http:\/\/localhost)/i;
    if (errorPattern.test(text)) {
      this.buildStatus.set(service, "error");
      if (current !== "error") {
        this.sessionStore.incrementError();
        this.emit("notification", { type: "build-error", title: "MEN Pilot — erreur Angular", body: text.slice(0, 240) });
      }
    } else if (successPattern.test(text)) {
      this.buildStatus.set(service, "ok");
    }
  }

  log(service, message, level = "info") {
    this.analyzeLine(service, message);
    const entry = this.logStore.append(service, level, message);
    this.emit("log", entry);
  }

  record(service, action, outcome, detail = null, durationMs = null) {
    const entry = this.historyStore.add({ service, action, outcome, detail, durationMs });
    this.emit("history", entry);
  }

  async refreshStates() {
    const config = this.config();

    for (const [name, service] of Object.entries(config.services)) {
      if (!this.states.has(name)) this.states.set(name, this.initialState(name));
      const previous = this.states.get(name) || this.initialState(name);

      if (service.kind === "docker-desktop") {
        const docker = await this.environmentManager.dockerEngine();
        this.states.set(name, {
          ...previous,
          name,
          status: docker.running ? "running" : "stopped",
          portOpen: docker.running,
          managed: docker.running,
          pid: null,
          startedAt: docker.running ? (previous.startedAt || null) : null,
          lastError: docker.running ? null : previous.lastError
        });
        continue;
      }

      const child = this.children.get(name);
      const portOpen = service.port ? await isPortOpen(service.port) : false;
      const processManaged = Boolean(child && child.exitCode === null && !child.killed);
      const composeManaged = service.kind === "oneshot" && portOpen;
      const managed = processManaged || composeManaged;
      let pid = processManaged ? child.pid : null;
      if (!pid && portOpen) pid = await findPidByPort(service.port);

      let status = "stopped";
      if (portOpen) status = managed ? "running" : "external";
      else if (processManaged) status = previous.status === "error" ? "error" : "starting";
      else if (previous.status === "stopping") status = "stopping";
      else if (previous.status === "error") status = "error";

      const next = {
        ...previous,
        name,
        status,
        portOpen,
        managed,
        pid,
        startedAt: this.startedAt.get(name) || previous.startedAt || null,
        buildStatus: name === "frontend" ? (this.buildStatus.get(name) || previous.buildStatus || "unknown") : null
      };
      if (status === "stopped") {
        next.startedAt = null;
        this.startedAt.delete(name);
        if (name === "frontend") this.buildStatus.set(name, "unknown");
      }
      this.states.set(name, next);
    }

    this.emit("state", this.snapshot());
    return this.snapshot();
  }

  snapshot() {
    const config = this.config();
    return {
      at: new Date().toISOString(),
      workspace: config.workspace,
      activeProfile: config.activeProfile,
      profiles: config.profiles,
      services: Object.fromEntries(this.states),
      history: this.historyStore.read().slice(0, 150),
      metrics: this.historyStore.metrics()
    };
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.refreshStates();
    this.pollTimer = setInterval(() => this.refreshStates().catch(() => {}), this.config().pollIntervalMs || 2000);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async startService(name) {
    const config = this.config();
    const service = config.services[name];
    if (!service) throw new Error(`Service inconnu: ${name}`);

    if (service.kind === "docker-desktop") {
      const started = Date.now();
      this.record(name, "start", "requested");
      this.log(name, "Démarrage de Docker Desktop...");
      const result = await this.environmentManager.startDockerDesktop();
      await this.refreshStates();
      this.record(name, "start", result.ok ? "success" : "error", result.error || null, Date.now() - started);
      if (!result.ok) this.log(name, result.error, "error");
      else this.log(name, "Docker Engine disponible.");
      return result;
    }

    if (name === "postgres" && config.docker?.autoStart !== false) {
      const docker = await this.environmentManager.dockerEngine();
      if (!docker.running) {
        this.log(name, "Docker Engine indisponible : démarrage automatique de Docker Desktop.");
        const dockerStart = await this.startService("docker");
        if (!dockerStart.ok) return dockerStart;
      }
    }

    await this.refreshStates();
    const current = this.states.get(name);
    if (current?.portOpen) {
      this.log(name, `Le service répond déjà${service.port ? ` sur le port ${service.port}` : ""}. Aucun nouveau processus lancé.`);
      this.record(name, "start", "skipped", "Déjà actif");
      return { ok: true, skipped: true };
    }

    const started = Date.now();
    this.states.set(name, { ...current, status: "starting", lastError: null });
    if (name === "frontend") this.buildStatus.set(name, "building");
    this.emit("state", this.snapshot());
    this.log(name, `Démarrage [profil ${String(config.activeProfile).toUpperCase()}]: ${service.startCommand}`);
    this.record(name, "start", "requested", service.startCommand);

    if (service.kind === "oneshot") {
      const result = await runOneShot(service.startCommand, this.absCwd(service), (line, level) => this.log(name, line, level), this.profileEnv());
      if (result.code !== 0) {
        const detail = result.error?.message || `Code de sortie ${result.code}`;
        this.states.set(name, { ...this.states.get(name), status: "error", lastError: detail });
        this.log(name, detail, "error");
        this.record(name, "start", "error", detail, Date.now() - started);
        this.sessionStore.incrementError();
        this.emit("notification", { type: "crash", title: `MEN Pilot — ${name}`, body: detail });
        this.emit("state", this.snapshot());
        return { ok: false, error: detail };
      }
    } else {
      const child = runCommand(service.startCommand, this.absCwd(service), (line, level) => this.log(name, line, level), this.profileEnv());
      this.children.set(name, child);
      this.startedAt.set(name, new Date().toISOString());

      child.on("error", (error) => {
        const detail = error?.message || String(error);
        this.states.set(name, { ...this.states.get(name), status: "error", lastError: detail });
        this.log(name, `Erreur processus: ${detail}`, "error");
        this.record(name, "process-exit", "error", detail);
        this.sessionStore.incrementError();
        this.emit("notification", { type: "crash", title: `MEN Pilot — ${name}`, body: detail });
        this.emit("state", this.snapshot());
      });

      child.on("exit", (code, signal) => {
        const intentional = this.states.get(name)?.status === "stopping";
        this.children.delete(name);
        this.startedAt.delete(name);
        if (intentional || code === 0) {
          this.log(name, `Processus arrêté (code=${code}, signal=${signal || "-"})`);
          this.states.set(name, { ...this.states.get(name), status: "stopped", managed: false, pid: null, startedAt: null });
        } else {
          const detail = `Processus terminé (code=${code}, signal=${signal || "-"})`;
          this.log(name, detail, "error");
          this.states.set(name, { ...this.states.get(name), status: "error", managed: false, pid: null, startedAt: null, lastError: detail });
          this.record(name, "process-exit", "error", detail);
          this.sessionStore.incrementError();
          this.emit("notification", { type: "crash", title: `MEN Pilot — crash ${name}`, body: detail });
        }
        this.emit("state", this.snapshot());
      });
    }

    const ready = await waitForPort(service.port, service.startupTimeoutMs || 90000, true);
    if (!ready) {
      const detail = `Le port ${service.port} n'est pas devenu disponible dans le délai imparti.`;
      this.states.set(name, { ...this.states.get(name), status: "error", lastError: detail });
      this.log(name, detail, "error");
      this.record(name, "start", "error", detail, Date.now() - started);
      this.sessionStore.incrementError();
      this.emit("notification", { type: "crash", title: `MEN Pilot — démarrage ${name}`, body: detail });
      this.emit("state", this.snapshot());
      return { ok: false, error: detail };
    }

    if (service.kind === "oneshot") this.startedAt.set(name, new Date().toISOString());
    await this.refreshStates();
    this.record(name, "start", "success", `Port ${service.port} disponible`, Date.now() - started);
    this.log(name, `Service prêt sur le port ${service.port}.`);
    return { ok: true };
  }

  async stopService(name) {
    const config = this.config();
    const service = config.services[name];
    if (!service) throw new Error(`Service inconnu: ${name}`);

    if (service.kind === "docker-desktop") {
      const postgres = this.states.get("postgres");
      if (postgres?.portOpen) {
        return { ok: false, error: "Arrête PostgreSQL avant d'arrêter Docker Desktop." };
      }
      const started = Date.now();
      this.record(name, "stop", "requested");
      const result = await this.environmentManager.stopDockerDesktop();
      await this.refreshStates();
      this.record(name, "stop", result.ok ? "success" : "error", result.error || null, Date.now() - started);
      return result;
    }

    const started = Date.now();
    const state = this.states.get(name) || {};
    this.states.set(name, { ...state, status: "stopping" });
    this.emit("state", this.snapshot());
    this.record(name, "stop", "requested");
    this.log(name, "Arrêt demandé...");

    if (service.kind === "oneshot") {
      const result = await runOneShot(service.stopCommand, this.absCwd(service), (line, level) => this.log(name, line, level), this.profileEnv());
      if (result.code !== 0) {
        const detail = `Échec de la commande d'arrêt (code ${result.code}).`;
        this.log(name, detail, "error");
        this.record(name, "stop", "error", detail, Date.now() - started);
        await this.refreshStates();
        return { ok: false, error: detail };
      }
      this.startedAt.delete(name);
    } else {
      const child = this.children.get(name);
      if (child?.pid) {
        await killTree(child.pid);
        this.children.delete(name);
        this.startedAt.delete(name);
      } else if (await isPortOpen(service.port)) {
        const detail = "Le service répond sur son port mais n'a pas été lancé par ce launcher. Arrêt automatique refusé pour éviter de tuer un processus inconnu.";
        this.log(name, detail, "error");
        this.record(name, "stop", "skipped", detail, Date.now() - started);
        await this.refreshStates();
        return { ok: false, external: true, error: detail };
      }
    }

    const stopped = await waitForPort(service.port, 15000, false);
    await this.refreshStates();
    if (!stopped) {
      const detail = `Le port ${service.port} reste ouvert après l'arrêt.`;
      this.log(name, detail, "error");
      this.record(name, "stop", "error", detail, Date.now() - started);
      return { ok: false, error: detail };
    }

    this.record(name, "stop", "success", null, Date.now() - started);
    this.log(name, "Service arrêté.");
    return { ok: true };
  }

  async restartService(name) {
    const started = Date.now();
    this.record(name, "restart", "requested");
    const stop = await this.stopService(name);
    if (!stop.ok) {
      this.record(name, "restart", "error", stop.error, Date.now() - started);
      return stop;
    }
    const result = await this.startService(name);
    this.record(name, "restart", result.ok ? "success" : "error", result.error || null, Date.now() - started);
    return result;
  }

  async startAll() {
    if (this.operationLock) return { ok: false, error: "Une opération globale est déjà en cours." };
    this.operationLock = true;
    const sequence = ["docker", "postgres", "backend", "frontend"];
    const results = {};
    try {
      this.record("all", "start-all", "requested", `profil=${this.config().activeProfile}`);
      for (const name of sequence) {
        if (!this.config().services[name]) continue;
        results[name] = await this.startService(name);
        if (!results[name].ok) {
          this.record("all", "start-all", "error", `Blocage sur ${name}`);
          return { ok: false, results };
        }
      }
      this.record("all", "start-all", "success");
      return { ok: true, results };
    } finally { this.operationLock = false; }
  }

  async stopAll() {
    if (this.operationLock) return { ok: false, error: "Une opération globale est déjà en cours." };
    this.operationLock = true;
    const sequence = ["frontend", "backend", "postgres"];
    const results = {};
    try {
      this.record("all", "stop-all", "requested");
      for (const name of sequence) {
        if (!this.config().services[name]) continue;
        results[name] = await this.stopService(name);
      }
      if (this.config().docker?.stopWithMenPilot) results.docker = await this.stopService("docker");
      const ok = Object.values(results).every((r) => r.ok || r.external);
      this.record("all", "stop-all", ok ? "success" : "error");
      return { ok, results };
    } finally { this.operationLock = false; }
  }
}

module.exports = { ServiceManager };
