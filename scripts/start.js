// Launches Electron with a clean environment. Some hosts (VS Code extensions,
// other Electron apps) export ELECTRON_RUN_AS_NODE, which would make Electron
// behave like plain Node and crash on startup.
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  windowsHide: false,
});
child.on('exit', code => process.exit(code ?? 0));
