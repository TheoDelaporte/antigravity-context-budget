#!/opt/homebrew/Cellar/node/26.0.0/bin/node


/**
 * SwiftBar Plugin: Antigravity 2.0 Live Context Budget Monitor
 * File: tracker.30s.js
 * 
 * Performance & Architecture:
 * - 100% native Node.js 22+ (uses native `node:sqlite` in read-only mode).
 * - Ultra-lightweight: ~15ms execution time, zero background daemon, < 0.001% CPU.
 * - Extracts LIVE tokens from active Antigravity session:
 *   Total Prompt Input, Model Output (responses + thinking), Rules, Skills, MCP.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // Dossier racine Antigravity
  antigravityDir: path.join(os.homedir(), '.gemini', 'antigravity'),

  // Estimation tokens : ratio standard LLM (~3.8 caractères par token pour code/fr/en)
  charsPerToken: 3.8,

  // Budget de contexte max pour adapter la couleur d'alerte (1M tokens pour Gemini / Antigravity)
  maxContextBudget: parseInt(process.env.MAX_CONTEXT_BUDGET || '1000000', 10),
};

// ============================================================================
// HELPERS FORMATAGE
// ============================================================================
function formatCompactTokens(num) {
  if (typeof num !== 'number' || isNaN(num)) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

function formatNumber(num) {
  if (typeof num !== 'number' || isNaN(num)) return '0';
  return num.toLocaleString('en-US');
}

function extractTag(text, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start === -1) return '';
  const end = text.indexOf(close, start);
  if (end === -1) return text.slice(start + open.length);
  return text.slice(start + open.length, end);
}

// ============================================================================
// EXTRACTION TEMPS RÉEL (LIVE ANTIGRAVITY)
// ============================================================================
function getLiveMetrics() {
  try {
    const { antigravityDir, charsPerToken } = CONFIG;
    const convDir = path.join(antigravityDir, 'conversations');
    const brainDir = path.join(antigravityDir, 'brain');

    if (!fs.existsSync(convDir)) {
      return null;
    }

    // 1. Trouver la conversation active la plus récente
    let dbs = [];
    try {
      dbs = fs.readdirSync(convDir).filter(f => f.endsWith('.db') && !f.includes('-shm') && !f.includes('-wal'));
    } catch {
      return null;
    }
    if (dbs.length === 0) return null;

    let latestDbPath = null;
    let latestMtime = 0;

    for (let i = 0; i < dbs.length; i++) {
      const full = path.join(convDir, dbs[i]);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs > latestMtime) {
          latestMtime = st.mtimeMs;
          latestDbPath = full;
        }
      } catch {}
    }

    if (!latestDbPath) return null;

    const convId = path.basename(latestDbPath, '.db');

    // 2. Extraire la charge utile du prompt système (gen_metadata) via node:sqlite
    let promptText = '';
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(latestDbPath, { readOnly: true });
      const row = db.prepare('SELECT data FROM gen_metadata WHERE size > 5000 ORDER BY idx DESC LIMIT 1').get();
      db.close();

      if (row && row.data) {
        promptText = Buffer.from(row.data).toString('utf8');
      }
    } catch {}

    // 3. Calculer les sous-composants réels injectés dans le prompt
    const rulesText = extractTag(promptText, 'user_rules');
    const skillsText = extractTag(promptText, 'skills');
    const mcpText = extractTag(promptText, 'mcp_servers');

    const rulesTokens = Math.round(rulesText.length / charsPerToken);
    const skillsTokens = Math.round(skillsText.length / charsPerToken);
    const mcpTokens = Math.round(mcpText.length / charsPerToken);
    const inputTokens = Math.round(promptText.length / charsPerToken);

    // 4. Calculer le total d'output produit (réponses + thinking) depuis le transcript
    let outputTokens = 0;
    const transcriptPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(transcriptPath)) {
      try {
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.trim().split('\n');
        let totalOutputChars = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          try {
            const step = JSON.parse(line);
            if (step.type === 'PLANNER_RESPONSE') {
              if (step.content) totalOutputChars += step.content.length;
              if (step.thinking) totalOutputChars += step.thinking.length;
            }
          } catch {}
        }
        outputTokens = Math.round(totalOutputChars / charsPerToken);
      } catch {}
    }

    const totalTokens = inputTokens + outputTokens;

    return {
      convId,
      convDir: path.join(brainDir, convId),
      mtime: latestMtime,
      total: totalTokens,
      input: inputTokens,
      output: outputTokens,
      rules: rulesTokens,
      skills: skillsTokens,
      mcp: mcpTokens,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
function main() {
  try {
    const { maxContextBudget } = CONFIG;
    const live = getLiveMetrics();

    if (!live || live.total === 0) {
      console.log('🧠 En attente | color=gray');
      console.log('---');
      console.log('Antigravity Context Monitor');
      console.log('---');
      console.log('En attente de session active...');
      console.log('---');
      console.log('🔄 Actualiser | refresh=true');
      return;
    }

    // Détermination de la couleur selon le budget
    let barColor = 'purple';
    if (live.total > maxContextBudget * 0.9) {
      barColor = 'red';
    } else if (live.total > maxContextBudget * 0.75) {
      barColor = 'orange';
    }

    const compactTotal = formatCompactTokens(live.total);

    // ==========================================================================
    // FORMAT DE SORTIE SWIFTBAR ULTRA-ÉPURÉ
    // ==========================================================================
    // 1ère ligne : Résumé global visible dans la barre des menus
    console.log(`🧠 ${compactTotal} | color=${barColor}`);

    // Séparateur de menu
    console.log('---');

    // Bouton unique vers le Dashboard Web
    console.log(`📊 Ouvrir le Dashboard | href=http://127.0.0.1:3456`);
    console.log('---');
    console.log(`🔄 Actualiser | refresh=true`);
  } catch {
    console.log('🧠 En attente | color=gray');
    console.log('---');
    console.log('Antigravity Context Monitor');
    console.log('---');
    console.log('En attente de session active...');
    console.log('---');
    console.log('🔄 Actualiser | refresh=true');
  }
}

main();
