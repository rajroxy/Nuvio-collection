// Nuvio Collections — Electron main process.
//
// Boots the same gallery + catalog server the preview uses (imported from
// ../serve.mjs), then opens a window on the shared web UI. Because the UI is
// plain web code, the identical folder can be wrapped by Capacitor for an
// Android TV build later — see README.md.
//
// Requires Electron >= 28 (ESM entry point). Run with:  npm start
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../serve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let server;
let mainWindow;

async function createWindow() {
  // Port 0 → the OS picks a free port, so the app never collides with the
  // preview server or another instance.
  server = await startServer({ port: 0, host: "127.0.0.1" });
  const { port } = server.address();
  const api = `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#08090C",
    title: "Nuvio Collections",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "ui", "index.html"), { query: { api } });

  // Any external link opens in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});
