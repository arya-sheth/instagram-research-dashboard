const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const artifactsDir = path.join(process.cwd(), 'artifacts');
const storageStatePath = path.join(artifactsDir, 'instagram-storage-state.json');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => {
    rl.close();
    resolve();
  }));
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  console.log('A browser window is opening for Instagram login.');
  console.log('Log in fully, then return here and press Enter to save the session.');
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle', timeout: 60000 });
  await waitForEnter('Press Enter after Instagram login is complete... ');
  await context.storageState({ path: storageStatePath });
  console.log(`Saved Instagram session to ${storageStatePath}`);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
