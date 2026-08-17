const fs = require("fs");
const path = require("path");

class SessionStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, "developer-sessions.json");
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) this.write({ active: null, sessions: [] });
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { active: value.active || null, sessions: Array.isArray(value.sessions) ? value.sessions : [] };
    } catch {
      return { active: null, sessions: [] };
    }
  }

  write(value) {
    fs.writeFileSync(this.file, JSON.stringify(value, null, 2), "utf8");
  }

  start(meta = {}) {
    const data = this.read();
    if (data.active) return data.active;
    const session = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      errors: 0,
      tests: [],
      ...meta
    };
    data.active = session;
    this.write(data);
    return session;
  }

  incrementError() {
    const data = this.read();
    if (!data.active) return;
    data.active.errors = (data.active.errors || 0) + 1;
    this.write(data);
  }

  addTest(test) {
    const data = this.read();
    if (!data.active) return;
    data.active.tests = [...(data.active.tests || []), test].slice(-50);
    this.write(data);
  }

  stop(meta = {}) {
    const data = this.read();
    if (!data.active) return null;
    const endedAt = new Date();
    const completed = {
      ...data.active,
      ...meta,
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - new Date(data.active.startedAt).getTime()
    };
    data.sessions.unshift(completed);
    data.sessions = data.sessions.slice(0, 200);
    data.active = null;
    this.write(data);
    return completed;
  }

  snapshot() {
    return this.read();
  }
}

module.exports = { SessionStore };
