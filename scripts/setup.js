#!/usr/bin/env node

/**
 * Antigravity Context Budget - Universal One-Command Setup
 * File: scripts/setup.js
 * 
 * Automatically configures:
 * 1. Node.js binary shebang in tracker.30s.js (Apple Silicon & Intel portable)
 * 2. SwiftBar plugins folder and symlink (~/Library/Application Support/SwiftBar/plugins)
 * 3. SwiftBar preferences to prevent repository directory scanning
 * 4. macOS LaunchAgent background service (auto start/stop with Antigravity)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TRACKER_SCRIPT = path.join(PROJECT_ROOT, 'tracker.30s.js');
const DAEMON_MANAGER = path.join(PROJECT_ROOT, 'scripts', 'daemon-manager.js');

const SWIFTBAR_PLUGINS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'SwiftBar', 'plugins');
const SWIFTBAR_SYMLINK = path.join(SWIFTBAR_PLUGINS_DIR, 'tracker.30s.js');

function log(msg) {
  console.log(`[Setup] ${msg}`);
}

function ensureShebang() {
  const nodeBinary = process.execPath;
  log(`Configuring tracker shebang for: ${nodeBinary}`);

  const content = fs.readFileSync(TRACKER_SCRIPT, 'utf8');
  const lines = content.split('\n');

  // Replace line 1 with exact Node path
  lines[0] = `#!${nodeBinary}`;
  fs.writeFileSync(TRACKER_SCRIPT, lines.join('\n'), 'utf8');
  fs.chmodSync(TRACKER_SCRIPT, 0o755);
  log('✅ tracker.30s.js is now executable with the current Node.js interpreter.');
}

function setupSwiftBar() {
  log('Setting up SwiftBar plugin integration...');

  if (!fs.existsSync(SWIFTBAR_PLUGINS_DIR)) {
    fs.mkdirSync(SWIFTBAR_PLUGINS_DIR, { recursive: true });
    log(`Created SwiftBar plugins directory: ${SWIFTBAR_PLUGINS_DIR}`);
  }

  // Remove existing file/link if present
  try {
    if (fs.existsSync(SWIFTBAR_SYMLINK) || fs.lstatSync(SWIFTBAR_SYMLINK)) {
      fs.unlinkSync(SWIFTBAR_SYMLINK);
    }
  } catch {}

  // Create clean symlink
  fs.symlinkSync(TRACKER_SCRIPT, SWIFTBAR_SYMLINK);
  log(`✅ Symlink created: ${SWIFTBAR_SYMLINK} -> ${TRACKER_SCRIPT}`);

  // Set SwiftBar preference to only read from the plugins folder
  try {
    execFileSync('defaults', ['write', 'com.ameba.SwiftBar', 'PluginDirectory', SWIFTBAR_PLUGINS_DIR], { stdio: 'ignore' });
    log('✅ SwiftBar plugin directory configured.');
  } catch {}

  // Refresh SwiftBar if running
  try {
    execFileSync('open', ['-g', 'swiftbar://refreshallplugins'], { stdio: 'ignore' });
  } catch {}
}

function installDaemon() {
  log('Installing macOS LaunchAgent service...');
  try {
    execFileSync(process.execPath, [DAEMON_MANAGER, 'install'], { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Failed to install LaunchAgent:', err.message);
  }
}

function uninstallAll() {
  log('🛑 Uninstalling Antigravity Context Budget...');

  // 1. Unload LaunchAgent
  try {
    execFileSync(process.execPath, [DAEMON_MANAGER, 'uninstall'], { stdio: 'inherit' });
  } catch {}

  // 2. Remove SwiftBar symlink
  try {
    if (fs.existsSync(SWIFTBAR_SYMLINK) || fs.lstatSync(SWIFTBAR_SYMLINK)) {
      fs.unlinkSync(SWIFTBAR_SYMLINK);
      log(`🗑️ Removed SwiftBar symlink: ${SWIFTBAR_SYMLINK}`);
    }
  } catch {}

  // 3. Refresh SwiftBar
  try {
    execFileSync('open', ['-g', 'swiftbar://refreshallplugins'], { stdio: 'ignore' });
  } catch {}

  log('✅ Everything has been completely uninstalled.');
}

const action = process.argv[2] || 'install';

if (action === 'uninstall') {
  uninstallAll();
} else {
  console.log('\n======================================================');
  console.log(' 🧠 ANTIGRAVITY CONTEXT BUDGET · ONE-CLICK SETUP');
  console.log('======================================================\n');
  ensureShebang();
  setupSwiftBar();
  installDaemon();
  console.log('\n✨ Setup completed! The monitor will automatically start');
  console.log('   whenever you launch Antigravity or Antigravity IDE.\n');
}
