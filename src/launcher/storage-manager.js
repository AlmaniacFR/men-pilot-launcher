const fs=require("fs");
const path=require("path");
const {capture}=require("./process-utils");

function clean(v){return String(v||"").trim();}
class StorageManager{
  constructor(configStore,historyStore){this.configStore=configStore;this.historyStore=historyStore;}
  config(){return this.configStore.get();}
  async dirSize(dir){
    if(!fs.existsSync(dir))return 0;
    const escaped=String(dir).replaceAll("'","''");
    const r=await capture(`powershell -NoProfile -Command "$s=(Get-ChildItem -LiteralPath '${escaped}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; if($null -eq $s){0}else{$s}"`,this.config().workspace,{},45000);
    return r.code===0?Number(clean(r.stdout)||0):null;
  }
  async dockerSize(){
    const r=await capture("docker system df --format \"{{json .}}\"",this.config().workspace,{},15000);
    if(r.code!==0)return{available:false};
    return{available:true,lines:clean(r.stdout).split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return{raw:line};}})};
  }
  async drive(){
    const root=path.parse(path.resolve(this.config().workspace)).root; const letter=root[0];
    const r=await capture(`powershell -NoProfile -Command "$d=Get-PSDrive -Name '${letter}'; Write-Output ($d.Used); Write-Output ($d.Free)"`,this.config().workspace,{},8000);
    const [used,free]=clean(r.stdout).split(/\r?\n/).map(Number);
    return{root,usedBytes:Number.isFinite(used)?used:null,freeBytes:Number.isFinite(free)?free:null};
  }
  async snapshot(){
    const w=this.config().workspace;
    const [drive,nodeModules,backendTarget,frontendCache,docker]=await Promise.all([
      this.drive(),
      this.dirSize(path.join(w,"frontend","node_modules")),
      this.dirSize(path.join(w,"backend","target")),
      this.dirSize(path.join(w,"frontend",".angular")),
      this.dockerSize()
    ]);
    return{at:new Date().toISOString(),drive,items:[
      {key:"node_modules",label:"Frontend node_modules",path:path.join(w,"frontend","node_modules"),sizeBytes:nodeModules,cleanable:true},
      {key:"backend_target",label:"Backend target",path:path.join(w,"backend","target"),sizeBytes:backendTarget,cleanable:true},
      {key:"angular_cache",label:"Cache Angular",path:path.join(w,"frontend",".angular"),sizeBytes:frontendCache,cleanable:true}
    ],docker};
  }
  cleanItem(key){
    const w=this.config().workspace;const map={node_modules:path.join(w,"frontend","node_modules"),backend_target:path.join(w,"backend","target"),angular_cache:path.join(w,"frontend",".angular")};
    const target=map[key];if(!target)return{ok:false,error:"Élément inconnu."};
    try{if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});this.historyStore.add({service:"storage",action:"cleanup",outcome:"success",detail:target});return{ok:true};}catch(error){return{ok:false,error:error.message};}
  }
}
module.exports={StorageManager};
