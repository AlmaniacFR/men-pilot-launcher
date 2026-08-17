const { spawn, execFile } = require("child_process");
const net = require("net");

function runCommand(command, cwd, onLine = () => {}, env = {}) {
  const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
    cwd,
    windowsHide: true,
    env: { ...process.env, ...env }
  });

  const wire = (stream, level) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) onLine(line, level);
    });
    stream.on("end", () => {
      if (buffer.trim()) onLine(buffer, level);
    });
  };

  if (child.stdout) wire(child.stdout, "info");
  if (child.stderr) wire(child.stderr, "error");
  return child;
}

function runOneShot(command, cwd, onLine = () => {}, env = {}) {
  return new Promise((resolve) => {
    const child = runCommand(command, cwd, onLine, env);
    child.on("error", (error) => resolve({ code: -1, error }));
    child.on("exit", (code) => resolve({ code: code ?? -1 }));
  });
}

function capture(command, cwd, env = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
      cwd,
      windowsHide: true,
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ code: -2, stdout, stderr, error: "timeout" });
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, error: error.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false);
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    killer.on("error", () => resolve(false));
    killer.on("exit", (code) => resolve(code === 0));
  });
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findPidByPort(port) {
  return new Promise((resolve) => {
    execFile("netstat", ["-ano", "-p", "tcp"], { windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      if (error) return resolve(null);
      const lines = String(stdout).split(/\r?\n/);
      const suffix = `:${port}`;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const local = parts[1] || "";
        const state = parts[3] || "";
        const pid = Number(parts[4]);
        if (local.endsWith(suffix) && state.toUpperCase() === "LISTENING" && Number.isInteger(pid)) {
          return resolve(pid);
        }
      }
      resolve(null);
    });
  });
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function checkHttp(url, timeoutMs = 1800) {
  if (!url) return { supported: false, ok: null, status: null, detail: "Non configuré" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    clearTimeout(timer);
    let body = "";
    try { body = await response.text(); } catch {}
    if (response.status === 404) {
      return { supported: false, ok: null, status: 404, detail: "Endpoint non disponible" };
    }
    return { supported: true, ok: response.ok, status: response.status, detail: body.slice(0, 300) };
  } catch (error) {
    return { supported: true, ok: false, status: null, detail: error?.message || String(error) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(port, timeoutMs, shouldBeOpen = true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await isPortOpen(port);
    if (open === shouldBeOpen) return true;
    await sleep(750);
  }
  return false;
}

module.exports = {
  runCommand,
  runOneShot,
  capture,
  killTree,
  isPidAlive,
  findPidByPort,
  isPortOpen,
  checkHttp,
  waitForPort,
  sleep
};
