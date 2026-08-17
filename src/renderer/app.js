const state = {
  snapshot: null,
  config: null,
  overview: null,
  roadmap: null,
  diagnostics: null,
  tasks: { running: [], lastResults: {} },
  session: { active: null, sessions: [] },
  update: null,
  logFilter: "all",
  logs: { all: [], docker: [], postgres: [], backend: [], frontend: [], tasks: [] }
};

const labels = { docker: "Docker Desktop", postgres: "PostgreSQL", backend: "Spring Boot API", frontend: "Angular Frontend" };
const statusLabels = { running:"EN LIGNE", external:"ACTIF / EXTERNE", starting:"DÉMARRAGE", stopping:"ARRÊT", error:"ERREUR", stopped:"ARRÊTÉ", unknown:"INCONNU" };
const updateLabels = { idle:"Prêt", development:"Mode développement", checking:"Recherche en cours", available:"Mise à jour disponible", downloading:"Téléchargement", downloaded:"Prête à installer", "up-to-date":"À jour", error:"Erreur", unconfigured:"Canal non configuré" };
const roadmapLabels = { done:"TERMINÉ", current:"EN COURS", planned:"À VENIR", blocked:"BLOQUÉ" };

const el = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");

function fmtTime(iso) { if (!iso) return "—"; return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(iso)); }
function fmtDateTime(iso) { if (!iso) return "—"; return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(iso)); }
function fmtDuration(ms) { if (ms == null) return "—"; const s=Math.floor(ms/1000); if(s<60)return `${s}s`; const m=Math.floor(s/60); if(m<60)return `${m}m ${s%60}s`; return `${Math.floor(m/60)}h ${m%60}m`; }
function fmtBytes(bytes) { const n=Number(bytes||0); if(!n)return "0 MB"; return `${(n/1024/1024).toFixed(n>1024**3?1:0)} MB`; }
function uptime(iso) { return iso ? fmtDuration(Date.now()-new Date(iso).getTime()) : "—"; }

function toast(message,type="info") { const node=document.createElement("div"); node.className=`toast ${type}`; node.textContent=message; el("toastHost").appendChild(node); setTimeout(()=>node.remove(),4200); }
function setBusy(button,busy,label="En cours..."){ if(!button)return; if(!button.dataset.originalLabel)button.dataset.originalLabel=button.textContent; button.disabled=busy; button.textContent=busy?label:button.dataset.originalLabel; }
function info(label,value,klass="") { return `<div class="info-item"><div class="info-label">${esc(label)}</div><div class="info-value ${klass}">${esc(value ?? "—")}</div></div>`; }

function renderProfiles() {
  const select=el("profileSelect");
  const profiles=state.config?.profiles||{};
  select.innerHTML=Object.entries(profiles).map(([k,v])=>`<option value="${esc(k)}">${esc(v.label||k.toUpperCase())}</option>`).join("");
  select.value=state.config?.activeProfile||"dev";
}

function renderDashboard() {
  const snap=state.snapshot; if(!snap)return;
  const services=Object.values(snap.services||{}); const online=services.filter(s=>s.portOpen).length;
  el("metricServices").textContent=`${online} / ${services.length}`;
  el("lastRefresh").textContent=`Dernière vérification : ${fmtTime(snap.at)} · Profil ${String(snap.activeProfile||"").toUpperCase()}`;
  el("workspaceShort").textContent=snap.workspace||"";

  const git=state.overview?.git;
  el("metricBranch").textContent=git?.available ? git.branch : "—";
  el("metricCommit").textContent=git?.available ? `${git.commit}${git.dirty?` · ${git.changedFiles} modif.`:" · clean"}` : "Git indisponible";

  const bt=state.tasks?.lastResults?.backendTests; const ft=state.tasks?.lastResults?.frontendTests;
  const summary=(r)=>r?.summary?.tests!=null?`${r.summary.tests} ${r.ok?"✓":"✗"}`:(r? (r.ok?"OK":"FAIL") : "—");
  el("metricTests").textContent=`B ${summary(bt)} · F ${summary(ft)}`;

  const rs=state.roadmap?.summary;
  el("metricRoadmap").textContent=rs?.total ? `${rs.done||0}/${rs.total}` : "—";
  el("metricRoadmapCurrent").textContent=state.roadmap?.current ? `${state.roadmap.current.id} · ${state.roadmap.current.title}` : "Roadmap non détectée";

  const global=el("globalStatus");
  if(online===services.length&&services.length){global.className="global-status good";global.innerHTML='<span class="dot"></span><span>MEN Pilot opérationnel</span>';}
  else if(services.some(s=>s.status==="error"||s.buildStatus==="error")){global.className="global-status bad";global.innerHTML='<span class="dot"></span><span>Erreur détectée</span>';}
  else if(online>0){global.className="global-status warn";global.innerHTML='<span class="dot"></span><span>Démarrage partiel</span>';}
  else{global.className="global-status";global.innerHTML='<span class="dot"></span><span>MEN Pilot arrêté</span>';}

  const resources=state.overview?.resources||{}; const health=state.overview?.health||{};
  el("serviceGrid").innerHTML=services.map(service=>{
    const cfg=state.config?.services?.[service.name]||{}; const res=resources[service.name]||{}; const h=health[service.name];
    const canStop=service.status!=="external";
    let hText="Health non configuré", hClass="";
    if(service.name==="docker") { hText=service.portOpen?"Docker Engine disponible":"Docker Engine arrêté"; hClass=service.portOpen?"good":"bad"; }
    else if(h?.supported===true){hText=h.ok?`HTTP ${h.status} OK`:`HTTP ${h.status||"DOWN"}`;hClass=h.ok?"good":"bad";}
    else if(h?.supported===false&&service.portOpen){hText="Service disponible";hClass="good";}
    const build=service.name==="frontend"?` · build ${service.buildStatus||"unknown"}`:"";
    return `<article class="service-card">
      <div class="service-head"><div><div class="service-name">${esc(labels[service.name]||service.name)}</div><div class="service-sub">${service.name==="docker"?"Moteur de conteneurs MEN Pilot":esc(cfg.startCommand||"")}</div></div><span class="badge ${esc(service.status)}">${esc(statusLabels[service.status]||service.status)}</span></div>
      <div class="service-details"><div class="detail"><div class="detail-label">PORT</div><div class="detail-value">${esc(cfg.port||"—")}</div></div><div class="detail"><div class="detail-label">PID</div><div class="detail-value">${esc(service.pid||"—")}</div></div><div class="detail"><div class="detail-label">UPTIME</div><div class="detail-value">${esc(uptime(service.startedAt))}</div></div></div>
      <div class="resource-line"><span>CPU ${Number(res.cpu||0).toFixed(1)}%</span><span>RAM ${fmtBytes(res.memoryBytes)}</span><span>${res.processes||0} proc.${build}</span></div>
      <div class="health-line ${hClass}">${esc(hText)}</div>
      ${service.lastError?`<div class="service-sub" style="color:#ff9ca6;margin:10px 0">${esc(service.lastError)}</div>`:""}
      <div class="service-actions"><button class="btn secondary service-action" data-action="start" data-service="${service.name}">Démarrer</button><button class="btn secondary service-action" data-action="restart" data-service="${service.name}" ${canStop?"":"disabled"}>Redémarrer</button><button class="btn danger service-action" data-action="stop" data-service="${service.name}" ${canStop?"":"disabled"}>Arrêter</button></div>
    </article>`;
  }).join("");

  renderHistory(); renderOverview(); renderSession();
}

function renderOverview(){
  const o=state.overview; if(!o){el("projectOverview").innerHTML=info("État","Chargement...");return;}
  const git=o.git||{}; const db=o.database||{}; const docker=o.docker||{};
  el("projectOverview").innerHTML=[
    info("Git",git.available?`${git.branch} @ ${git.commit}`:"Indisponible",git.available?"good":"bad"),
    info("Working tree",git.available?(git.dirty?`${git.changedFiles} fichier(s) modifié(s)`:"Clean"):"—",git?.dirty?"warn":"good"),
    info("Flyway",db.flyway?`V${db.flyway.version} · ${db.flyway.description}`:(db.flywayAvailable?"Aucune migration":"Table non détectée"),db.flyway?.success?"good":""),
    info("Base",db.available?`${db.database} · ${db.size||"taille inconnue"}`:"Indisponible",db.available?"good":"bad"),
    info("Docker PostgreSQL",docker.running?`${docker.status||"running"}${docker.health?` · ${docker.health}`:""}`:"Arrêté",docker.running?"good":"bad"),
    info("Docker ressources",docker.stats?`${docker.stats.cpu||"—"} · ${docker.stats.memory||"—"}`:"—")
  ].join("");
  renderDatabase();
}

function renderDatabase(){
  const o=state.overview||{}; const d=o.docker||{}; const db=o.database||{};
  el("dockerPanel").innerHTML=[info("Conteneur",d.containerId||"—"),info("État",d.running?d.status||"running":"stopped",d.running?"good":"bad"),info("CPU",d.stats?.cpu||"—"),info("Mémoire",d.stats?.memory||"—"),info("Net I/O",d.stats?.netIO||"—"),info("Block I/O",d.stats?.blockIO||"—")].join("");
  el("databasePanel").innerHTML=[info("Base",db.database||"—"),info("Utilisateur",db.user||"—"),info("Taille",db.size||"—"),info("Flyway",db.flyway?`V${db.flyway.version} · ${db.flyway.description}`:(db.flywayAvailable?"Aucune ligne":"Non détecté"),db.flyway?.success?"good":"")].join("");
}

function renderRoadmap(){
  const r=state.roadmap; const summary=el("roadmapSummary"), current=el("roadmapCurrent"), list=el("roadmapList");
  if(!r?.available){summary.innerHTML="";current.innerHTML=`<div class="notice">${esc(r?.error||"Roadmap indisponible")}</div>`;list.innerHTML="";return;}
  const s=r.summary||{};
  summary.innerHTML=[
    ["Terminés",s.done||0,"good"],["En cours",s.current||0,"warn"],["À venir",s.planned||0,""],["Bloqués",s.blocked||0,"bad"]
  ].map(([label,value,klass])=>`<article class="metric"><div class="metric-label">${label}</div><div class="metric-value ${klass}">${value}</div><div class="metric-foot">sur ${s.total||0} étapes détectées</div></article>`).join("");
  current.innerHTML=r.current?`<div class="roadmap-focus"><div class="roadmap-focus-label">POSITION ACTUELLE</div><div class="roadmap-focus-id">${esc(r.current.id)}</div><div class="roadmap-focus-title">${esc(r.current.title)}</div><div class="muted">Source : ${esc(r.file)} · modifiée ${esc(fmtDateTime(r.modifiedAt))}</div></div>`:"";
  list.innerHTML=(r.items||[]).map(item=>`<div class="roadmap-item ${esc(item.status)}"><span class="roadmap-dot"></span><div class="roadmap-id">${esc(item.id)}</div><div class="roadmap-title">${esc(item.title)}</div><span class="roadmap-badge ${esc(item.status)}">${esc(roadmapLabels[item.status]||item.status)}</span></div>`).join("");
}

function renderHistory(){
  const history=state.snapshot?.history||[];
  el("recentHistory").innerHTML=history.slice(0,12).map(i=>`<div class="timeline-item"><span class="timeline-time">${esc(fmtTime(i.at))}</span><span class="timeline-service">${esc(i.service)}</span><span class="timeline-outcome ${esc(i.outcome)}">${esc(i.action)} · ${esc(i.outcome)}</span></div>`).join("")||'<div class="muted">Aucune activité.</div>';
  el("historyBody").innerHTML=history.map(i=>`<tr><td>${esc(fmtDateTime(i.at))}</td><td>${esc(i.service)}</td><td>${esc(i.action)}</td><td><span class="outcome-pill ${esc(i.outcome)}">${esc(i.outcome)}</span></td><td>${esc(fmtDuration(i.durationMs))}</td><td>${esc(i.detail||"—")}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">Aucun historique.</td></tr>';
}

function logLine(entry){const level=entry.level==="error"?"ERR":"INF";return `[${fmtTime(entry.at)}] [${String(entry.service).toUpperCase()}] [${level}] ${entry.message}`;}
function renderLogs(){
  el("liveConsole").textContent=state.logs.all.slice(-120).map(logLine).join("\n")||"Aucune sortie.";
  const selected=state.logs[state.logFilter]||[]; el("fullConsole").textContent=selected.map(logLine).join("\n")||"Aucune sortie.";
  el("taskConsole").textContent=(state.logs.tasks||[]).slice(-180).map(logLine).join("\n")||"Aucune tâche exécutée.";
  for(const id of ["fullConsole","liveConsole","taskConsole"]){const n=el(id);n.scrollTop=n.scrollHeight;}
}

function renderTaskResult(kind,id){
  const r=state.tasks?.lastResults?.[kind]; const host=el(id);
  if(!r){host.innerHTML='<div class="muted">Aucun test exécuté dans cette session du launcher.</div>';return;}
  const s=r.summary; let main=r.ok?"SUCCÈS":"ÉCHEC"; if(s?.tests!=null)main=`${s.tests} tests · ${s.passed??"?"} passés`;
  host.innerHTML=`<div class="result-main ${r.ok?"good":"bad"}">${esc(main)}</div><div class="result-meta">${esc(fmtDateTime(r.at))} · ${esc(fmtDuration(r.durationMs))} · code ${esc(r.code)}</div>${s?`<div class="result-meta">Failures ${s.failures??"?"} · Errors ${s.errors??0} · Skipped ${s.skipped??0}</div>`:""}`;
}
function renderTasks(){renderTaskResult("backendTests","backendTestResult");renderTaskResult("frontendTests","frontendTestResult");document.querySelectorAll(".task-button").forEach(b=>b.disabled=(state.tasks.running||[]).includes(b.dataset.task));}

function renderSession(){
  const s=state.session?.active; const host=el("sessionPanel"); const button=el("sessionToggle");
  if(s){button.textContent="Terminer session";button.className="btn danger";host.innerHTML=`<div class="session-current"><strong>Session active</strong><div class="muted">Depuis ${esc(fmtDateTime(s.startedAt))} · ${esc(fmtDuration(Date.now()-new Date(s.startedAt).getTime()))}</div><div class="muted">Profil ${esc(s.profile||"—")} · erreurs ${esc(s.errors||0)} · tests ${(s.tests||[]).length}</div><div class="session-id">${esc(s.id)}</div></div>`;}
  else{button.textContent="Démarrer session";button.className="btn secondary";const last=state.session?.sessions?.[0];host.innerHTML=last?`<div class="result-meta">Dernière session : ${esc(fmtDateTime(last.startedAt))} · ${esc(fmtDuration(last.durationMs))} · ${esc(last.errors||0)} erreur(s)</div>`:'<div class="muted">Aucune session active.</div>';}
}

function normaliseReleaseNotes(notes){
  if(!notes)return [];
  if(Array.isArray(notes)) return notes.map(n=>typeof n==="string"?n:(n.note||n.version||JSON.stringify(n)));
  return String(notes).split(/\r?\n/).map(x=>x.replace(/^[-*]\s*/,"").trim()).filter(Boolean).slice(0,20);
}

function renderUpdate(){
  const u=state.update;if(!u)return;el("launcherVersion").textContent=`Launcher v${u.currentVersion}`;
  const detail=u.error|| (u.availableVersion?`Version disponible : ${u.availableVersion}`:`Version installée : ${u.currentVersion}`);
  el("updateStatus").innerHTML=`<div class="update-title">${esc(updateLabels[u.status]||u.status)}</div><div class="update-detail">${esc(detail)}</div>${u.checkedAt?`<div class="update-detail">Dernière vérification : ${esc(fmtDateTime(u.checkedAt))}</div>`:""}`;
  el("updateProgress").style.width=`${Math.min(100,Math.max(0,u.progress?.percent||0))}%`;
  el("downloadUpdate").disabled=!(u.status==="available");
  el("installUpdate").disabled=!u.downloaded;
  const notes=normaliseReleaseNotes(u.releaseNotes);
  el("availableReleaseNotes").innerHTML=notes.length?`<div class="release-card active-release"><div class="release-head"><strong>${esc(u.releaseName||`Version ${u.availableVersion||u.currentVersion}`)}</strong><span>Notes de version</span></div><ul>${notes.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:"";
  el("releaseHistory").innerHTML=(u.catalogue||[]).map(r=>`<article class="release-card"><div class="release-head"><div><strong>v${esc(r.version)}</strong><div class="release-title">${esc(r.title||"")}</div></div><span class="release-state">${esc(r.status||"")}</span></div><ul>${(r.lots||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></article>`).join("")||'<div class="muted">Aucun catalogue de versions embarqué.</div>';
}

function renderDiagnostics(result){
  state.diagnostics=result; const host=el("diagnosticsResult");host.className="diagnostics-grid";
  host.innerHTML=result.checks.map(c=>`<div class="diagnostic-card ${c.neutral?"neutral":c.ok?"ok":"bad"}"><span class="diagnostic-icon"></span><div><div class="diagnostic-label">${esc(c.label)}</div><div class="diagnostic-detail">${esc(c.detail)}</div>${c.repair?`<div class="diagnostic-repair">Réparation : ${esc(c.repair)}</div>`:""}</div></div>`).join("");
  el("repairEnvironment").disabled=!result.repairAvailable;
}

function hydrateSettings(){
  const c=state.config;if(!c)return;
  el("cfgWorkspace").value=c.workspace||"";el("cfgPostgresPort").value=c.services?.postgres?.port||5432;el("cfgBackendPort").value=c.services?.backend?.port||8080;el("cfgFrontendPort").value=c.services?.frontend?.port||4200;
  el("cfgApplicationUrl").value=c.urls?.application||"";el("cfgBackendUrl").value=c.urls?.backend||"";el("cfgSwaggerUrl").value=c.urls?.swagger||"";el("cfgPgadminUrl").value=c.urls?.pgadmin||"";el("cfgUpdateUrl").value=c.updates?.genericUrl||"";
  el("cfgAutoUpdate").checked=c.updates?.autoCheck!==false;el("cfgAutoDownload").checked=c.updates?.autoDownload!==false;el("cfgNotifications").checked=c.notifications?.enabled!==false;el("cfgLaunchAtLogin").checked=Boolean(c.windows?.launchAtLogin);el("cfgAllowReset").checked=Boolean(c.safety?.allowDatabaseReset);
  el("cfgAutoStartDocker").checked=c.docker?.autoStart!==false;el("cfgStopDocker").checked=Boolean(c.docker?.stopWithMenPilot);
  el("resetDatabase").disabled=!c.safety?.allowDatabaseReset;el("openPgadmin").disabled=!c.urls?.pgadmin;renderProfiles();
}

async function refreshSnapshot(){state.snapshot=await window.men.snapshot();renderDashboard();}
async function refreshOverview(){try{state.overview=await window.men.projectOverview();renderDashboard();}catch(e){toast(e.message||String(e),"error");}}
async function refreshRoadmap(){state.roadmap=await window.men.roadmap();renderRoadmap();renderDashboard();}
async function loadLogs(){for(const n of ["all","docker","postgres","backend","frontend","tasks"])state.logs[n]=await window.men.getLogs(n);renderLogs();}
async function refreshTasks(){state.tasks=await window.men.taskSnapshot();renderTasks();renderDashboard();}
async function refreshSession(){state.session=await window.men.sessionSnapshot();renderSession();}
async function refreshUpdate(){state.update=await window.men.updateSnapshot();renderUpdate();}

async function serviceAction(button){const {service:name,action}=button.dataset;setBusy(button,true);try{let r;if(action==="start")r=await window.men.startService(name);if(action==="stop")r=await window.men.stopService(name);if(action==="restart")r=await window.men.restartService(name);toast(r?.ok?`${labels[name]} : opération terminée.`:(r?.error||"Opération impossible."),r?.ok?"success":r?.external?"warning":"error");}catch(e){toast(e.message||String(e),"error");}finally{setBusy(button,false);await refreshSnapshot();await refreshOverview();await loadLogs();}}
async function runTask(button){const kind=button.dataset.task;setBusy(button,true,"Exécution...");try{const r=await window.men.runTask(kind);toast(r.ok?`${kind} terminé.`:(r.error||`${kind} en échec.`),r.ok?"success":"error");}finally{setBusy(button,false);await refreshTasks();await loadLogs();await refreshSnapshot();await refreshOverview();}}

document.addEventListener("click",async e=>{const nav=e.target.closest(".nav-item");if(nav){document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));document.querySelectorAll(".section").forEach(s=>s.classList.remove("active"));nav.classList.add("active");el(`section-${nav.dataset.section}`).classList.add("active");el("pageTitle").textContent=nav.textContent;if(nav.dataset.section==="roadmap")await refreshRoadmap();}const a=e.target.closest(".service-action");if(a)await serviceAction(a);const t=e.target.closest(".task-button");if(t)await runTask(t);});

el("startAll").onclick=async()=>{const b=el("startAll");setBusy(b,true,"Démarrage...");try{const r=await window.men.startAll();toast(r.ok?"MEN Pilot est démarré.":"Démarrage interrompu par une erreur.",r.ok?"success":"error");}finally{setBusy(b,false);await refreshSnapshot();await refreshOverview();await loadLogs();}};
el("stopAll").onclick=async()=>{const b=el("stopAll");setBusy(b,true,"Arrêt...");try{const r=await window.men.stopAll();toast(r.ok?"Commande d'arrêt terminée.":"Certains services n'ont pas pu être arrêtés.",r.ok?"success":"warning");}finally{setBusy(b,false);await refreshSnapshot();await refreshOverview();}};
el("profileSelect").onchange=async e=>{const old=state.config.activeProfile;const r=await window.men.setProfile(e.target.value);if(!r.ok){e.target.value=old;toast(r.error,"warning");}else{state.config.activeProfile=e.target.value;toast(`Profil ${e.target.value.toUpperCase()} activé.`,"success");await refreshSnapshot();}};
el("sessionToggle").onclick=async()=>{state.session=state.session?.active?await window.men.sessionStop():await window.men.sessionStart();renderSession();};
el("openApp").onclick=()=>window.men.openApplication();el("openWorkspace").onclick=()=>window.men.openWorkspace();el("openLogsFolder").onclick=()=>window.men.openLogDirectory();el("openSwagger").onclick=()=>window.men.openSwagger();el("openBackend").onclick=()=>window.men.openBackend();el("openPgadmin").onclick=()=>window.men.openPgadmin();el("openRoadmap").onclick=()=>window.men.openRoadmapFile();
el("refreshOverview").onclick=refreshOverview;el("refreshDatabase").onclick=refreshOverview;el("refreshRoadmap").onclick=refreshRoadmap;
el("clearHistory").onclick=async()=>{await window.men.clearHistory();await refreshSnapshot();toast("Historique vidé.","success");};
el("runDiagnostics").onclick=async()=>{const b=el("runDiagnostics");setBusy(b,true,"Analyse...");try{const r=await window.men.diagnostics();renderDiagnostics(r);toast(r.ok?"Environnement principal valide.":"Diagnostic : problème détecté.",r.ok?"success":"warning");}finally{setBusy(b,false);}};
el("repairEnvironment").onclick=async()=>{const b=el("repairEnvironment");setBusy(b,true,"Réparation...");try{const r=await window.men.repairEnvironment();renderDiagnostics(r.diagnostics);state.config=await window.men.getConfig();hydrateSettings();el("repairStatus").textContent=r.result.ok?"Java, Node et npm ont été résolus pour les processus lancés par MEN Pilot Launcher.":"Réparation partielle : certains outils restent introuvables.";toast(r.result.ok?"Environnement du launcher réparé.":"Réparation partielle.",r.result.ok?"success":"warning");}finally{setBusy(b,false);}};
el("resetDatabase").onclick=async()=>{const token=window.prompt("Cette action supprime les volumes Docker locaux. Tapez exactement RESET pour confirmer.");if(token!=="RESET")return;const r=await window.men.resetDatabase(token);toast(r.ok?"Base locale réinitialisée.":(r.error||"Reset échoué."),r.ok?"success":"error");await refreshOverview();await refreshSnapshot();};
el("checkUpdate").onclick=async()=>{state.update=await window.men.updateCheck();renderUpdate();};el("downloadUpdate").onclick=async()=>{state.update=await window.men.updateDownload();renderUpdate();};el("installUpdate").onclick=async()=>{const r=await window.men.updateInstall();if(!r.ok)toast(r.error,"error");else toast("Installation de la mise à jour...","success");};
el("logFilter").onclick=async e=>{const b=e.target.closest("button[data-service]");if(!b)return;el("logFilter").querySelectorAll("button").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.logFilter=b.dataset.service;state.logs[state.logFilter]=await window.men.getLogs(state.logFilter);renderLogs();};
el("settingsForm").onsubmit=async e=>{e.preventDefault();const c=structuredClone(state.config);c.workspace=el("cfgWorkspace").value.trim();c.services.postgres.port=Number(el("cfgPostgresPort").value);c.services.backend.port=Number(el("cfgBackendPort").value);c.services.frontend.port=Number(el("cfgFrontendPort").value);c.urls.application=el("cfgApplicationUrl").value.trim();c.urls.backend=el("cfgBackendUrl").value.trim();c.urls.swagger=el("cfgSwaggerUrl").value.trim();c.urls.pgadmin=el("cfgPgadminUrl").value.trim();c.updates.genericUrl=el("cfgUpdateUrl").value.trim();c.updates.autoCheck=el("cfgAutoUpdate").checked;c.updates.autoDownload=el("cfgAutoDownload").checked;c.notifications.enabled=el("cfgNotifications").checked;c.windows.launchAtLogin=el("cfgLaunchAtLogin").checked;c.safety.allowDatabaseReset=el("cfgAllowReset").checked;c.docker=c.docker||{};c.docker.autoStart=el("cfgAutoStartDocker").checked;c.docker.stopWithMenPilot=el("cfgStopDocker").checked;state.config=await window.men.saveConfig(c);el("settingsStatus").textContent="Configuration enregistrée.";toast("Configuration enregistrée.","success");hydrateSettings();await refreshSnapshot();};

window.men.onState(s=>{state.snapshot=s;renderDashboard();});
window.men.onLog(entry=>{state.logs.all.push(entry);(state.logs[entry.service]??=[]).push(entry);for(const k of Object.keys(state.logs))if(state.logs[k].length>2500)state.logs[k]=state.logs[k].slice(-2500);renderLogs();});
window.men.onTask(t=>{state.tasks=t;renderTasks();renderDashboard();});
window.men.onUpdate(u=>{state.update=u;renderUpdate();});
window.men.onSession(s=>{state.session=s;renderSession();});

(async()=>{state.config=await window.men.getConfig();hydrateSettings();await Promise.all([refreshSnapshot(),loadLogs(),refreshTasks(),refreshSession(),refreshUpdate(),refreshRoadmap()]);await refreshOverview();setInterval(()=>refreshOverview().catch(()=>{}),10000);})();
