(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const actionLabels = {
    "start-docker": "Démarrer Docker Desktop",
    "start-postgres": "Démarrer PostgreSQL",
    "start-backend": "Démarrer le backend",
    "start-frontend": "Démarrer l’interface utilisateur",
    "restart-backend": "Redémarrer le backend",
    "restart-frontend": "Redémarrer l’interface utilisateur",
    "repair-environment": "Réparer l’environnement Java / Node / npm",
    "flyway-migrate": "Appliquer les migrations de base de données",
    "frontend-install": "Réinstaller les dépendances frontend",
    "backend-tests": "Lancer les vérifications du backend",
    "frontend-tests": "Lancer les vérifications du frontend",
    "git-pull": "Mettre à jour le dépôt Git local",
    "cleanup-storage": "Nettoyer les fichiers temporaires",
    "open-roadmap": "Ouvrir la roadmap"
  };

  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("men-pilot-theme", normalized);
    const button = $("#themeToggle");
    if (button) {
      button.innerHTML = normalized === "dark"
        ? '<span class="theme-icon">☀</span><span>Thème clair</span>'
        : '<span class="theme-icon">☾</span><span>Thème sombre</span>';
      button.setAttribute("aria-label", normalized === "dark" ? "Passer au thème clair" : "Passer au thème sombre");
    }
  }

  function installThemeToggle() {
    if ($("#themeToggle")) return;
    const topActions = $(".top-actions");
    const sidebarFooter = $(".sidebar-footer");
    const host = topActions || sidebarFooter;
    if (!host) return;
    const button = document.createElement("button");
    button.id = "themeToggle";
    button.type = "button";
    button.className = "btn secondary theme-toggle";
    button.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    host.insertBefore(button, host.firstChild);
    applyTheme(localStorage.getItem("men-pilot-theme") || "dark");
  }

  function humanResult(result) {
    if (!result) return ["L’action a été envoyée au launcher."];
    const lines = [];
    if (result.ok === true) lines.push("L’action s’est terminée correctement.");
    if (result.ok === false) lines.push(result.error ? `Échec : ${result.error}` : "L’action n’a pas pu être terminée.");
    if (result.skipped) lines.push("Aucune intervention supplémentaire n’était nécessaire.");
    if (result.alreadyRunning) lines.push("Le service était déjà démarré.");
    if (result.alreadyStopped) lines.push("Le service était déjà arrêté.");
    if (result.summary?.tests != null) {
      lines.push(`${result.summary.tests} vérification(s) exécutée(s), ${result.summary.passed ?? "?"} réussie(s).`);
    }
    if (result.durationMs != null) lines.push(`Durée : ${(Number(result.durationMs) / 1000).toFixed(1)} s.`);
    if (result.tools) {
      const detected = [];
      if (result.tools.java?.found) detected.push("Java détecté");
      if (result.tools.node?.found) detected.push("Node.js détecté");
      if (result.tools.npm?.found) detected.push("npm détecté");
      if (detected.length) lines.push(detected.join(" · "));
    }
    if (!lines.length) lines.push("L’action a été exécutée. Les données du Control Center vont être actualisées.");
    return lines;
  }

  async function executeAssistantAction(action) {
    switch (action) {
      case "start-docker":
      case "start-postgres":
      case "start-backend":
      case "start-frontend":
      case "restart-backend":
      case "restart-frontend":
      case "repair-environment":
      case "flyway-migrate":
      case "frontend-install":
      case "cleanup-storage":
        return window.men.healthRepair(action);
      case "backend-tests": return window.men.runTask("backendTests");
      case "frontend-tests": return window.men.runTask("frontendTests");
      case "git-pull": return window.men.gitPull();
      case "open-roadmap": {
        const nav = $('.nav-item[data-section="roadmap"]');
        if (nav) nav.click();
        return { ok: true, message: "Roadmap ouverte." };
      }
      default: return { ok: false, error: "Action non reconnue par le launcher." };
    }
  }

  function actionReportHost(finding) {
    let report = $(".assistant-action-report", finding);
    if (!report) {
      report = document.createElement("div");
      report.className = "assistant-action-report";
      finding.appendChild(report);
    }
    return report;
  }

  function renderReport(report, { title, state, lines }) {
    report.classList.add("open");
    report.innerHTML = `
      <div class="assistant-report-head">
        <div>
          <div class="assistant-report-kicker">ACTIONS EFFECTUÉES</div>
          <strong>${esc(title)}</strong>
        </div>
        <span class="assistant-report-state ${esc(state)}">${state === "running" ? "EN COURS" : state === "success" ? "TERMINÉ" : "ERREUR"}</span>
      </div>
      <ol class="assistant-report-steps">
        ${(lines || []).map((line) => `<li>${esc(line)}</li>`).join("")}
      </ol>
      <button type="button" class="assistant-report-collapse">Réduire</button>`;
    $(".assistant-report-collapse", report)?.addEventListener("click", () => report.classList.toggle("collapsed"));
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".assistant-action");
    if (!button) return;

    // L'ancien gestionnaire exécute lui aussi l'action. On l'intercepte pour éviter un double lancement.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const finding = button.closest(".assistant-finding") || button.parentElement;
    const action = button.dataset.assistantAction;
    const title = actionLabels[action] || "Action MEN Pilot";
    const report = actionReportHost(finding);

    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Exécution...";
    renderReport(report, {
      title,
      state: "running",
      lines: ["Action demandée par l’assistant.", "Exécution par MEN Pilot Launcher..."]
    });

    try {
      const result = await executeAssistantAction(action);
      renderReport(report, {
        title,
        state: result?.ok === false ? "error" : "success",
        lines: ["Action demandée par l’assistant.", ...humanResult(result)]
      });
    } catch (error) {
      renderReport(report, {
        title,
        state: "error",
        lines: ["Action demandée par l’assistant.", `Erreur : ${error?.message || String(error)}`]
      });
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }, true);

  function improveRoadmapAccessibility() {
    $$(".roadmap-card").forEach((card) => {
      if (!card.getAttribute("aria-label")) {
        const id = $(".roadmap-card-top span", card)?.textContent?.trim() || "Étape";
        const title = $(".roadmap-card-title", card)?.textContent?.trim() || "";
        card.setAttribute("aria-label", `${id} — ${title}. Ouvrir les détails techniques.`);
      }
    });
  }

  const observer = new MutationObserver(() => improveRoadmapAccessibility());

  function boot() {
    installThemeToggle();
    improveRoadmapAccessibility();
    const roadmap = $("#roadmapList");
    if (roadmap) observer.observe(roadmap, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
