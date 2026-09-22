#!/usr/bin/env node

/**
 * LaunchAgent Manager for Antigravity Context Budget
 * File: scripts/daemon-manager.js
 * 
 * Controls the macOS launchd agent lifecycle:
 * - status: shows real-time status of Antigravity, Server, SwiftBar, and LaunchAgent
 * - install: generates plist, installs to ~/Library/LaunchAgents, and loads service
 * - uninstall: unloads service and removes plist
 * - restart: unloads and reloads service
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DAEMON_SCRIPT = path.join(PROJECT_ROOT, 'src', 'daemon.js');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const SERVICE_NAME = 'com.antigravity.context-budget';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_NAME}.plist`);

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function generatePlistContent() {
  const nodeBinary = process.execPath;
  const stdoutLog = path.join(LOGS_DIR, 'daemon.log');
  const stderrLog = path.join(LOGS_DIR, 'daemon.error.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBinary}</string>
        <string>${DAEMON_SCRIPT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${stdoutLog}</string>
    <key>StandardErrorPath</key>
    <string>${stderrLog}</string>
</dict>
</plist>
`;
}

function isProcessRunning(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getLaunchAgentStatus() {
  const plistExists = fs.existsSync(PLIST_PATH);
  let isLoaded = false;
  let pid = null;

  try {
    const output = execSync(`launchctl list | grep "${SERVICE_NAME}"`, { encoding: 'utf8' }).trim();
    if (output) {
      isLoaded = true;
      const parts = output.split(/\s+/);
      if (parts[0] !== '-') {
        pid = parts[0];
      }
    }
  } catch {}

  // Fallback si launchctl query est restreint par l'environnement
  if (!isLoaded && plistExists) {
    try {
      const daemonPid = execFileSync('pgrep', ['-f', 'node.*src/daemon\\.js'], { encoding: 'utf8' }).trim().split('\n')[0];
      if (daemonPid) {
        isLoaded = true;
        pid = daemonPid;
      }
    } catch {}
  }

  return { plistExists, isLoaded, pid };
}

function cmdStatus() {
  const agent = getLaunchAgentStatus();
  const antigravityRunning = isProcessRunning('pgrep', ['-f', '/Applications/Antigravity']);
  const serverRunning = isProcessRunning('pgrep', ['-f', 'node.*antigravity-context-budget/server\.js']);
  const swiftbarRunning = isProcessRunning('pgrep', ['-f', '/Applications/SwiftBar.app']);

  console.log('\n======================================================');
  console.log(' 🧠 ANTIGRAVITY CONTEXT BUDGET - STATUS DU CYCLE DE VIE');
  console.log('======================================================');

  console.log('\n[1] Applications & Services :');
  console.log(`  • Antigravity (App / IDE) : ${antigravityRunning ? '🟢 EN COURS D\'EXÉCUTION' : '⚪ ARRÊTÉ'}`);
  console.log(`  • Serveur Dashboard (:3456) : ${serverRunning ? '🟢 EN LIGNE (http://127.0.0.1:3456)' : '⚪ ARRÊTÉ'}`);
  console.log(`  • SwiftBar (Menu Bar)       : ${swiftbarRunning ? '🟢 ACTIF' : '⚪ FERMÉ'}`);

  console.log('\n[2] Démon Automatique macOS (LaunchAgent) :');
  console.log(`  • Fichier plist installé    : ${agent.plistExists ? `🟢 OUI (${PLIST_PATH})` : '⚪ NON'}`);
  console.log(`  • Statut launchctl          : ${agent.isLoaded ? `🟢 CHARGÉ (PID: ${agent.pid || 'veille'})` : '⚪ NON CHARGÉ'}`);

  console.log('\n[3] Résumé du comportement :');
  if (agent.isLoaded) {
    console.log('  ✨ Automatisation ACTIVE : Dès qu\'Antigravity démarre, SwiftBar');
    console.log('     et le serveur démarrent seuls. À la fermeture d\'Antigravity,');
    console.log('     ils se coupent automatiquement.');
  } else {
    console.log('  ⚠️  Le LaunchAgent n\'est pas actif.');
    console.log('     Pour activer l\'automatisation au démarrage :');
    console.log('     npm run daemon:install');
  }
  console.log('======================================================\n');
}

function cmdInstall() {
  ensureLogsDir();

  const launchAgentsDir = path.dirname(PLIST_PATH);
  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  // Si déjà chargé, décharger d'abord
  try {
    execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  } catch {}

  // Écrire le fichier plist
  const plistContent = generatePlistContent();
  fs.writeFileSync(PLIST_PATH, plistContent, 'utf8');
  console.log(`✅ Fichier LaunchAgent écrit dans : ${PLIST_PATH}`);

  // Charger dans launchctl
  try {
    execFileSync('launchctl', ['load', PLIST_PATH], { stdio: 'inherit' });
    console.log(`🚀 Démon ${SERVICE_NAME} chargé avec succès dans launchctl.`);
    console.log('   Le service démarrera automatiquement à chaque ouverture de session.');
  } catch (err) {
    console.error('❌ Erreur lors du chargement de launchctl :', err.message);
    process.exit(1);
  }

  // Vérification
  setTimeout(cmdStatus, 1000);
}

function cmdUninstall() {
  let unloaded = false;

  if (fs.existsSync(PLIST_PATH)) {
    try {
      execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'inherit' });
      unloaded = true;
      console.log(`🛑 Démon ${SERVICE_NAME} déchargé de launchctl.`);
    } catch (err) {
      console.warn('Notice: Impossible de décharger via launchctl (service peut-être non chargé)');
    }

    try {
      fs.unlinkSync(PLIST_PATH);
      console.log(`🗑️  Fichier ${PLIST_PATH} supprimé.`);
    } catch (err) {
      console.error(`❌ Erreur suppression plist : ${err.message}`);
    }
  } else {
    console.log('ℹ️  Aucun fichier LaunchAgent trouvé.');
  }

  // Tuer le processus démon orphelin s'il tourne
  try {
    execFileSync('pkill', ['-f', 'node.*antigravity-context-budget/src/daemon\.js'], { stdio: 'ignore' });
  } catch {}

  console.log('✅ Désinstallation terminée avec succès.');
}

function cmdRestart() {
  console.log('🔄 Redémarrage du LaunchAgent...');
  cmdUninstall();
  cmdInstall();
}

// Routeur de commandes CLI
const action = process.argv[2] || 'status';

switch (action) {
  case 'status':
    cmdStatus();
    break;
  case 'install':
    cmdInstall();
    break;
  case 'uninstall':
    cmdUninstall();
    break;
  case 'restart':
    cmdRestart();
    break;
  default:
    console.log(`Usage: node scripts/daemon-manager.js [status|install|uninstall|restart]`);
    process.exit(1);
}
