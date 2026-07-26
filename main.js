const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');

// Boot Express backend server inside Electron process
require('./server.js');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Focus Mode — On-Device Focus & Skill Accelerator',
    backgroundColor: '#0A0D14',
    icon: path.join(__dirname, 'public', 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load backend web dashboard
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
