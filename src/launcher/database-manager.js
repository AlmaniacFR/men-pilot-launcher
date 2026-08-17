const fs = require("fs");
const path = require("path");
const { capture, runOneShot } = require("./process-utils");

function clean(v) { return String(v || "").trim(); }

class DatabaseManager {
  constructor(configStore, projectInspector, historyStore, logStore) {
    this.configStore = configStore;
    this.projectInspector = projectInspector;
    this.historyStore = historyStore;
    this.logStore = logStore;
  }

  config() { return this.configStore.get(); }
  backupDir() {
    const cfg = this.config();
    return path.resolve(cfg.database?.backupDir || path.join(cfg.workspace, ".men-pilot", "db-backups"));
  }
  ensureBackupDir() { fs.mkdirSync(this.backupDir(), { recursive: true }); }

  async context() {
    const docker = await this.projectInspector.dockerPostgres();
    if (!docker.running) return { ok:false, error:"PostgreSQL n'est pas démarré." };
    const cwd = this.config().workspace;
    const idResult = await capture("docker compose ps -q postgres", cwd);
    const id = clean(idResult.stdout);
    if (!id) return { ok:false, error:"Conteneur PostgreSQL introuvable." };
    return { ok:true, cwd, id, user:docker.database.user, db:docker.database.name };
  }

  listBackups() {
    this.ensureBackupDir();
    return fs.readdirSync(this.backupDir())
      .filter(name => name.toLowerCase().endsWith(".dump"))
      .map(name => {
        const file = path.join(this.backupDir(), name);
        const stat = fs.statSync(file);
        return { name, file, sizeBytes:stat.size, createdAt:stat.birthtime.toISOString(), modifiedAt:stat.mtime.toISOString() };
      })
      .sort((a,b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  }

  async migrations() {
    const ctx = await this.context();
    if (!ctx.ok) return { available:false, error:ctx.error, rows:[] };
    const sql = "SELECT installed_rank,version,description,type,script,installed_on,execution_time,success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 100;";
    const result = await capture(`docker exec ${ctx.id} psql -U "${ctx.user}" -d "${ctx.db}" -At -F "|" -c "${sql}"`, ctx.cwd, {}, 15000);
    if (result.code !== 0) return { available:false, error:clean(result.stderr || result.error), rows:[] };
    const rows = clean(result.stdout).split(/\r?\n/).filter(Boolean).map(line => {
      const [rank,version,description,type,script,installedOn,executionTime,success] = line.split("|");
      return { rank:Number(rank), version, description, type, script, installedOn, executionTime:Number(executionTime||0), success:success === "t" };
    });
    return { available:true, rows };
  }

  async createBackup() {
    const ctx = await this.context();
    if (!ctx.ok) return ctx;
    this.ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g,"-");
    const file = path.join(this.backupDir(), `men-pilot-${stamp}.dump`);
    const command = `docker exec ${ctx.id} pg_dump -U "${ctx.user}" -d "${ctx.db}" -Fc > "${file}"`;
    this.logStore.append("database", "info", `Création snapshot : ${file}`);
    const started = Date.now();
    const result = await runOneShot(command, ctx.cwd, (line, level) => this.logStore.append("database", level, line));
    const ok = result.code === 0 && fs.existsSync(file) && fs.statSync(file).size > 0;
    this.historyStore.add({ service:"database", action:"backup", outcome:ok?"success":"error", durationMs:Date.now()-started, detail:file });
    return ok ? { ok:true, backup:this.listBackups().find(x=>x.file===file) } : { ok:false, error:"La sauvegarde PostgreSQL a échoué." };
  }

  async restoreBackup(file) {
    const ctx = await this.context();
    if (!ctx.ok) return ctx;
    const resolved = path.resolve(file || "");
    if (!resolved.startsWith(this.backupDir()) || !fs.existsSync(resolved)) return { ok:false, error:"Snapshot invalide ou introuvable." };
    const started = Date.now();
    const pre = await this.createBackup();
    if (!pre.ok) return { ok:false, error:"Snapshot de sécurité impossible avant restauration." };
    const command = `docker exec -i ${ctx.id} pg_restore -U "${ctx.user}" -d "${ctx.db}" --clean --if-exists < "${resolved}"`;
    const result = await runOneShot(command, ctx.cwd, (line, level) => this.logStore.append("database", level, line));
    const ok = result.code === 0;
    this.historyStore.add({ service:"database", action:"restore", outcome:ok?"success":"error", durationMs:Date.now()-started, detail:resolved });
    return ok ? { ok:true, restored:resolved, safetyBackup:pre.backup } : { ok:false, error:"La restauration PostgreSQL a échoué.", safetyBackup:pre.backup };
  }

  deleteBackup(file) {
    const resolved = path.resolve(file || "");
    if (!resolved.startsWith(this.backupDir()) || !fs.existsSync(resolved)) return { ok:false, error:"Snapshot invalide." };
    fs.unlinkSync(resolved);
    this.historyStore.add({ service:"database", action:"delete-backup", outcome:"success", detail:resolved });
    return { ok:true };
  }

  async snapshot() {
    const [database, migrations] = await Promise.all([this.projectInspector.database(), this.migrations()]);
    return { at:new Date().toISOString(), database, migrations, backups:this.listBackups(), backupDir:this.backupDir() };
  }
}

module.exports = { DatabaseManager };
