const fs=require("fs");
const path=require("path");
const {capture}=require("./process-utils");

function redact(text){return String(text||"").replace(/(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;\"']+/gi,"$1=[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,"Bearer [REDACTED]");}

class ClaudeContextManager{
  constructor(userDataPath,deps){this.root=path.join(userDataPath,"claude-context");this.deps=deps;fs.mkdirSync(this.root,{recursive:true});}
  readIfExists(file,max=120000){try{return fs.existsSync(file)?fs.readFileSync(file,"utf8").slice(0,max):"";}catch{return"";}}
  async create(){
    const {configStore,roadmapManager,gitManager,qualityStore,healthManager,logStore}=this.deps;const cfg=configStore.get();
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");const dir=path.join(this.root,`MEN-Pilot-Claude-${stamp}`);fs.mkdirSync(dir,{recursive:true});
    const roadmap=roadmapManager.snapshot();const [git,health,diff]=await Promise.all([gitManager.snapshot(),healthManager.snapshot(),capture("git diff -- .",cfg.workspace,{},20000)]);const quality=qualityStore.snapshot();
    const docs=["ROADMAP.md","CURRENT_STATE.md","CURRENT_TASK.md","ARCHITECTURE.md","MVP.md","DECISIONS.md"].map(name=>({name,file:path.join(cfg.workspace,"docs",name)}));
    const context={createdAt:new Date().toISOString(),workspace:cfg.workspace,currentRoadmap:roadmap.current||null,git,health,quality:quality.latest||{},documents:docs.filter(x=>fs.existsSync(x.file)).map(x=>x.name)};
    fs.writeFileSync(path.join(dir,"00-CONTEXT.json"),redact(JSON.stringify(context,null,2)),"utf8");
    fs.writeFileSync(path.join(dir,"01-PROMPT.md"),[`# Contexte MEN Pilot pour Claude`,``,`## Travail actuel`,roadmap.current?`**${roadmap.current.id} — ${roadmap.current.summary}**`:"Étape non détectée.",``,`## État Git`,git.available?`Branche **${git.branch}**, commit **${git.commit}**, ${git.dirty?`${git.changedFiles} fichier(s) modifié(s)`:"working tree propre"}.`:"Git indisponible.",``,`## Santé`, `État global : **${health.global}**.`,``,`## Consigne`,`Utilise les documents joints comme source de vérité du projet. Commence par CURRENT_TASK.md / CURRENT_STATE.md lorsqu'ils existent, puis ROADMAP.md. Ne modifie pas un périmètre non demandé sans l'indiquer.`].join("\n"),"utf8");
    for(const doc of docs){const text=this.readIfExists(doc.file);if(text)fs.writeFileSync(path.join(dir,doc.name),redact(text),"utf8");}
    fs.writeFileSync(path.join(dir,"GIT-DIFF.patch"),redact(diff.stdout||""),"utf8");
    fs.writeFileSync(path.join(dir,"RECENT-LOGS.txt"),redact((logStore.getAll?logStore.getAll():[]).slice(-500).map(x=>`[${x.at}] [${x.service}] ${x.message}`).join("\n")),"utf8");
    const zip=`${dir}.zip`;const r=await capture(`powershell -NoProfile -Command "Compress-Archive -Path '${dir.replaceAll("'","''")}\\*' -DestinationPath '${zip.replaceAll("'","''")}' -Force"`,this.root,{},120000);
    return r.code===0&&fs.existsSync(zip)?{ok:true,file:zip,folder:dir,current:roadmap.current||null}:{ok:false,error:r.stderr||r.error||"Création du pack impossible.",folder:dir};
  }
}
module.exports={ClaudeContextManager};
