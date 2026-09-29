const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');

const run = (label, command, args, cwd) => {
  const child = spawn(command, args, {
    cwd,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`\n${label} exited with code ${code}.`);
    }
  });

  return child;
};

const isBackendRunning = () => new Promise((resolve) => {
  const request = http.get('http://localhost:3000/api/health', (response) => {
    response.resume();
    resolve(response.statusCode === 200);
  });

  request.on('error', () => resolve(false));
  request.setTimeout(1000, () => {
    request.destroy();
    resolve(false);
  });
});

const start = async () => {
  console.log('Starting Chatify backend and frontend...');

  if (await isBackendRunning()) {
    console.log('Backend already running on http://localhost:3000. Skipping duplicate start.');
  } else {
    run('Backend', 'npm', ['run', 'dev'], backendDir);
  }

  run('Frontend', 'npm', ['run', 'dev'], frontendDir);
};

start();
