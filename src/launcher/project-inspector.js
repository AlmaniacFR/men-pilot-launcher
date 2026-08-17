const path = require("path");
const si = require("systeminformation");
const { capture, checkHttp, findPidByPort } = require("./process-utils");

function clean(text) {
  return String(text || "").trim();
}

function parseDockerStats(line) {
  try {
    const value = JSON.parse(clean(line));
    return {
      cpu: value.CPUPerc || value.CPU || null,
      memory: value.MemUsage || null,
      memoryPercent: value.MemPerc || null,
      netIO: value.NetIO || null,
      blockIO: value.BlockIO || null
    };
  } catch {
    return null;
  }
}

class ProjectInspector {
  constructor(configStore) {
    this.configStore = configStore;
  }

  config() {
    return this.configStore.get();
  }

  async git() {
    const cwd = this.config().workspace;
    const [branch, commit, status, message, date] = await Promise.all([
      capture("git rev-parse --abbrev-ref HEAD", cwd),
      capture("git rev-parse --short HEAD", cwd),
      capture("git status --porcelain", cwd),
      capture("git log -1 --pretty=%s", cwd),
      capture("git log -1 --format=%cI", cwd)
    ]);
    if (branch.code !== 0 || commit.code !== 0) {
      return { available: false, error: clean(branch.stderr || branch.error || "Git indisponible") };
    }
    const changes = clean(status.stdout) ? clean(status.stdout).split(/\r?\n/).filter(Boolean) : [];
    return {
      available: true,
      branch: clean(branch.stdout),
      commit: clean(commit.stdout),
      dirty: changes.length > 0,
      changedFiles: changes.length,
      changes: changes.slice(0, 100),
      message: clean(message.stdout),
      committedAt: clean(date.stdout)
    };
  }

  async dockerPostgres() {
    const cwd = this.config().workspace;
    const idResult = await capture("docker compose ps -q postgres", cwd);
    const id = clean(idResult.stdout);
    if (!id) return { available: true, running: false, containerId: null };

    const inspect = await capture(`docker inspect --format "{{json .State}}" ${id}`, cwd);
    let state = null;
    try { state = JSON.parse(clean(inspect.stdout)); } catch {}

    const statsResult = await capture(`docker stats --no-stream --format "{{json .}}" ${id}`, cwd);
    const stats = parseDockerStats(statsResult.stdout);

    const envResult = await capture(`docker inspect --format "{{range .Config.Env}}{{println .}}{{end}}" ${id}`, cwd);
    const env = {};
    for (const line of String(envResult.stdout || "").split(/\r?\n/)) {
      const idx = line.indexOf("=");
      if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
    }

    return {
      available: true,
      running: Boolean(state?.Running),
      health: state?.Health?.Status || null,
      status: state?.Status || null,
      startedAt: state?.StartedAt || null,
      containerId: id.slice(0, 12),
      stats,
      database: {
        user: env.POSTGRES_USER || "postgres",
        name: env.POSTGRES_DB || env.POSTGRES_USER || "postgres"
      }
    };
  }

  async database() {
    const cwd = this.config().workspace;
    const docker = await this.dockerPostgres();
    if (!docker.running) {
      return { available: false, reason: "PostgreSQL n'est pas démarré", docker };
    }

    const containerResult = await capture("docker compose ps -q postgres", cwd);
    const id = clean(containerResult.stdout);
    const user = docker.database.user;
    const db = docker.database.name;
    const sizeSql = "SELECT pg_size_pretty(pg_database_size(current_database()));";
    const size = await capture(`docker exec ${id} psql -U "${user}" -d "${db}" -Atc "${sizeSql}"`, cwd);

    const flywaySql = "SELECT version || '|' || description || '|' || success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1;";
    const flyway = await capture(`docker exec ${id} psql -U "${user}" -d "${db}" -Atc "${flywaySql}"`, cwd);
    let migration = null;
    if (flyway.code === 0 && clean(flyway.stdout)) {
      const [version, description, success] = clean(flyway.stdout).split("|");
      migration = { version, description, success: success === "t" };
    }

    return {
      available: true,
      database: db,
      user,
      size: size.code === 0 ? clean(size.stdout) : null,
      flyway: migration,
      flywayAvailable: flyway.code === 0,
      docker
    };
  }

  async resources(serviceStates = {}) {
    const proc = await si.processes();
    const list = proc.list || [];
    const byPid = new Map(list.map((p) => [Number(p.pid), p]));
    const children = new Map();
    for (const p of list) {
      const parent = Number(p.parentPid || p.ppid || 0);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(p.pid));
    }

    function descendants(rootPid) {
      if (!rootPid) return [];
      const result = [];
      const queue = [Number(rootPid)];
      const seen = new Set();
      while (queue.length) {
        const pid = queue.shift();
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        const p = byPid.get(pid);
        if (p) result.push(p);
        for (const c of children.get(pid) || []) queue.push(c);
      }
      return result;
    }

    const output = {};
    for (const [name, state] of Object.entries(serviceStates || {})) {
      let pid = state.pid || null;
      if (!pid && state.portOpen && this.config().services[name]?.port) {
        pid = await findPidByPort(this.config().services[name].port);
      }
      const group = descendants(pid);
      output[name] = {
        pid,
        processes: group.length,
        cpu: group.reduce((sum, p) => sum + Number(p.cpu || 0), 0),
        memoryBytes: group.reduce((sum, p) => sum + Number(p.memRss || p.mem_rss || 0) * 1024, 0)
      };
    }
    return output;
  }

  async health() {
    const services = this.config().services;
    const output = {};
    for (const [name, cfg] of Object.entries(services)) {
      if (!cfg.healthUrl) {
        output[name] = { supported: false, ok: null, detail: "Non configuré" };
        continue;
      }
      output[name] = await checkHttp(cfg.healthUrl);
    }
    return output;
  }

  async overview(serviceStates = {}) {
    const [git, docker, database, resources, health] = await Promise.all([
      this.git(),
      this.dockerPostgres(),
      this.database(),
      this.resources(serviceStates),
      this.health()
    ]);
    return { at: new Date().toISOString(), git, docker, database, resources, health };
  }
}

module.exports = { ProjectInspector };
