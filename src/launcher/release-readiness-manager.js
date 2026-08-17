class ReleaseReadinessManager {
  constructor({healthManager,gitManager,qualityStore,databaseManager,roadmapManager}) {
    this.healthManager=healthManager; this.gitManager=gitManager; this.qualityStore=qualityStore; this.databaseManager=databaseManager; this.roadmapManager=roadmapManager;
  }

  async snapshot() {
    const [health,git,database] = await Promise.all([this.healthManager.snapshot(),this.gitManager.snapshot(),this.databaseManager.snapshot()]);
    const quality=this.qualityStore.snapshot(); const roadmap=this.roadmapManager.snapshot();
    const latest=quality.latest||{};
    const backups=database.backups||[]; const recentBackup=backups[0] && (Date.now()-new Date(backups[0].modifiedAt).getTime()<24*3600000);
    const checks=[
      {key:"health",label:"Santé MEN Pilot",ok:health.global==="healthy",detail:health.global==="healthy"?"Tous les contrôles sont sains":`${health.summary.critical} critique(s), ${health.summary.warning} avertissement(s)`},
      {key:"git",label:"Git propre",ok:git.available&&!git.dirty,detail:git.available?(git.dirty?`${git.changedFiles} fichier(s) modifié(s)`: `${git.branch} @ ${git.commit}`):git.error},
      {key:"sync",label:"Dépôt synchronisé",ok:git.available&&git.behind===0,detail:git.available?`${git.ahead||0} commit(s) devant · ${git.behind||0} derrière`:"Non vérifiable"},
      {key:"backend-tests",label:"Tests backend",ok:Boolean(latest.backendTests?.ok),detail:latest.backendTests?`${latest.backendTests.summary?.tests??"?"} tests · ${latest.backendTests.ok?"OK":"ÉCHEC"}`:"Jamais exécutés"},
      {key:"frontend-tests",label:"Tests frontend",ok:Boolean(latest.frontendTests?.ok),detail:latest.frontendTests?`${latest.frontendTests.summary?.tests??"?"} tests · ${latest.frontendTests.ok?"OK":"ÉCHEC"}`:"Jamais exécutés"},
      {key:"backend-build",label:"Build backend",ok:Boolean(latest.backendBuild?.ok),detail:latest.backendBuild? (latest.backendBuild.ok?"Build valide":"Build en échec") : "Jamais exécuté"},
      {key:"frontend-build",label:"Build frontend",ok:Boolean(latest.frontendBuild?.ok),detail:latest.frontendBuild? (latest.frontendBuild.ok?"Build valide":"Build en échec") : "Jamais exécuté"},
      {key:"flyway",label:"Flyway",ok:Boolean(database.database?.flyway?.success || database.migrations?.rows?.every?.(x=>x.success)),detail:database.database?.flyway?`V${database.database.flyway.version} · ${database.database.flyway.description}`:"Historique non confirmé"},
      {key:"backup",label:"Snapshot DB récent",ok:Boolean(recentBackup),detail:backups[0]?`Dernier snapshot ${new Date(backups[0].modifiedAt).toLocaleString("fr-FR")}`:"Aucun snapshot"},
      {key:"roadmap",label:"Roadmap lisible",ok:Boolean(roadmap.available&&roadmap.current),detail:roadmap.current?`${roadmap.current.id} — ${roadmap.current.summary}`:"Étape actuelle non détectée"}
    ];
    const blocking=checks.filter(c=>!c.ok);
    return {at:new Date().toISOString(),ready:blocking.length===0,score:Math.round((checks.filter(c=>c.ok).length/checks.length)*100),checks,blocking};
  }
}
module.exports={ReleaseReadinessManager};
