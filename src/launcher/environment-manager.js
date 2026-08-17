const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { capture, sleep } = require("./process-utils");

function clean(value) {
  return String(value || "").trim();
}

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

class EnvironmentManager {
  constructor(configStore) {
    this.configStore = configStore;
  }

  config() {
    return this.configStore.get();
  }

  async dockerEngine() {
    const result = await capture('docker info --format "{{.ServerVersion}}"', this.config().workspace, this.runtimeEnv(), 8000);
    return {
      running: result.code === 0 && Boolean(clean(result.stdout)),
      version: result.code === 0 ? clean(result.stdout) : null,
      error: result.code === 0 ? null : clean(result.stderr || result.error)
    };
  }

  dockerDesktopCandidates() {
    const local = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    return [
      path.join(programFiles, "Docker", "Docker", "Docker Desktop.exe"),
      path.join(local, "Docker", "Docker Desktop.exe")
    ];
  }

  async startDockerDesktop() {
    const engine = await this.dockerEngine();
    if (engine.running) return { ok: true, alreadyRunning: true, engine };

    const cli = await capture("docker desktop start", this.config().workspace, this.runtimeEnv(), 12000);
    if (cli.code !== 0) {
      const executable = firstExisting(this.dockerDesktopCandidates());
      if (!executable) {
        return {
          ok: false,
          error: "Docker Desktop n'est pas démarré et son exécutable n'a pas été trouvé."
        };
      }
      try {
        const child = spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: false });
        child.unref();
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    }

    const timeoutMs = Number(this.config().docker?.startupTimeoutMs || 120000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.dockerEngine();
      if (status.running) return { ok: true, engine: status };
      await sleep(1500);
    }
    return { ok: false, error: "Docker Desktop a été lancé mais le moteur Docker n'est pas devenu disponible dans le délai prévu." };
  }

  async stopDockerDesktop() {
    const status = await this.dockerEngine();
    if (!status.running) return { ok: true, alreadyStopped: true };

    const result = await capture("docker desktop stop", this.config().workspace, this.runtimeEnv(), 30000);
    if (result.code === 0) return { ok: true };

    return {
      ok: false,
      error: clean(result.stderr || result.error || "Impossible d'arrêter Docker Desktop via la CLI.")
    };
  }

  runtimeEnv() {
    const cfg = this.config();
    const tools = cfg.environment?.resolved || {};
    const additions = [];
    if (tools.javaBin) additions.push(tools.javaBin);
    if (tools.nodeBin) additions.push(tools.nodeBin);
    const currentPath = process.env.PATH || "";
    return {
      ...(tools.javaHome ? { JAVA_HOME: tools.javaHome } : {}),
      PATH: [...additions, currentPath].filter(Boolean).join(";")
    };
  }

  async commandPath(command) {
    const where = await capture(`where ${command}`, this.config().workspace, this.runtimeEnv(), 6000);
    if (where.code === 0 && clean(where.stdout)) {
      return clean(where.stdout).split(/\r?\n/)[0];
    }
    return null;
  }

  discoverJava() {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const roots = [
      path.join(pf, "Eclipse Adoptium"),
      path.join(pf, "Java"),
      path.join(pf, "Microsoft")
    ];
    const candidates = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      try {
        for (const name of fs.readdirSync(root)) {
          const home = path.join(root, name);
          const javaExe = path.join(home, "bin", "java.exe");
          if (fs.existsSync(javaExe)) candidates.push({ home, bin: path.join(home, "bin"), exe: javaExe });
        }
      } catch {}
    }
    if (process.env.JAVA_HOME) {
      const home = process.env.JAVA_HOME;
      const exe = path.join(home, "bin", "java.exe");
      if (fs.existsSync(exe)) candidates.unshift({ home, bin: path.join(home, "bin"), exe });
    }
    return candidates[0] || null;
  }

  discoverNode() {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const local = process.env.LOCALAPPDATA || "";
    const candidates = [
      path.join(pf, "nodejs"),
      path.join(local, "Programs", "nodejs")
    ];
    const bin = firstExisting(candidates.map((p) => path.join(p, "node.exe")));
    if (!bin) return null;
    return { bin: path.dirname(bin), nodeExe: bin, npmCmd: path.join(path.dirname(bin), "npm.cmd") };
  }

  async discoverTools() {
    const javaPath = await this.commandPath("java.exe");
    const nodePath = await this.commandPath("node.exe");
    const npmPath = await this.commandPath("npm.cmd");
    const javaFallback = this.discoverJava();
    const nodeFallback = this.discoverNode();

    return {
      java: {
        found: Boolean(javaPath || javaFallback),
        exe: javaPath || javaFallback?.exe || null,
        home: javaPath ? path.dirname(path.dirname(javaPath)) : javaFallback?.home || null,
        bin: javaPath ? path.dirname(javaPath) : javaFallback?.bin || null
      },
      node: {
        found: Boolean(nodePath || nodeFallback),
        exe: nodePath || nodeFallback?.nodeExe || null,
        bin: nodePath ? path.dirname(nodePath) : nodeFallback?.bin || null
      },
      npm: {
        found: Boolean(npmPath || nodeFallback?.npmCmd),
        exe: npmPath || nodeFallback?.npmCmd || null
      }
    };
  }

  async repairLauncherEnvironment() {
    const tools = await this.discoverTools();
    const cfg = this.config();
    cfg.environment = cfg.environment || {};
    cfg.environment.resolved = {
      javaHome: tools.java.home || cfg.environment.resolved?.javaHome || "",
      javaBin: tools.java.bin || cfg.environment.resolved?.javaBin || "",
      nodeBin: tools.node.bin || cfg.environment.resolved?.nodeBin || ""
    };
    this.configStore.save(cfg);
    return {
      ok: tools.java.found && tools.node.found && tools.npm.found,
      tools,
      resolved: cfg.environment.resolved
    };
  }
}

module.exports = { EnvironmentManager };
