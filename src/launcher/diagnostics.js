const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { isPortOpen } = require("./process-utils");

function commandVersion(file, args = []) {
  try {
    const output = execFileSync(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 7000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return String(output).trim();
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    const stdout = error?.stdout ? String(error.stdout).trim() : "";
    return stderr || stdout || null;
  }
}

async function runDiagnostics(config) {
  const workspace = config.workspace;
  const backend = path.join(workspace, "backend");
  const frontend = path.join(workspace, "frontend");

  const checks = [
    {
      key: "workspace",
      label: "Workspace MEN Pilot",
      ok: fs.existsSync(workspace),
      detail: workspace
    },
    {
      key: "backend",
      label: "Dossier backend",
      ok: fs.existsSync(backend),
      detail: backend
    },
    {
      key: "maven-wrapper",
      label: "Maven Wrapper",
      ok: fs.existsSync(path.join(backend, "mvnw.cmd")),
      detail: path.join(backend, "mvnw.cmd")
    },
    {
      key: "frontend",
      label: "Dossier frontend",
      ok: fs.existsSync(frontend),
      detail: frontend
    },
    {
      key: "package-json",
      label: "Frontend package.json",
      ok: fs.existsSync(path.join(frontend, "package.json")),
      detail: path.join(frontend, "package.json")
    }
  ];

  const versions = {
    docker: commandVersion("docker", ["--version"]),
    dockerCompose: commandVersion("docker", ["compose", "version"]),
    java: commandVersion("java", ["-version"]),
    node: commandVersion("node", ["--version"]),
    npm: commandVersion(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"])
  };

  for (const [key, value] of Object.entries(versions)) {
    checks.push({
      key,
      label: key,
      ok: Boolean(value),
      detail: value || "Introuvable"
    });
  }

  try {
    const dockerInfo = commandVersion("docker", ["info", "--format", "{{.ServerVersion}}"]);
    checks.push({
      key: "docker-engine",
      label: "Docker Engine",
      ok: Boolean(dockerInfo),
      detail: dockerInfo ? `Serveur ${dockerInfo}` : "Docker Engine inaccessible"
    });
  } catch {
    checks.push({
      key: "docker-engine",
      label: "Docker Engine",
      ok: false,
      detail: "Docker Engine inaccessible"
    });
  }

  for (const [name, service] of Object.entries(config.services || {})) {
    checks.push({
      key: `port-${name}`,
      label: `Port ${service.port} (${name})`,
      ok: true,
      neutral: true,
      detail: (await isPortOpen(service.port)) ? "Actuellement utilisé" : "Actuellement libre"
    });
  }

  return {
    at: new Date().toISOString(),
    ok: checks.filter((c) => !c.neutral).every((c) => c.ok),
    checks
  };
}

module.exports = { runDiagnostics };
