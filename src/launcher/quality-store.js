const fs=require("fs");
const path=require("path");

class QualityStore{
  constructor(userDataPath){this.file=path.join(userDataPath,"quality-history.json");this.ensure();}
  ensure(){fs.mkdirSync(path.dirname(this.file),{recursive:true});if(!fs.existsSync(this.file))fs.writeFileSync(this.file,"[]","utf8");}
  read(){try{const v=JSON.parse(fs.readFileSync(this.file,"utf8"));return Array.isArray(v)?v:[];}catch{return [];}}
  add(result){const rows=this.read();const entry={id:`${Date.now()}-${Math.random().toString(16).slice(2)}`,at:new Date().toISOString(),...result};rows.unshift(entry);fs.writeFileSync(this.file,JSON.stringify(rows.slice(0,500),null,2),"utf8");return entry;}
  snapshot(){const rows=this.read();const latest={};for(const row of rows){if(!latest[row.kind])latest[row.kind]=row;}return{rows:rows.slice(0,100),latest};}
}
module.exports={QualityStore};
