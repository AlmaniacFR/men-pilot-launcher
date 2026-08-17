class JournalManager {
  constructor(sessionStore, historyStore, qualityStore) {
    this.sessionStore = sessionStore;
    this.historyStore = historyStore;
    this.qualityStore = qualityStore;
  }

  snapshot() {
    const sessions = this.sessionStore.snapshot().sessions || [];
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = sessions.filter(s => new Date(s.startedAt).getTime() >= weekAgo);
    const totalMs = recent.reduce((sum, s) => sum + Number(s.durationMs || 0), 0);
    const totalErrors = recent.reduce((sum, s) => sum + Number(s.errors || 0), 0);
    const commits = [];
    for (const s of recent) {
      if (s.endingGit?.commit) commits.push({ commit:s.endingGit.commit, branch:s.endingGit.branch, at:s.endedAt || s.startedAt });
    }
    return {
      at:new Date().toISOString(),
      week:{ sessions:recent.length, totalMs, totalErrors, commits:commits.slice(0,30) },
      sessions:sessions.slice(0,50),
      quality:this.qualityStore.snapshot(),
      activity:this.historyStore.read().slice(0,100)
    };
  }
}
module.exports={JournalManager};
