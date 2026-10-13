// Trouve un Chrome/Chromium. Le Chrome "système" (Google Chrome) est préféré :
// il embarque l'encodeur H.264 WebCodecs, ce qui permet d'encoder directement dans le navigateur.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function globChromium(root) {
  const out = [];
  try {
    for (const d of fs.readdirSync(root)) {
      if (!/^chromium-\d+/.test(d)) continue;
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = path.join(root, d, sub);
        if (fs.existsSync(p)) out.push(p);
      }
    }
  } catch {}
  return out.sort().reverse();
}

export function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), '.cache/ms-playwright'), path.join(os.homedir(), 'Library/Caches/ms-playwright')].filter(Boolean);
  for (const r of roots) {
    const found = globChromium(r);
    if (found.length) return found[0];
  }
  return null;
}

export const CHROME_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--enable-features=SharedArrayBuffer',
  '--font-render-hinting=none',
];
