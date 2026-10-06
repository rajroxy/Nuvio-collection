// Launches the Electron desktop app. This is what `npm start` runs, from the
// repo root (`node scripts/start-desktop.mjs`) or from `desktop/`
// (`node ../scripts/start-desktop.mjs`).
//
// Electron ships as a ~100MB binary that npm fetches in a postinstall step, so a
// fresh clone can hold the package without its binary and `electron .` then dies
// with "Electron failed to install correctly". This wrapper checks for the binary
// first, fetches it once if it is missing, and only then opens the window — so
// `npm start` always ends in the app, never in an error or a server url.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "desktop");
const CLI = join(DESKTOP, "node_modules", "electron", "cli.js");
// Written by Electron's own installer; its absence means the binary is missing.
const INSTALLED = join(DESKTOP, "node_modules", "electron", "path.txt");

const installOnly = process.argv.includes("--install-only");

if (!existsSync(INSTALLED)) {
  console.log(
    "Nuvio Collections — installing the desktop app's dependencies.\n" +
      "This downloads Electron (about 100MB) the first time only…",
  );
  const env = { ...process.env };
  // We are starting the real app, so we do need the binary here.
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: DESKTOP,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (install.status !== 0) {
    console.error(
      "\nThe install did not finish. Run it by hand to see the full output:\n" +
        "  cd desktop && npm install\n",
    );
    process.exit(install.status ?? 1);
  }
}

if (installOnly) {
  console.log("Desktop dependencies are installed — `npm start` opens the app.");
  process.exit(0);
}

if (!existsSync(CLI)) {
  console.error("Electron is missing after installing. Run `cd desktop && npm install`.");
  process.exit(1);
}

console.log("Nuvio Collections — opening the desktop window…");

// `node cli.js` instead of `.bin/electron`: identical on every platform and it
// does not rely on the launcher keeping its executable bit.
const app = spawnSync(process.execPath, [CLI, "."], { cwd: DESKTOP, stdio: "inherit" });
process.exit(app.status ?? 1);
