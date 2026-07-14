const { app, BrowserWindow, protocol, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readReviews() {
  ensureDataDir();
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      const raw = fs.readFileSync(REVIEWS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch { }
  return [];
}

function writeReviews(reviews) {
  ensureDataDir();
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf-8');
}

ipcMain.handle('reviews:get', () => readReviews());
ipcMain.handle('reviews:save', (_e, review) => {
  const reviews = readReviews();
  const idx = reviews.findIndex(r => r.id === review.id);
  if (idx >= 0) reviews[idx] = review; else reviews.push(review);
  writeReviews(reviews);
  return reviews;
});
ipcMain.handle('reviews:delete', (_e, id) => {
  let reviews = readReviews();
  reviews = reviews.filter(r => r.id !== id);
  writeReviews(reviews);
  return reviews;
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    minWidth: 360,
    minHeight: 500,
    title: 'Nossas Noites Temáticas',
    icon: path.join(__dirname, 'assets', 'icons', 'icon-192.png'),
    backgroundColor: '#fdf6f0',
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
