const fs = require("fs");
const path = require("path");

class RuntimeStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, "runtime.json");
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) this.write({});
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }

  write(value) {
    fs.writeFileSync(this.file, JSON.stringify(value || {}, null, 2), "utf8");
  }

  patch(values) {
    const next = { ...this.read(), ...(values || {}) };
    this.write(next);
    return next;
  }

  consume(key, fallback = null) {
    const data = this.read();
    const value = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
    delete data[key];
    this.write(data);
    return value;
  }
}

module.exports = { RuntimeStore };
