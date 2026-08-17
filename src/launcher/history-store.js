const fs = require("fs");
const path = require("path");

class HistoryStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, "history.json");
    this.maxEntries = 2000;
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, "[]", "utf8");
    }
  }

  read() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  add(event) {
    const history = this.read();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...event
    };
    history.unshift(entry);
    fs.writeFileSync(
      this.file,
      JSON.stringify(history.slice(0, this.maxEntries), null, 2),
      "utf8"
    );
    return entry;
  }

  clear() {
    fs.writeFileSync(this.file, "[]", "utf8");
  }

  metrics() {
    const history = this.read();
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const today = history.filter((e) => String(e.at || "").startsWith(todayKey));

    return {
      totalEvents: history.length,
      startsToday: today.filter((e) => e.action === "start" && e.outcome === "success").length,
      failuresToday: today.filter((e) => e.outcome === "error").length,
      restartsToday: today.filter((e) => e.action === "restart").length
    };
  }
}

module.exports = { HistoryStore };
