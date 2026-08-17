const fs = require("fs");
const path = require("path");
const { capture } = require("./process-utils");

function redact(value) {
  if (value == null) return value;
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  text = text
    .replace(/(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;\"']+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://[REDACTED]@");
  return text;
}

class DiagnosticReportManager {
  constructor(userDataPath, deps) {
    this.root = path.join(userDataPath, "diagnostic-reports");
    this.deps = deps;
    fs.mkdirSync(this.root, { recursive: true });
  }

  async create() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(this.root, `MEN-Pilot-Diagnostic-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });

    const { healthManager, environmentManager, serviceManager, gitManager, roadmapManager, qualityStore, databaseManager, logStore, configStore } = this.deps;
    const [health, tools, git, roadmap, database] = await Promise.all([
      healthManager.snapshot().catch(e => ({ error: e.message })),
      environmentManager.discoverTools().catch(e => ({ error: e.message })),
      gitManager.snapshot().catch(e => ({ error: e.message })),
      Promise.resolve(roadmapManager.snapshot()),
      databaseManager.snapshot().catch(e => ({ error: e.message }))
    ]);
    await serviceManager.refreshStates().catch(() => {});
    const services = serviceManager.snapshot();
    const quality = qualityStore.snapshot();
    const cfg = configStore.get();
    const safeConfig = { workspace: cfg.workspace, activeProfile: cfg.activeProfile, services: cfg.services, urls: cfg.urls, docker: cfg.docker };
    const logs = (logStore.getAll ? logStore.getAll() : []).slice(-700);

    const payload = { createdAt: new Date().toISOString(), health, tools, services, git, roadmap, database, quality, config: safeConfig, logs };
    fs.writeFileSync(path.join(dir, "diagnostic.json"), redact(payload), "utf8");
    fs.writeFileSync(path.join(dir, "README.txt"), [
      "MEN Pilot — rapport de diagnostic portable",
      `Créé le : ${new Date().toLocaleString("fr-FR")}`,
      "",
      `Santé globale : ${health.global || "inconnue"}`,
      `Branche Git : ${git.branch || "inconnue"}`,
      `Commit : ${git.commit || "inconnu"}`,
      `Étape roadmap : ${roadmap.current ? `${roadmap.current.id} — ${roadmap.current.summary}` : "non détectée"}`,
      "",
      "Les valeurs ressemblant à des secrets, mots de passe ou tokens sont masquées automatiquement."
    ].join("\r\n"), "utf8");

    const zip = `${dir}.zip`;
    const cmd = `powershell -NoProfile -Command "Compress-Archive -Path '${dir.replaceAll("'", "''")}\\*' -DestinationPath '${zip.replaceAll("'", "''")}' -Force"`;
    const result = await capture(cmd, this.root, {}, 120000);
    return result.code === 0 && fs.existsSync(zip) ? { ok: true, file: zip, folder: dir } : { ok: false, error: result.stderr || result.error || "Impossible de créer le ZIP.", folder: dir };
  }
}

module.exports = { DiagnosticReportManager };
