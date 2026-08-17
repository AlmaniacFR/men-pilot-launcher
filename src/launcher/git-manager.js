const { capture } = require("./process-utils");

function clean(v) { return String(v || "").trim(); }

class GitManager {
  constructor(configStore, historyStore) {
    this.configStore = configStore;
    this.historyStore = historyStore;
  }
  cwd() { return this.configStore.get().workspace; }

  async snapshot() {
    const cwd = this.cwd();
    const [branch, commit, status, message, date, remote, aheadBehind] = await Promise.all([
      capture("git rev-parse --abbrev-ref HEAD", cwd),
      capture("git rev-parse --short HEAD", cwd),
      capture("git status --porcelain", cwd),
      capture("git log -1 --pretty=%s", cwd),
      capture("git log -1 --format=%cI", cwd),
      capture("git remote get-url origin", cwd),
      capture("git rev-list --left-right --count HEAD...@{u}", cwd)
    ]);
    if (branch.code !== 0) return { available:false, error:clean(branch.stderr || branch.error || "Git indisponible") };
    const changes = clean(status.stdout) ? clean(status.stdout).split(/\r?\n/).filter(Boolean) : [];
    let ahead=0, behind=0;
    if (aheadBehind.code === 0) {
      const parts=clean(aheadBehind.stdout).split(/\s+/);
      ahead=Number(parts[0]||0); behind=Number(parts[1]||0);
    }
    return {
      available:true,
      branch:clean(branch.stdout), commit:clean(commit.stdout), message:clean(message.stdout), committedAt:clean(date.stdout),
      remote:clean(remote.stdout), dirty:changes.length>0, changedFiles:changes.length,
      changes:changes.map(line=>({ raw:line, status:line.slice(0,2).trim(), file:line.slice(3).trim() })).slice(0,200),
      ahead, behind
    };
  }

  async fetch() {
    const r=await capture("git fetch --prune",this.cwd(),{},60000);
    const ok=r.code===0; this.historyStore.add({service:"git",action:"fetch",outcome:ok?"success":"error",detail:clean(r.stderr||r.stdout)});
    return {ok,stdout:clean(r.stdout),stderr:clean(r.stderr)};
  }

  async pull() {
    const snap=await this.snapshot();
    if (!snap.available) return {ok:false,error:snap.error};
    if (snap.dirty) return {ok:false,error:"Pull refusé : le working tree contient des modifications locales."};
    const r=await capture("git pull --ff-only",this.cwd(),{},60000);
    const ok=r.code===0; this.historyStore.add({service:"git",action:"pull",outcome:ok?"success":"error",detail:clean(r.stderr||r.stdout)});
    return {ok,stdout:clean(r.stdout),stderr:clean(r.stderr)};
  }
}

module.exports={GitManager};
