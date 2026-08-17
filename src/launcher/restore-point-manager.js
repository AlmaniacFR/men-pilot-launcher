const fs = require("fs");
const path = require("path");
const { capture } = require("./process-utils");

function safeName(value) { return String(value || "restore").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "restore"; }

class RestorePointManager {
  constructor(userDataPath, configStore, gitManager, databaseManager, historyStore) {
    this.root = path.join(userDataPath, "restore-points");
    this.configStore = configStore;
    this.gitManager = gitManager;
    this.databaseManager = databaseManager;
    this.historyStore = historyStore;
    fs.mkdirSync(this.root, { recursive: true });
  }

  list() {
    return fs.readdirSync(this.root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => {
      const dir = path.join(this.root, x.name); const manifest = path.join(dir, "manifest.json");
      try { return { ...JSON.parse(fs.readFileSync(manifest, "utf8")), dir }; } catch { return null; }
    }).filter(Boolean).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
  }

  async create(label = "") {
    const git = await this.gitManager.snapshot();
    if (!git.available) return { ok:false, error:git.error || "Git indisponible." };
    const backup = await this.databaseManager.createBackup();
    if (!backup.ok) return { ok:false, error:"Impossible de créer le snapshot PostgreSQL requis." };
    const stamp = new Date().toISOString().replace(/[:.]/g,"-");
    const dir = path.join(this.root, `${stamp}-${safeName(label || git.branch)}`); fs.mkdirSync(dir, { recursive:true });
    const cfg = this.configStore.get();
    fs.writeFileSync(path.join(dir,"launcher-config.json"), JSON.stringify(cfg,null,2), "utf8");
    const manifest = {
      id:path.basename(dir), label:label || `Point avant modification sur ${git.branch}`, createdAt:new Date().toISOString(),
      git:{ branch:git.branch, commit:git.commit, dirty:git.dirty, changedFiles:git.changedFiles },
      databaseBackup:backup.backup.file,
      workspace:cfg.workspace
    };
    fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2),"utf8");
    this.historyStore.add({service:"restore",action:"create",outcome:"success",detail:manifest.id});
    return {ok:true,restorePoint:{...manifest,dir}};
  }

  async restore(id) {
    const point = this.list().find(x => x.id === id);
    if (!point) return {ok:false,error:"Point de restauration introuvable."};
    const current = await this.gitManager.snapshot();
    if (!current.available) return {ok:false,error:current.error};
    if (current.dirty) return {ok:false,error:"Restauration refusée : des modifications Git locales ne sont pas enregistrées."};

    const safety = await this.create(`sécurité-avant-restauration-${id}`);
    if (!safety.ok) return {ok:false,error:`Point de sécurité impossible : ${safety.error}`};

    const cwd = this.configStore.get().workspace;
    const branchName = `men-restore-safety-${Date.now()}`;
    await capture(`git branch ${branchName} HEAD`, cwd, {}, 15000);
    const checkout = await capture(`git checkout --detach ${point.git.commit}`, cwd, {}, 30000);
    if (checkout.code !== 0) return {ok:false,error:checkout.stderr || "Impossible de restaurer le commit Git.",safety:safety.restorePoint};
    const db = await this.databaseManager.restoreBackup(point.databaseBackup);
    if (!db.ok) return {ok:false,error:db.error || "Git restauré mais restauration DB échouée.",safety:safety.restorePoint};
    this.historyStore.add({service:"restore",action:"restore",outcome:"success",detail:point.id});
    return {ok:true,restored:point,safety:safety.restorePoint,safetyBranch:branchName};
  }
}

module.exports = { RestorePointManager };
