// Starts the app in development. Linux needs --no-sandbox when Electron's setuid sandbox helper is not configured
// (the usual case for npm-installed Electron); Windows and macOS keep the sandbox enabled.
const { spawn } = require('child_process');
const electron = require('electron');

const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...process.argv.slice(2)];
const child = spawn(electron, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
