const fs = require('fs');
const path = require('path');

const SRC_FILE = path.resolve(__dirname, 'index.html');
const OUT_FILE = path.resolve(__dirname, 'mobile/assets/frontend_bundle.js');
const LOGO_FILE = path.resolve(__dirname, 'mobile/assets/icon.png');

const LOADER_PLACEHOLDER_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

if (!fs.existsSync(SRC_FILE)) {
    throw new Error('Source file not found: ' + SRC_FILE);
}

let html = fs.readFileSync(SRC_FILE, 'utf8');

// Replace the tiny placeholder loader logo with the real app logo for the mobile bundle.
// (We keep the placeholder in index.html so it still works standalone in a browser.)
try {
    if (fs.existsSync(LOGO_FILE)) {
        const logoBase64 = fs.readFileSync(LOGO_FILE).toString('base64');
        const logoDataUri = `data:image/png;base64,${logoBase64}`;
        html = html.split(LOADER_PLACEHOLDER_DATA_URI).join(logoDataUri);
    }
} catch { }

// Export as a normal JS string literal to avoid breaking on backticks/template literals
// that exist inside the inlined vendor scripts.
const output = `export const htmlContent = ${JSON.stringify(html)};\n`;

// Ensure dir exists
const dir = path.dirname(OUT_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(OUT_FILE, output);
console.log('Bundle created at ' + OUT_FILE);
