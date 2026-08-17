class AssistantManager {
  constructor({healthManager, roadmapManager, gitManager, qualityStore, logStore}) {
    this.healthManager=healthManager; this.roadmapManager=roadmapManager; this.gitManager=gitManager; this.qualityStore=qualityStore; this.logStore=logStore;
  }

  async analyze() {
    const [health, roadmap, git] = await Promise.all([this.healthManager.snapshot(), Promise.resolve(this.roadmapManager.snapshot()), this.gitManager.snapshot()]);
    const quality=this.qualityStore.snapshot();
    const findings=[];
    for(const check of health.checks.filter(c=>c.status!=="healthy")) {
      findings.push({severity:check.status==="critical"?"critical":"warning", title:check.label, summary:check.detail, action:check.repairAction||null});
    }
    if(git.available && git.behind>0) findings.push({severity:"warning",title:"Dépôt Git en retard",summary:`La branche locale a ${git.behind} commit(s) de retard sur l'origine.`,action:git.dirty?null:"git-pull"});
    if(git.available && git.dirty) findings.push({severity:"info",title:"Modifications locales",summary:`${git.changedFiles} fichier(s) modifié(s) non validé(s).`,action:null});
    const latestBackend=quality.latest?.backendTests; const latestFrontend=quality.latest?.frontendTests;
    if(latestBackend && !latestBackend.ok) findings.push({severity:"critical",title:"Tests backend en échec",summary:"La dernière exécution des tests backend n'est pas passée.",action:"backend-tests"});
    if(latestFrontend && !latestFrontend.ok) findings.push({severity:"critical",title:"Tests frontend en échec",summary:"La dernière exécution des tests frontend n'est pas passée.",action:"frontend-tests"});
    if(roadmap.current) findings.push({severity:"info",title:"Travail actuel",summary:`${roadmap.current.id} — ${roadmap.current.summary || roadmap.current.title}`,action:"open-roadmap"});
    if(!findings.length) findings.push({severity:"success",title:"MEN Pilot est sain",summary:"Aucune anomalie importante détectée sur l'environnement, les services ou la qualité.",action:null});
    return {at:new Date().toISOString(),health:health.global,findings,roadmapCurrent:roadmap.current||null};
  }
}
module.exports={AssistantManager};
