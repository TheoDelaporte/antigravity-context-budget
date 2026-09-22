/**
 * Antigravity 2.0 Context Budget Analyzer
 * File: src/analyzer.js
 * 
 * Deep profiler extracting exact token distributions across:
 * - Custom rules (<user_rules>)
 * - Active skills (<skills>)
 * - MCP Servers & tool schemas (<mcp_servers> + disk schemas)
 * - System framework (<identity>, <terminal_sandbox>, <planning_mode>, etc.)
 * - Conversation turns & progression (transcript.jsonl)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const CONFIG = {
  antigravityDir: path.join(os.homedir(), '.gemini', 'antigravity'),
  charsPerToken: 3.8,
  maxContextBudget: parseInt(process.env.MAX_CONTEXT_BUDGET || '1000000', 10),
};

function extractTag(text, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start === -1) return '';
  const end = text.indexOf(close, start);
  if (end === -1) return text.slice(start + open.length);
  return text.slice(start + open.length, end);
}

function getLatestConversation(convDir) {
  if (!fs.existsSync(convDir)) return null;

  const files = fs.readdirSync(convDir).filter(f => f.endsWith('.db') && !f.includes('-shm') && !f.includes('-wal'));
  if (files.length === 0) return null;

  let latestPath = null;
  let latestMtime = 0;

  for (const file of files) {
    const fullPath = path.join(convDir, file);
    try {
      const st = fs.statSync(fullPath);
      if (st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latestPath = fullPath;
      }
    } catch {}
  }

  return {
    path: latestPath,
    convId: latestPath ? path.basename(latestPath, '.db') : null,
    mtime: latestMtime,
  };
}

function parseRules(rulesText, charsPerToken) {
  const ruleRegex = /<RULE\[(.*?)\]>([\s\S]*?)<\/RULE\[\1\]>/g;
  const list = [];
  let m;

  while ((m = ruleRegex.exec(rulesText)) !== null) {
    const rawContent = m[2].trim();
    const chars = rawContent.length;
    list.push({
      name: m[1],
      chars,
      tokens: Math.round(chars / charsPerToken),
      preview: rawContent.slice(0, 300) + (rawContent.length > 300 ? '...' : ''),
      fullContent: rawContent,
    });
  }

  if (list.length === 0 && rulesText.trim().length > 0) {
    const chars = rulesText.trim().length;
    list.push({
      name: 'general_rules',
      chars,
      tokens: Math.round(chars / charsPerToken),
      preview: rulesText.trim().slice(0, 300) + '...',
      fullContent: rulesText.trim(),
    });
  }

  const totalTokens = list.reduce((acc, r) => acc + r.tokens, 0);
  list.forEach(r => {
    r.percentage = totalTokens > 0 ? ((r.tokens / totalTokens) * 100).toFixed(1) : '0.0';
  });

  return {
    totalTokens,
    totalChars: list.reduce((acc, r) => acc + r.chars, 0),
    items: list.sort((a, b) => b.tokens - a.tokens),
  };
}

function parseSkills(skillsText, charsPerToken) {
  const lines = skillsText.split('\n');
  const items = [];

  let inAvailable = false;
  for (const line of lines) {
    if (line.includes('Available skills:')) {
      inAvailable = true;
      continue;
    }

    if (inAvailable && line.trim().startsWith('- ')) {
      const match = line.trim().match(/^- ([a-zA-Z0-9_-]+) \((.*?)\):\s*(.*)$/);
      if (match) {
        const name = match[1];
        const filePath = match[2];
        const desc = match[3];
        const inPromptChars = line.trim().length;
        const inPromptTokens = Math.round(inPromptChars / charsPerToken);

        let fileSizeBytes = 0;
        let fileTokens = 0;
        let fileExists = false;

        try {
          if (fs.existsSync(filePath)) {
            fileExists = true;
            fileSizeBytes = fs.statSync(filePath).size;
            fileTokens = Math.round(fileSizeBytes / charsPerToken);
          }
        } catch {}

        items.push({
          name,
          filePath,
          desc,
          inPromptChars,
          inPromptTokens,
          fileExists,
          fileSizeBytes,
          fileTokens,
        });
      }
    }
  }

  const totalInPromptTokens = items.reduce((acc, s) => acc + s.inPromptTokens, 0);
  const totalFileTokens = items.reduce((acc, s) => acc + s.fileTokens, 0);

  return {
    count: items.length,
    totalInPromptTokens,
    totalFileTokens,
    items: items.sort((a, b) => b.inPromptTokens - a.inPromptTokens),
  };
}

function parseMcp(mcpText, mcpDiskDir, charsPerToken) {
  const sections = mcpText.split('# ').filter(Boolean);
  const servers = [];

  for (const sec of sections) {
    const lines = sec.trim().split('\n');
    const serverName = lines[0].trim();
    if (!serverName || serverName.includes('Each MCP server')) continue;

    const lazyTools = [];
    const eagerTools = [];
    let currentMode = 'lazy';

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l === 'Lazy:') {
        currentMode = 'lazy';
        continue;
      }
      if (l === 'Eager:') {
        currentMode = 'eager';
        continue;
      }
      if (l.length > 0) {
        if (currentMode === 'eager') eagerTools.push(l);
        else lazyTools.push(l);
      }
    }

    const inPromptTokens = Math.round(sec.length / charsPerToken);

    // Explorer les fichiers de schémas réels sur le disque
    let diskTools = [];
    let diskTotalBytes = 0;
    const serverDiskPath = path.join(mcpDiskDir, serverName);

    if (fs.existsSync(serverDiskPath)) {
      try {
        const toolFiles = fs.readdirSync(serverDiskPath);
        for (const tf of toolFiles) {
          const tfPath = path.join(serverDiskPath, tf);
          try {
            const st = fs.statSync(tfPath);
            if (st.isFile()) {
              diskTotalBytes += st.size;
              let toolInfo = {
                file: tf,
                name: path.basename(tf, path.extname(tf)),
                size: st.size,
                tokens: Math.round(st.size / charsPerToken),
              };
              if (tf.endsWith('.json')) {
                try {
                  const schema = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
                  toolInfo.description = schema.description || '';
                  toolInfo.requiredCount = schema.parameters?.required?.length || 0;
                  toolInfo.propertyCount = Object.keys(schema.parameters?.properties || {}).length;
                } catch {}
              }
              diskTools.push(toolInfo);
            }
          } catch {}
        }
      } catch {}
    }

    servers.push({
      name: serverName,
      inPromptTokens,
      eagerCount: eagerTools.length,
      lazyCount: lazyTools.length,
      totalTools: eagerTools.length + lazyTools.length,
      eagerTools,
      lazyTools,
      diskToolCount: diskTools.length,
      diskTotalBytes,
      diskTotalTokens: Math.round(diskTotalBytes / charsPerToken),
      tools: diskTools.sort((a, b) => b.tokens - a.tokens),
    });
  }

  const totalInPromptTokens = servers.reduce((acc, s) => acc + s.inPromptTokens, 0);
  const totalDiskSchemaTokens = servers.reduce((acc, s) => acc + s.diskTotalTokens, 0);

  return {
    serverCount: servers.length,
    totalInPromptTokens,
    totalDiskSchemaTokens,
    servers: servers.sort((a, b) => b.diskTotalTokens - a.diskTotalTokens),
  };
}

function parseSystemFramework(promptText, charsPerToken) {
  const tags = [
    { tag: 'identity', label: 'Agent Identity & Persona' },
    { tag: 'user_information', label: 'User & Workspace Paths' },
    { tag: 'subagents', label: 'Subagents Protocol' },
    { tag: 'messaging', label: 'Reactive Messaging System' },
    { tag: 'conversation_transcript', label: 'Transcript Format Specs' },
    { tag: 'artifacts', label: 'Artifacts System & Rules' },
    { tag: 'slash_commands', label: 'Slash Commands Catalog' },
    { tag: 'terminal_sandbox', label: 'Terminal Sandbox Policies' },
    { tag: 'planning_mode', label: 'Planning Mode Guidelines' },
    { tag: 'planning_mode_artifacts', label: 'Plan & Walkthrough Templates' },
    { tag: 'guidelines', label: 'Behavioral Guidelines' },
    { tag: 'communication_style', label: 'Communication Style' },
  ];

  const components = [];
  for (const item of tags) {
    const content = extractTag(promptText, item.tag);
    if (content) {
      components.push({
        tag: item.tag,
        label: item.label,
        chars: content.length,
        tokens: Math.round(content.length / charsPerToken),
      });
    }
  }

  const totalTokens = components.reduce((acc, c) => acc + c.tokens, 0);
  return {
    totalTokens,
    components: components.sort((a, b) => b.tokens - a.tokens),
  };
}

function parseConversationHistory(brainDir, convId, charsPerToken) {
  const transcriptPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(transcriptPath)) {
    return { stepsCount: 0, totalOutputTokens: 0, thinkingTokens: 0, contentTokens: 0, turns: [] };
  }

  const turns = [];
  let totalThinkingChars = 0;
  let totalContentChars = 0;
  let cumulativeTokens = 0;

  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.trim().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      try {
        const step = JSON.parse(line);
        const isModel = step.type === 'PLANNER_RESPONSE';
        const thinkingChars = (step.thinking || '').length;
        const contentChars = (step.content || '').length;
        const toolCallsCount = (step.tool_calls || []).length;

        if (isModel) {
          totalThinkingChars += thinkingChars;
          totalContentChars += contentChars;
        }

        const stepTokens = Math.round((thinkingChars + contentChars) / charsPerToken);
        cumulativeTokens += stepTokens;

        turns.push({
          index: step.step_index ?? i,
          type: step.type,
          source: step.source,
          status: step.status,
          createdAt: step.created_at,
          toolCallsCount,
          thinkingTokens: Math.round(thinkingChars / charsPerToken),
          contentTokens: Math.round(contentChars / charsPerToken),
          stepTokens,
          cumulativeTokens,
        });
      } catch {}
    }
  } catch {}

  const thinkingTokens = Math.round(totalThinkingChars / charsPerToken);
  const contentTokens = Math.round(totalContentChars / charsPerToken);
  const totalOutputTokens = thinkingTokens + contentTokens;

  return {
    stepsCount: turns.length,
    totalOutputTokens,
    thinkingTokens,
    contentTokens,
    turns: turns.slice(-40), // 40 derniers tours pour affichage clair
  };
}

/**
 * Fonction d'extraction principale
 */
function getDetailedMetrics() {
  const { antigravityDir, charsPerToken, maxContextBudget } = CONFIG;
  const convDir = path.join(antigravityDir, 'conversations');
  const brainDir = path.join(antigravityDir, 'brain');
  const mcpDiskDir = path.join(antigravityDir, 'mcp');

  const latestConv = getLatestConversation(convDir);
  if (!latestConv || !latestConv.path) {
    return null;
  }

  let promptText = '';
  try {
    const db = new DatabaseSync(latestConv.path, { readOnly: true });
    const row = db.prepare('SELECT data FROM gen_metadata WHERE size > 5000 ORDER BY idx DESC LIMIT 1').get();
    db.close();
    if (row && row.data) {
      promptText = Buffer.from(row.data).toString('utf8');
    }
  } catch {}

  const rulesText = extractTag(promptText, 'user_rules');
  const skillsText = extractTag(promptText, 'skills');
  const mcpText = extractTag(promptText, 'mcp_servers');

  const rules = parseRules(rulesText, charsPerToken);
  const skills = parseSkills(skillsText, charsPerToken);
  const mcp = parseMcp(mcpText, mcpDiskDir, charsPerToken);
  const framework = parseSystemFramework(promptText, charsPerToken);
  const history = parseConversationHistory(brainDir, latestConv.convId, charsPerToken);

  const totalInputTokens = Math.round(promptText.length / charsPerToken);
  const totalOutputTokens = history.totalOutputTokens;
  const totalTokens = totalInputTokens + totalOutputTokens;

  // Calcul du budget et statut
  const usagePercentage = ((totalTokens / maxContextBudget) * 100).toFixed(1);
  let statusColor = 'green';
  let statusLabel = 'Optimal';
  if (totalTokens > maxContextBudget * 0.9) {
    statusColor = 'red';
    statusLabel = 'Critique (>90%)';
  } else if (totalTokens > maxContextBudget * 0.75) {
    statusColor = 'orange';
    statusLabel = 'Attention (>75%)';
  } else if (totalTokens > maxContextBudget * 0.5) {
    statusColor = 'purple';
    statusLabel = 'Modéré (>50%)';
  }

  // Recommandations d'optimisation
  const recommendations = [];
  if (mcp.totalDiskSchemaTokens > 30000) {
    recommendations.push({
      severity: 'medium',
      title: 'Inventaire MCP volumineux',
      message: `${mcp.serverCount} serveurs MCP disponibles totalisant ~${mcp.totalDiskSchemaTokens.toLocaleString()} tokens de schémas. Assurez-vous que les outils non essentiels restent déclarés en mode lazy.`,
    });
  }
  if (skills.count > 12) {
    recommendations.push({
      severity: 'info',
      title: 'Nombre élevé de compétences actives',
      message: `${skills.count} skills sont indexés dans le prompt (~${skills.totalInPromptTokens.toLocaleString()} tokens). Désactiver les plugins inutilisés permet d'alléger chaque tour.`,
    });
  }
  if (history.thinkingTokens > history.contentTokens * 2) {
    recommendations.push({
      severity: 'info',
      title: 'Forte proportion de Thinking',
      message: `Le modèle génère une quantité importante de raisonnement interne (${history.thinkingTokens.toLocaleString()} tokens thinking vs ${history.contentTokens.toLocaleString()} tokens texte).`,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    session: {
      id: latestConv.convId,
      path: latestConv.path,
      brainPath: path.join(brainDir, latestConv.convId),
      lastUpdated: new Date(latestConv.mtime).toISOString(),
    },
    budget: {
      max: maxContextBudget,
      current: totalTokens,
      input: totalInputTokens,
      output: totalOutputTokens,
      percentage: Number(usagePercentage),
      statusColor,
      statusLabel,
    },
    breakdown: {
      rules,
      skills,
      mcp,
      framework,
      history,
    },
    recommendations,
  };
}

module.exports = {
  getDetailedMetrics,
  CONFIG,
};
