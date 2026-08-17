const fs = require("fs");
const path = require("path");

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

class ConfigStore {
  constructor(userDataPath, defaultConfigPath) {
    this.userFile = path.join(userDataPath, "config.json");
    this.defaultConfigPath = defaultConfigPath;
    this.ensure();
  }

  defaults() {
    return JSON.parse(fs.readFileSync(this.defaultConfigPath, "utf8"));
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.userFile), { recursive: true });
    if (!fs.existsSync(this.userFile)) {
      fs.copyFileSync(this.defaultConfigPath, this.userFile);
      return;
    }

    // Migration automatique : toute nouvelle clé d'une version du launcher
    // est ajoutée sans écraser les réglages déjà choisis par l'utilisateur.
    const merged = this.get();
    fs.writeFileSync(this.userFile, JSON.stringify(merged, null, 2), "utf8");
  }

  get() {
    const defaults = this.defaults();
    try {
      const user = JSON.parse(fs.readFileSync(this.userFile, "utf8"));
      return deepMerge(defaults, user);
    } catch {
      return defaults;
    }
  }

  save(config) {
    const merged = deepMerge(this.defaults(), config || {});
    fs.writeFileSync(this.userFile, JSON.stringify(merged, null, 2), "utf8");
    return this.get();
  }

  path() {
    return this.userFile;
  }
}

module.exports = { ConfigStore, deepMerge };
