const fs = require("fs");
const path = require("path");
const si = require("systeminformation");

class TelemetryManager {
  constructor(userDataPath, serviceManager, healthManager) {
    this.file = path.join(userDataPath, "telemetry.json");
    this.incidentFile = path.join(userDataPath, "incidents.json");
    this.serviceManager = serviceManager;
    this.healthManager = healthManager;
    this.timer = null;
    this.lastHealth = new Map();
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, "[]", "utf8");
    if (!fs.existsSync(this.incidentFile)) fs.writeFileSync(this.incidentFile, "[]", "utf8");
  }

  read(file) {
    try { const v = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }

  write(file, rows, max) { fs.writeFileSync(file, JSON.stringify(rows.slice(-max), null, 2), "utf8"); }

  async sample() {
    await this.serviceManager.refreshStates();
    const services = this.serviceManager.snapshot().services || {};
    const [load, mem, health] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      this.healthManager.snapshot().catch(() => null)
    ]);

    const entry = {
      at: new Date().toISOString(),
      cpu: load ? Number(load.currentLoad || 0) : null,
      memoryUsed: mem ? Number(mem.used || 0) : null,
      memoryTotal: mem ? Number(mem.total || 0) : null,
      services: Object.fromEntries(Object.entries(services).map(([name, s]) => [name, {
        status: s.status, portOpen: Boolean(s.portOpen), pid: s.pid || null
      }])),
      health: health ? health.global : null
    };

    const rows = this.read(this.file); rows.push(entry); this.write(this.file, rows, 8640); // ~24h à 10s
    if (health) this.trackIncidents(health);
    return entry;
  }

  trackIncidents(health) {
    const incidents = this.read(this.incidentFile);
    let changed = false;
    for (const check of health.checks || []) {
      const previous = this.lastHealth.get(check.key);
      this.lastHealth.set(check.key, check.status);
      if (!previous || previous === check.status) continue;
      if (check.status === "critical" || check.status === "warning") {
        incidents.push({
          id: `${Date.now()}-${check.key}`,
          openedAt: new Date().toISOString(),
          closedAt: null,
          key: check.key,
          title: check.label,
          severity: check.status,
          detail: check.detail,
          state: "open"
        });
        changed = true;
      } else if (check.status === "healthy") {
        const open = [...incidents].reverse().find(i => i.key === check.key && i.state === "open");
        if (open) { open.state = "resolved"; open.closedAt = new Date().toISOString(); changed = true; }
      }
    }
    if (changed) this.write(this.incidentFile, incidents, 500);
  }

  snapshot(hours = 1) {
    const cutoff = Date.now() - Math.max(1, Number(hours || 1)) * 3600000;
    const samples = this.read(this.file).filter(x => new Date(x.at).getTime() >= cutoff);
    const incidents = this.read(this.incidentFile).slice(-100).reverse();
    const latest = samples.at(-1) || null;
    return { at: new Date().toISOString(), hours, latest, samples, incidents, openIncidents: incidents.filter(x => x.state === "open") };
  }

  start() {
    if (this.timer) return;
    this.sample().catch(() => {});
    this.timer = setInterval(() => this.sample().catch(() => {}), 10000);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { TelemetryManager };
