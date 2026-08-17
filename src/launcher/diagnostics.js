const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { isPortOpen } = require("./process-utils");

function commandVersion(file, args = [], env = {}) {
  try {
    const common = {
      encoding: "utf8",
      windowsHide: true,
      timeout: 7000,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    };

    let result;
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(String(file))) {
      const escaped = [file, ...args]
        .map((part) => `"${String(part).replaceAll('"', '\\"')}"`)
        .join(" ");
      result = spawnSync("cmd.exe", ["/d", "/s", "/c", escaped], common);
    } else {
      result = spawnSync(file, args, common);
    }

    if (result?.error || result?.status !== 0) return null;
    const text = [result.stdout, result.stderr]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

async function runDiagnostics(config, environmentManager) {
  const workspace = config.workspace;
  const backend = path.join(workspace, "backend");
  const frontend = path.join(workspace, "frontend");
  const runtimeEnv = environmentManager?.runtimeEnv?.() || {};
  const tools = environmentManager ? await environmentManager.discoverTools() : null;

  const checks = [
    { key: "workspace", label: "Workspace MEN Pilot", ok: fs.existsSync(workspace), detail: workspace },
    { key: "backend", label: "Dossier backend", ok: fs.existsSync(backend), detail: backend },
    { key: "maven-wrapper", label: "Maven Wrapper", ok: fs.existsSync(path.join(backend, "mvnw.cmd")), detail: path.join(backend, "mvnw.cmd") },
    { key: "frontend", label: "Dossier frontend", ok: fs.existsSync(frontend), detail: frontend },
    { key: "package-json", label: "Frontend package.json", ok: fs.existsSync(path.join(frontend, "package.json")), detail: path.join(frontend, "package.json") }
  ];

  const javaValue = commandVersion(tools?.java?.exe || "java", ["-version"], runtimeEnv);
  const nodeValue = commandVersion(tools?.node?.exe || "node", ["--version"], runtimeEnv);
  const npmValue = commandVersion(tools?.npm?.exe || (process.platform === "win32" ? "npm.cmd" : "npm"), ["--version"], runtimeEnv);
  const dockerValue = commandVersion("docker", ["--version"], runtimeEnv);
  const composeValue = commandVersion("docker", ["compose", "version"], runtimeEnv);

  checks.push({
    key: "java",
    label: "Java",
    ok: Boolean(javaValue),
    detail: javaValue ? `${javaValue.split(/\r?\n/)[0]} · ${tools?.java?.exe || "PATH système"}` : (tools?.java?.found ? `Installation détectée : ${tools.java.exe}` : "Introuvable"),
    repairable: !javaValue && Boolean(tools?.java?.found),
    repair: !javaValue && tools?.java?.found ? "Ajouter Java au PATH interne du launcher et définir JAVA_HOME" : null
  });
  checks.push({
    key: "node",
    label: "Node.js",
    ok: Boolean(nodeValue),
    detail: nodeValue ? `${nodeValue.split(/\r?\n/)[0]} · ${tools?.node?.exe || "PATH système"}` : (tools?.node?.found ? `Installation détectée : ${tools.node.exe}` : "Introuvable"),
    repairable: !nodeValue && Boolean(tools?.node?.found),
    repair: !nodeValue && tools?.node?.found ? "Ajouter Node.js au PATH interne du launcher" : null
  });
  checks.push({
    key: "npm",
    label: "npm",
    ok: Boolean(npmValue),
    detail: npmValue ? `${npmValue.split(/\r?\n/)[0]} · ${tools?.npm?.exe || "PATH système"}` : (tools?.npm?.found ? `Installation détectée : ${tools.npm.exe}` : "Introuvable"),
    repairable: !npmValue && Boolean(tools?.npm?.found),
    repair: !npmValue && tools?.npm?.found ? "Utiliser le npm.cmd détecté avec le PATH interne du launcher" : null
  });
  checks.push({ key: "docker", label: "Docker CLI", ok: Boolean(dockerValue), detail: dockerValue?.split(/\r?\n/)[0] || "Introuvable" });
  checks.push({ key: "docker-compose", label: "Docker Compose", ok: Boolean(composeValue), detail: composeValue?.split(/\r?\n/)[0] || "Introuvable" });

  const dockerEngine = environmentManager ? await environmentManager.dockerEngine() : null;
  checks.push({
    key: "docker-engine",
    label: "Docker Engine",
    ok: Boolean(dockerEngine?.running),
    detail: dockerEngine?.running ? `Serveur ${dockerEngine.version}` : "Docker Desktop / Engine non démarré",
    repairable: Boolean(environmentManager && !dockerEngine?.running),
    repair: !dockerEngine?.running ? "Démarrer Docker Desktop depuis le launcher" : null
  });

  for (const [name, service] of Object.entries(config.services || {})) {
    if (!service.port) continue;
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
    repairAvailable: checks.some((c) => c.repairable),
    tools,
    checks
  };
}

module.exports = { runDiagnostics };
