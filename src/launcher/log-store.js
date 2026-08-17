const fs = require("fs");
const path = require("path");

class LogStore {
  constructor(userDataPath) {
    this.root = path.join(userDataPath, "logs");
    fs.mkdirSync(this.root, { recursive: true });
    this.memory = new Map();
    this.maxMemoryLines = 1500;
  }

  append(service, level, message) {
    const at = new Date();
    const entry = {
      at: at.toISOString(),
      service,
      level,
      message: String(message)
    };

    const list = this.memory.get(service) || [];
    list.push(entry);
    if (list.length > this.maxMemoryLines) {
      list.splice(0, list.length - this.maxMemoryLines);
    }
    this.memory.set(service, list);

    const date = at.toISOString().slice(0, 10);
    const file = path.join(this.root, `${service}-${date}.log`);
    fs.appendFileSync(
      file,
      `[${entry.at}] [${level.toUpperCase()}] ${entry.message}\n`,
      "utf8"
    );

    return entry;
  }

  get(service) {
    return this.memory.get(service) || [];
  }

  getAll() {
    return [...this.memory.values()]
      .flat()
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .slice(-2500);
  }

  getLogDirectory() {
    return this.root;
  }
}

module.exports = { LogStore };
