const fs = require("fs");
const path = require("path");

function clean(value) { return String(value || "").trim(); }
function statusFromText(text) {
  const value = clean(text).toLowerCase();
  if (/✅|\[x\]|termin[ée]|done|complete|completed/.test(value)) return "done";
  if (/🟡|🚧|en cours|in progress|current|actuel/.test(value)) return "current";
  if (/⛔|bloqu[ée]|blocked/.test(value)) return "blocked";
  return "planned";
}

function frenchSummary(title, id) {
  let value = clean(title).replace(/`/g, "");
  const replacements = [
    [/\bbackend\b/gi, "services serveur"],
    [/\bfrontend\b/gi, "interface utilisateur"],
    [/\bworkforce\b/gi, "gestion des intervenants"],
    [/\bcatalog(?:ue)?\b/gi, "catalogue des prestations"],
    [/\bmigration\b/gi, "évolution de la base de données"],
    [/\bAPI\b/g, "échanges avec le serveur"],
    [/\bauth(?:entication)?\b/gi, "authentification"],
    [/\bCRUD\b/gi, "création, consultation et modification"],
    [/\bmodel(?:ing|le)?\b/gi, "modèle de données"],
    [/\bcost\b/gi, "coût"],
    [/\breal cost\b/gi, "coût réel"],
    [/\btests?\b/gi, "vérifications automatiques"],
    [/\bUI\b/g, "interface"],
    [/\bengine\b/gi, "moteur de calcul"],
    [/\bpricing\b/gi, "tarification"],
    [/\bworkflow\b/gi, "processus métier"],
    [/\bintegration\b/gi, "connexion aux services externes"]
  ];
  for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
  value = value.replace(/\s+/g," ").trim();
  if (!value || value === id) return `Étape ${id}`;
  value = value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

function parseRoadmapMarkdown(markdown) {
  const rawLines = String(markdown || "").split(/\r?\n/);
  const items = [];
  let section = null;

  for (let index=0; index<rawLines.length; index++) {
    const raw=rawLines[index]; const line=clean(raw); if(!line) continue;
    const heading=line.match(/^#{1,4}\s+(.+)$/);
    if(heading){
      section=clean(heading[1]);
      const id=section.match(/\bT\d+(?:\.\d+){0,3}\b/i)?.[0]?.toUpperCase()||null;
      if(id){
        const title=section.replace(id,"").replace(/^\s*[—:-]\s*/,"").trim()||section;
        const context=rawLines.slice(index,Math.min(rawLines.length,index+12)).join("\n").trim();
        items.push({id,title,summary:frenchSummary(title,id),status:statusFromText(section),source:"heading",line:index+1,section,details:{originalTitle:title,sourceExcerpt:context}});
      }
      continue;
    }
    const id=line.match(/\bT\d+(?:\.\d+){0,3}\b/i)?.[0]?.toUpperCase(); if(!id) continue;
    const title=line.replace(/^[-*+]\s*/,"").replace(/^\[[ xX]\]\s*/,"").replace(/[✅🟡🚧⛔⬜]/g,"").replace(id,"").replace(/^\s*[—:-]\s*/,"").trim();
    const context=rawLines.slice(Math.max(0,index-1),Math.min(rawLines.length,index+8)).join("\n").trim();
    items.push({id,title:title||section||id,summary:frenchSummary(title||section||id,id),status:statusFromText(line),source:"line",line:index+1,section,details:{originalTitle:title||section||id,sourceExcerpt:context}});
  }

  const rank=id=>id.split(".").map(x=>Number(x.replace(/^T/i,""))||0);
  const compare=(a,b)=>{const aa=rank(a.id),bb=rank(b.id);for(let i=0;i<Math.max(aa.length,bb.length);i++){const d=(aa[i]||0)-(bb[i]||0);if(d)return d;}return 0;};
  const map=new Map();
  for(const item of items){const previous=map.get(item.id);if(!previous||previous.source==="heading")map.set(item.id,item);}
  return [...map.values()].sort(compare);
}

function groupRoadmap(items){
  const groups=new Map();
  for(const item of items){const groupId=item.id.split(".")[0];if(!groups.has(groupId))groups.set(groupId,{id:groupId,title:groupId,summaryTitle:`Tranche ${groupId.replace("T","")}`,items:[],summary:{done:0,current:0,planned:0,blocked:0,total:0}});const group=groups.get(groupId);if(item.id===groupId){group.title=item.title||groupId;group.summaryTitle=item.summary||group.summaryTitle;}else group.items.push(item);}
  for(const group of groups.values()){
    for(const item of group.items){group.summary[item.status]=(group.summary[item.status]||0)+1;group.summary.total+=1;}
    const total=group.summary.total||1;group.progress=Math.round(((group.summary.done||0)/total)*100);group.status=group.summary.blocked?"blocked":group.summary.current?"current":group.summary.planned?"planned":"done";group.current=group.items.find(item=>item.status==="current")||null;
  }
  return [...groups.values()];
}

class RoadmapManager{
  constructor(configStore){this.configStore=configStore;}
  config(){return this.configStore.get();}
  candidates(){const w=this.config().workspace;return[path.join(w,"docs","ROADMAP.md"),path.join(w,"ROADMAP.md"),path.join(w,"docs","MVP.md")];}
  snapshot(){
    const file=this.candidates().find(p=>fs.existsSync(p));
    if(!file)return{available:false,file:null,items:[],groups:[],summary:{done:0,current:0,planned:0,blocked:0,total:0},error:"Aucun ROADMAP.md n'a été trouvé dans le workspace MEN Pilot."};
    try{
      const markdown=fs.readFileSync(file,"utf8");const items=parseRoadmapMarkdown(markdown);const summary={done:0,current:0,planned:0,blocked:0,total:items.length};for(const item of items)summary[item.status]=(summary[item.status]||0)+1;const current=items.find(x=>x.status==="current")||items.find(x=>x.status==="planned")||items.at(-1)||null;
      return{available:true,file,modifiedAt:fs.statSync(file).mtime.toISOString(),items,groups:groupRoadmap(items),current,summary};
    }catch(error){return{available:false,file,items:[],groups:[],summary:{total:0},error:error?.message||String(error)};}
  }
}
module.exports={RoadmapManager,parseRoadmapMarkdown,groupRoadmap,frenchSummary};
