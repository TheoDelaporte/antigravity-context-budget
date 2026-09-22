/**
 * Antigravity 2.0 Context Budget Lifecycle Daemon
 * File: src/daemon.js
 * 
 * Automatically synchronizes the lifecycle of:
 * - SwiftBar (macOS menu bar token monitor: tracker.30s.js)
 * - Server (local web dashboard: server.js on 127.0.0.1:3456)
 * 
 * Behavior:
 * - When Antigravity starts -> starts server.js and launches SwiftBar in background.
 * - When Antigravity stops -> terminates server.js and gracefully quits SwiftBar.
 * - Zero external npm dependencies. Native Node.js 22+.
 */

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Configuration
const CONFIG = {
  checkIntervalMs: 2500, // Vérification toutes les 2.5 secondes
  projectRoot: path.resolve(__dirname, '..'),
  serverScript: path.resolve(__dirname, '..', 'server.js'),
  serverPort: 3456,
  swiftBarAppName: 'SwiftBar',
};

// État interne du démon
let serverProcess = null;
let isAntigravityActive = false;
let isShuttingDown = false;

/**
 * Log formaté avec timestamp
 */
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [Daemon] ${msg}`);
}

/**
 * Log d'erreur
 */
function logError(msg, err) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.error(`[${ts}] [Daemon ERROR] ${msg}`, err ? err.message : '');
}

/**
 * Détecte si une instance d'Antigravity (App ou IDE) est active
 * Utilise pgrep en priorité (~2ms), avec fallback AppleScript
 */
function checkAntigravityRunning() {
  // Méthode 1 : pgrep sur les chemins d'application standards
  try {
    execFileSync('pgrep', ['-f', '/Applications/Antigravity'], { stdio: 'ignore' });
    return true;
  } catch {
    // pgrep a retourné un code non nul (aucun processus trouvé)
  }

  // Méthode 2 : AppleScript LaunchServices (fallback si chemin personnalisé)
  try {
    const stdout = execFileSync(
      'osascript',
      ['-e', 'application "Antigravity" is running or application "Antigravity IDE" is running'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Détecte si SwiftBar est actuellement en cours d'exécution
 */
function checkSwiftBarRunning() {
  try {
    execFileSync('pgrep', ['-f', '/Applications/SwiftBar.app'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tue tout processus server.js orphelin qui occuperait le port
 */
function killOrphanServers() {
  try {
    execFileSync('pkill', ['-f', 'node.*antigravity-context-budget/server\.js'], { stdio: 'ignore' });
  } catch {
    // Aucun processus orphelin trouvé, normal
  }
}

/**
 * Démarre le serveur Dashboard local (server.js)
 */
function startServer() {
  if (serverProcess && !serverProcess.killed) {
    return;
  }

  killOrphanServers();

  log(`Démarrage du serveur Dashboard sur le port ${CONFIG.serverPort}...`);
  serverProcess = spawn(process.execPath, [CONFIG.serverScript], {
    cwd: CONFIG.projectRoot,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(CONFIG.serverPort) },
  });

  serverProcess.on('exit', (code, signal) => {
    log(`Serveur arrêté (code: ${code}, signal: ${signal})`);
    serverProcess = null;
    // Si Antigravity est toujours actif et que ce n'est pas un arrêt prévu, relancer
    if (isAntigravityActive && !isShuttingDown) {
      log('Redémarrage automatique du serveur dans 2s...');
      setTimeout(() => {
        if (isAntigravityActive && !isShuttingDown) startServer();
      }, 2000);
    }
  });

  serverProcess.on('error', (err) => {
    logError('Erreur lors du spawn du serveur', err);
    serverProcess = null;
  });
}

/**
 * Arrête le serveur Dashboard local
 */
function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    log('Arrêt du serveur Dashboard...');
    try {
      serverProcess.kill('SIGTERM');
    } catch (err) {
      logError("Impossible d'envoyer SIGTERM au serveur", err);
    }
    serverProcess = null;
  }
  killOrphanServers();
}

/**
 * Lance l'application SwiftBar en arrière-plan (option -g pour préserver le focus)
 */
function launchSwiftBar() {
  if (checkSwiftBarRunning()) {
    return;
  }

  log('Lancement de SwiftBar en arrière-plan...');
  try {
    execFileSync('open', ['-g', '-a', CONFIG.swiftBarAppName], { stdio: 'ignore' });
  } catch (err) {
    logError('Impossible de lancer SwiftBar', err);
  }
}

/**
 * Ferme gracieusement l'application SwiftBar
 */
function quitSwiftBar() {
  if (!checkSwiftBarRunning()) {
    return;
  }

  log('Fermeture de SwiftBar...');
  try {
    execFileSync(
      'osascript',
      ['-e', `tell application "${CONFIG.swiftBarAppName}" to quit`],
      { stdio: 'ignore' }
    );
  } catch (err) {
    // Fallback avec killall si l'application ne répond pas
    try {
      execFileSync('killall', [CONFIG.swiftBarAppName], { stdio: 'ignore' });
    } catch {}
  }
}

/**
 * Transition d'état : Antigravity est devenu ACTIF
 */
function handleAntigravityStarted() {
  log('⚡ Antigravity détecté : DÉMARRAGE des services');
  startServer();
  launchSwiftBar();
}

/**
 * Transition d'état : Antigravity est devenu INACTIF
 */
function handleAntigravityStopped() {
  log('💤 Antigravity fermé : EXTINCTION des services');
  stopServer();
  quitSwiftBar();
}

/**
 * Cycle principal d'inspection
 */
function tick() {
  if (isShuttingDown) return;

  const runningNow = checkAntigravityRunning();

  if (runningNow && !isAntigravityActive) {
    // Antigravity vient de s'allumer
    isAntigravityActive = true;
    handleAntigravityStarted();
  } else if (!runningNow && isAntigravityActive) {
    // Antigravity vient de s'éteindre
    isAntigravityActive = false;
    handleAntigravityStopped();
  } else if (runningNow && isAntigravityActive) {
    // Antigravity toujours actif : s'assurer que SwiftBar et le serveur tournent bien
    if (!checkSwiftBarRunning()) {
      launchSwiftBar();
    }
    if (!serverProcess) {
      startServer();
    }
  }
}

/**
 * Arrêt propre du démon
 */
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log(`Signal ${signal} reçu, arrêt complet du démon...`);

  stopServer();
  // Ne pas forcer la fermeture de SwiftBar si Antigravity est encore actif lors d'un reload du démon
  if (!isAntigravityActive) {
    quitSwiftBar();
  }

  process.exit(0);
}

// Gestion des signaux système
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Démarrage
log('🟢 Démon de cycle de vie Antigravity Context Budget initialisé.');
log(`Vérification toutes les ${CONFIG.checkIntervalMs}ms.`);

// Première vérification immédiate
tick();

// Boucle périodique
setInterval(tick, CONFIG.checkIntervalMs);
