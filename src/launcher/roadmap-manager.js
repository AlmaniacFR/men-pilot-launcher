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

function stripTechnicalNoise(value) {
  let text = clean(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/[>*_~`#]/g, " ")
    .replace(/[✅🟡🚧⛔⬜]/g, " ")
    .replace(/\[(?:x| )\]/gi, " ")
    .replace(/\b(?:ADR[-_ ]?\d+(?:\/\d+)*)\b/gi, " ")
    .replace(/\b[A-Z0-9_-]+\.(?:md|java|ts|tsx|js|json|sql|yml|yaml|xml|html|css)\b/g, " ")
    .replace(/\([^)]*(?:ADR|\.md|\.java|\.ts|\.sql|documentaire|technique)[^)]*\)/gi, " ")
    .replace(/\b(?:suivi vivant|décisions?|documentaire|documents? de référence)\s*:/gi, " ")
    .replace(/\s*\/\s*/g, " et ")
    .replace(/\s+/g, " ")
    .trim();

  // Les éléments placés après un point-virgule sont généralement des références techniques.
  text = text.split(";")[0].trim();
  text = text.replace(/^[\s:—–-]+|[\s:—–-]+$/g, "");
  return text;
}

function sentence(text) {
  let value = clean(text).replace(/\s+/g, " ");
  if (!value) return "";
  value = value.charAt(0).toUpperCase() + value.slice(1);
  return value.replace(/[.:;,-]+$/g, "");
}

function frenchSummary(title, id, context = "") {
  const raw = `${clean(title)} ${clean(context)}`.toLowerCase();

  // Formulations métier explicites : elles sont volontairement plus simples que les titres techniques.
  const intents = [
    [/\bcadrage\b|current_state|current_task|adr[-_ ]?0?29/, "Cadrer le projet et organiser son suivi"],
    [/auth|connexion|login|session utilisateur/, "Sécuriser l’accès à MEN Pilot"],
    [/catalog|catalogue|prestation|service catalogue/, "Mettre en place le catalogue des prestations"],
    [/workforce|intervenant|agent|profil de coût|coût horaire/, "Gérer les intervenants et leurs coûts"],
    [/coût réel|cout réel|real cost|coût opérationnel|cout opérationnel/, "Calculer et consolider les coûts réels des opérations"],
    [/pricing|tarification|marge|rentabilit/, "Construire la tarification et contrôler la rentabilité"],
    [/prospect|crm|commercial/, "Organiser le suivi des prospects et de l’activité commerciale"],
    [/devis|quote/, "Créer et suivre des devis fiables et rentables"],
    [/contrat|contract|projet client/, "Transformer les devis validés en contrats et projets"],
    [/planning|planification|intervention|schedule/, "Organiser les interventions et le planning"],
    [/factur|invoice/, "Gérer la facturation des prestations"],
    [/paiement|payment|impay|encaissement/, "Suivre les paiements, les échéances et les impayés"],
    [/dépense|depense|expense|achat|frais/, "Suivre les dépenses et leur impact sur les coûts"],
    [/dashboard|tableau de bord|pilotage/, "Donner une vue claire de l’activité et des indicateurs clés"],
    [/intégration|integration|microsoft|graph|pennylane|stripe/, "Connecter MEN Pilot aux services externes nécessaires"],
    [/sécurité|security|permission|rôle|role/, "Renforcer les droits d’accès et la sécurité de l’application"],
    [/test|qualité|quality|e2e|validation/, "Vérifier automatiquement que les fonctions de MEN Pilot restent fiables"],
    [/migration|flyway|base de données|database|schema/, "Faire évoluer la base de données de manière maîtrisée"],
    [/frontend|interface|angular|ui\b/, "Construire l’interface utilisateur correspondante"],
    [/backend|api\b|spring|serveur/, "Mettre en place les services serveur nécessaires"],
    [/report|rapport|export|pdf/, "Produire les rapports et exports utiles au pilotage"],
    [/notification|alerte/, "Mettre en place les alertes et notifications utiles"],
    [/audit|journal|historique|traçabilit/, "Assurer la traçabilité des actions importantes"],
    [/mvp|socle|fondation|architecture/, "Construire le socle fiable de MEN Pilot"]
  ];
  for (const [pattern, summary] of intents) if (pattern.test(raw)) return summary;

  let value = stripTechnicalNoise(title);
  value = value
    .replace(/\bbackend\b/gi, "services serveur")
    .replace(/\bfrontend\b/gi, "interface utilisateur")
    .replace(/\bworkforce\b/gi, "gestion des intervenants")
    .replace(/\bCRUD\b/gi, "gestion complète")
    .replace(/\bworkflow\b/gi, "processus métier")
    .replace(/\bpricing\b/gi, "tarification")
    .replace(/\bAPI\b/g, "échanges avec le serveur")
    .replace(/\bUI\b/g, "interface")
    .replace(/\btests?\b/gi, "vérifications automatiques")
    .replace(/\s+/g, " ")
    .trim();

  if (!value || value.toUpperCase() === String(id).toUpperCase()) return `Poursuivre l’étape ${id} de MEN Pilot`;
  return sentence(value);
}

function parseRoadmapMarkdown(markdown) {
  const rawLines = String(markdown || "").split(/\r?\n/);
  const items = [];
  let section = null;

  for (let index = 0; index < rawLines.length; index++) {
    const raw = rawLines[index];
    const line = clean(raw);
    if (!line) continue;

    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      section = clean(heading[1]);
      const id = section.match(/\bT\d+(?:\.\d+){0,3}\b/i)?.[0]?.toUpperCase() || null;
      if (id) {
        const originalTitle = section.replace(id, "").replace(/^\s*[—:-]\s*/, "").trim() || section;
        const contextLines = rawLines.slice(index, Math.min(rawLines.length, index + 14));
        const context = contextLines.join("\n").trim();
        items.push({
          id,
          title: stripTechnicalNoise(originalTitle) || originalTitle,
          summary: frenchSummary(originalTitle, id, context),
          status: statusFromText(`${section}\n${context}`),
          source: "heading",
          line: index + 1,
          section: stripTechnicalNoise(section),
          details: { originalTitle, sourceExcerpt: context }
        });
      }
      continue;
    }

    const id = line.match(/\bT\d+(?:\.\d+){0,3}\b/i)?.[0]?.toUpperCase();
    if (!id) continue;

    const originalTitle = line
      .replace(/^[-*+]\s*/, "")
      .replace(/^\[[ xX]\]\s*/, "")
      .replace(/[✅🟡🚧⛔⬜]/g, "")
      .replace(id, "")
      .replace(/^\s*[—:-]\s*/, "")
      .trim();
    const context = rawLines.slice(Math.max(0, index - 1), Math.min(rawLines.length, index + 9)).join("\n").trim();
    items.push({
      id,
      title: stripTechnicalNoise(originalTitle || section || id) || originalTitle || section || id,
      summary: frenchSummary(originalTitle || section || id, id, context),
      status: statusFromText(`${line}\n${context}`),
      source: "line",
      line: index + 1,
      section: stripTechnicalNoise(section),
      details: { originalTitle: originalTitle || section || id, sourceExcerpt: context }
    });
  }

  const rank = id => id.split(".").map(x => Number(x.replace(/^T/i, "")) || 0);
  const compare = (a, b) => {
    const aa = rank(a.id), bb = rank(b.id);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      const d = (aa[i] || 0) - (bb[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  const map = new Map();
  for (const item of items) {
    const previous = map.get(item.id);
    if (!previous || previous.source === "heading") map.set(item.id, item);
  }
  return [...map.values()].sort(compare);
}

function groupRoadmap(items) {
  const groups = new Map();
  for (const item of items) {
    const groupId = item.id.split(".")[0];
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, title: groupId, summaryTitle: `Tranche ${groupId.replace("T", "")}`, items: [], summary: { done: 0, current: 0, planned: 0, blocked: 0, total: 0 } });
    const group = groups.get(groupId);
    if (item.id === groupId) {
      group.title = item.title || groupId;
      group.summaryTitle = item.summary || group.summaryTitle;
    } else group.items.push(item);
  }
  for (const group of groups.values()) {
    for (const item of group.items) {
      group.summary[item.status] = (group.summary[item.status] || 0) + 1;
      group.summary.total += 1;
    }
    const total = group.summary.total || 1;
    group.progress = Math.round(((group.summary.done || 0) / total) * 100);
    group.status = group.summary.blocked ? "blocked" : group.summary.current ? "current" : group.summary.planned ? "planned" : "done";
    group.current = group.items.find(item => item.status === "current") || null;
  }
  return [...groups.values()];
}

class RoadmapManager {
  constructor(configStore) { this.configStore = configStore; }
  config() { return this.configStore.get(); }
  candidates() {
    const w = this.config().workspace;
    return [path.join(w, "docs", "ROADMAP.md"), path.join(w, "ROADMAP.md"), path.join(w, "docs", "MVP.md")];
  }
  snapshot() {
    const file = this.candidates().find(p => fs.existsSync(p));
    if (!file) return { available: false, file: null, items: [], groups: [], summary: { done: 0, current: 0, planned: 0, blocked: 0, total: 0 }, error: "Aucun ROADMAP.md n'a été trouvé dans le workspace MEN Pilot." };
    try {
      const markdown = fs.readFileSync(file, "utf8");
      const items = parseRoadmapMarkdown(markdown);
      const summary = { done: 0, current: 0, planned: 0, blocked: 0, total: items.length };
      for (const item of items) summary[item.status] = (summary[item.status] || 0) + 1;
      const current = items.find(x => x.status === "current") || items.find(x => x.status === "planned") || items.at(-1) || null;
      return { available: true, file, modifiedAt: fs.statSync(file).mtime.toISOString(), items, groups: groupRoadmap(items), current, summary };
    } catch (error) {
      return { available: false, file, items: [], groups: [], summary: { total: 0 }, error: error?.message || String(error) };
    }
  }
}

module.exports = { RoadmapManager, parseRoadmapMarkdown, groupRoadmap, frenchSummary, stripTechnicalNoise };
