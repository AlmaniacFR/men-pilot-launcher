const fs = require("fs");
const path = require("path");
const { isPortOpen, checkHttp, capture } = require("./process-utils");

function driveRoot(p) {
  const parsed = path.parse(path.resolve(p));
  return parsed.root || "C:\\";
}

function status(ok, warning = false) {
  return ok ? "healthy" : warning ? "warning" : "critical";
}

class HealthManager {
  constructor(configStore, environmentManager, projectInspector, serviceManager) {
    this.configStore = configStore;
    this.environmentManager = environmentManager;
    this.projectInspector = projectInspector;
    this.serviceManager = serviceManager;
  }

  config() { return this.configStore.get(); }

  async disk() {
    try {
      const root = driveRoot(this.config().workspace);
      const result = await capture(`powershell -NoProfile -Command "$d=Get-PSDrive -Name '${root[0]}'; [math]::Round($d.Free/1GB,2)"`, this.config().workspace, {}, 8000);
      const freeGb = result.code === 0 ? Number(String(result.stdout).trim().replace(",", ".")) : null;
      return {
        ok: Number.isFinite(freeGb) ? freeGb >= 10 : true,
        warning: Number.isFinite(freeGb) ? freeGb < 20 : false,
        freeGb,
        detail: Number.isFinite(freeGb) ? `${freeGb.toFixed(2)} Go libres` : "Espace disque non mesuré"
      };
    } catch {
      return { ok: true, warning: false, freeGb: null, detail: "Espace disque non mesuré" };
    }
  }

  async snapshot() {
    await this.serviceManager.refreshStates();
    const services = this.serviceManager.snapshot().services || {};
    const cfg = this.config();
    const [tools, docker, db, disk] = await Promise.all([
      this.environmentManager.discoverTools(),
      this.environmentManager.dockerEngine(),
      this.projectInspector.database(),
      this.disk()
    ]);

    const frontendHttp = cfg.services?.frontend?.healthUrl ? await checkHttp(cfg.services.frontend.healthUrl, 2500) : null;
    const backendHttp = cfg.services?.backend?.healthUrl ? await checkHttp(cfg.services.backend.healthUrl, 2500) : null;
    const checks = [];

    checks.push({ key:"docker", label:"Docker Engine", status:status(docker.running), ok:docker.running, detail:docker.running ? `Version ${docker.version || "détectée"}` : "Docker Engine arrêté", repairAction:docker.running ? null : "start-docker" });
    checks.push({ key:"postgres", label:"PostgreSQL", status:status(Boolean(services.postgres?.portOpen)), ok:Boolean(services.postgres?.portOpen), detail:services.postgres?.portOpen ? "Base accessible sur le port configuré" : "PostgreSQL indisponible", repairAction:services.postgres?.portOpen ? null : "start-postgres" });
    checks.push({ key:"backend", label:"Backend Spring Boot", status:status(Boolean(services.backend?.portOpen) && (backendHttp?.ok !== false)), ok:Boolean(services.backend?.portOpen) && (backendHttp?.ok !== false), detail:backendHttp?.supported ? (backendHttp.ok ? `HTTP ${backendHttp.status}` : `Health check en échec${backendHttp.status ? ` (${backendHttp.status})` : ""}`) : (services.backend?.portOpen ? "Port backend ouvert" : "Backend arrêté"), repairAction:services.backend?.portOpen ? "restart-backend" : "start-backend" });
    checks.push({ key:"frontend", label:"Frontend Angular", status:status(Boolean(services.frontend?.portOpen) && (frontendHttp?.ok !== false)), ok:Boolean(services.frontend?.portOpen) && (frontendHttp?.ok !== false), detail:frontendHttp?.supported ? (frontendHttp.ok ? `HTTP ${frontendHttp.status}` : "Frontend inaccessible") : (services.frontend?.portOpen ? "Port frontend ouvert" : "Frontend arrêté"), repairAction:services.frontend?.portOpen ? "restart-frontend" : "start-frontend" });
    checks.push({ key:"database", label:"Connexion base", status:status(Boolean(db.available)), ok:Boolean(db.available), detail:db.available ? `${db.database}${db.size ? ` · ${db.size}` : ""}` : (db.reason || "Base inaccessible"), repairAction:db.available ? null : "start-postgres" });
    checks.push({ key:"flyway", label:"Flyway", status:status(Boolean(db.flyway?.success || (db.available && !db.flyway)), Boolean(db.available && !db.flyway)), ok:Boolean(db.flyway?.success || (db.available && !db.flyway)), detail:db.flyway ? `V${db.flyway.version} · ${db.flyway.description}` : (db.available ? "Historique Flyway non détecté" : "Non vérifiable"), repairAction:db.flyway?.success === false ? "flyway-migrate" : null });
    checks.push({ key:"java", label:"Java", status:status(Boolean(tools.java?.found)), ok:Boolean(tools.java?.found), detail:tools.java?.exe || "Java introuvable", repairAction:tools.java?.found ? null : "repair-environment" });
    checks.push({ key:"node", label:"Node.js / npm", status:status(Boolean(tools.node?.found && tools.npm?.found)), ok:Boolean(tools.node?.found && tools.npm?.found), detail:tools.node?.found ? `${tools.node.exe}${tools.npm?.found ? " · npm OK" : " · npm manquant"}` : "Node.js introuvable", repairAction:(tools.node?.found && tools.npm?.found) ? null : "repair-environment" });
    checks.push({ key:"disk", label:"Espace disque", status:status(disk.ok, disk.warning), ok:disk.ok, detail:disk.detail, repairAction:disk.ok ? null : "cleanup-storage" });

    const critical = checks.filter(c => c.status === "critical");
    const warnings = checks.filter(c => c.status === "warning");
    const global = critical.length ? "critical" : warnings.length ? "warning" : "healthy";
    return {
      at:new Date().toISOString(),
      global,
      summary:{ healthy:checks.filter(c=>c.status==="healthy").length, warning:warnings.length, critical:critical.length, total:checks.length },
      checks
    };
  }
}

module.exports = { HealthManager };
