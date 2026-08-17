const path = require("path");

const DEFAULT_GITHUB_REPOSITORY = "AlmaniacFR/men-pilot-launcher";
const githubRepository =
  process.env.MEN_LAUNCHER_GITHUB_REPOSITORY ||
  process.env.GITHUB_REPOSITORY ||
  DEFAULT_GITHUB_REPOSITORY;

const updateUrl =
  process.env.MEN_LAUNCHER_UPDATE_URL ||
  "https://github.com/AlmaniacFR/men-pilot-launcher/releases/latest/download";

let publish;
if (githubRepository.includes("/")) {
  const [owner, repo] = githubRepository.split("/", 2);
  publish = [{ provider: "github", owner, repo, releaseType: "release" }];
} else {
  publish = [{ provider: "generic", url: updateUrl }];
}

module.exports = {
  appId: "fr.marseilleexpert.menpilot.launcher",
  productName: "MEN Pilot Launcher",
  artifactName: "MEN-Pilot-Launcher-${version}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "assets"
  },
  files: [
    "src/**/*",
    "config/**/*",
    "assets/**/*",
    "package.json"
  ],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "assets/men-pilot.ico"
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "MEN Pilot Launcher",
    deleteAppDataOnUninstall: false
  },
  publish
};
