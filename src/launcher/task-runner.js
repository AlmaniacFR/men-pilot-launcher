const path = require("path");
const EventEmitter = require("events");
const { runOneShot } = require("./process-utils");

function parseTests(kind, lines) {
  const text = lines.join("\n");
  const maven = [...text.matchAll(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/gi)];
  if (maven.length) {
    let tests = 0, failures = 0, errors = 0, skipped = 0;
    for (const m of maven) {
      tests += Number(m[1]); failures += Number(m[2]); errors += Number(m[3]); skipped += Number(m[4]);
    }
    return { tests, passed: Math.max(0, tests - failures - errors - skipped), failures, errors, skipped };
  }
  const vitestTests = text.match(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?/i);
  if (vitestTests) {
    const passed = Number(vitestTests[1] || 0);
    const failures = Number(vitestTests[2] || 0);
    return { tests: passed + failures, passed, failures, errors: 0, skipped: 0 };
  }
  const karma = text.match(/Executed\s+(\d+)\s+of\s+(\d+).*?(SUCCESS|FAILED)/i);
  if (karma) {
    const tests = Number(karma[2]);
    const ok = karma[3].toUpperCase() === "SUCCESS";
    return { tests, passed: ok ? tests : null, failures: ok ? 0 : null, errors: 0, skipped: 0 };
  }
  return null;
}

class TaskRunner extends EventEmitter {
  constructor(configStore, historyStore, logStore, sessionStore) {
    super();
    this.configStore = configStore;
    this.historyStore = historyStore;
    this.logStore = logStore;
    this.sessionStore = sessionStore;
    this.running = new Set();
    this.lastResults = {};
  }

  cfg() { return this.configStore.get(); }

  log(task, message, level = "info") {
    const entry = this.logStore.append("tasks", level, `[${task}] ${message}`);
    this.emit("log", entry);
  }

  env() {
    const cfg = this.cfg();
    const resolved = cfg.environment?.resolved || {};
    const additions = [resolved.javaBin, resolved.nodeBin].filter(Boolean);
    return {
      ...(resolved.javaHome ? { JAVA_HOME: resolved.javaHome } : {}),
      PATH: [...additions, process.env.PATH || ""].join(";"),
      ...(cfg.profiles?.[cfg.activeProfile]?.env || {})
    };
  }

  cwdFor(kind) {
    const workspace = this.cfg().workspace;
    if (["backendTests", "backendClean", "flywayMigrate"].includes(kind)) return path.join(workspace, "backend");
    if (kind === "frontendTests") return path.join(workspace, "frontend");
    return workspace;
  }

  commandFor(kind) { return this.cfg().tasks?.[kind] || ""; }

  async run(kind, options = {}) {
    if (this.running.has(kind)) return { ok: false, error: "Cette tâche est déjà en cours." };
    const command = options.command || this.commandFor(kind);
    if (!command) return { ok: false, error: `Commande non configurée pour ${kind}.` };

    this.running.add(kind);
    const started = Date.now();
    const lines = [];
    this.historyStore.add({ service: "tasks", action: kind, outcome: "requested", detail: command });
    this.log(kind, `Commande: ${command}`);
    this.emit("state", this.snapshot());

    try {
      const result = await runOneShot(command, options.cwd || this.cwdFor(kind), (line, level) => {
        lines.push(line);
        if (lines.length > 5000) lines.splice(0, lines.length - 5000);
        this.log(kind, line, level);
      }, this.env());
      const durationMs = Date.now() - started;
      const summary = kind.endsWith("Tests") ? parseTests(kind, lines) : null;
      const output = { kind, ok: result.code === 0, code: result.code, durationMs, at: new Date().toISOString(), summary, tail: lines.slice(-30) };
      this.lastResults[kind] = output;
      this.historyStore.add({ service: "tasks", action: kind, outcome: output.ok ? "success" : "error", durationMs, detail: summary ? JSON.stringify(summary) : `code=${result.code}` });
      if (kind.endsWith("Tests")) this.sessionStore.addTest(output);
      if (!output.ok) this.sessionStore.incrementError();
      return output;
    } finally {
      this.running.delete(kind);
      this.emit("state", this.snapshot());
    }
  }

  snapshot() { return { running: [...this.running], lastResults: this.lastResults }; }
}

module.exports = { TaskRunner };
