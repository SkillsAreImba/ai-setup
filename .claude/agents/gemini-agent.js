#!/usr/bin/env node

/**
 * Gemini Research Agent
 *
 * Usage: node .claude/agents/gemini-agent.js "your research query"
 *
 * Loads GEMINI.md instructions + constraints + context to keep Gemini on target.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const query = process.argv.slice(2).join(' ');

if (!query) {
  console.error('Usage: node .claude/agents/gemini-agent.js "your research query"');
  process.exit(1);
}

// Helper to load file if exists
function loadFile(relPath, fallback = '') {
  const fullPath = path.join(__dirname, '../../.gemini', relPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : fallback;
}

// Detect if we're in dndev project
function isDndevProject() {
  const cwd = process.cwd();
  return cwd.includes('dndev') || cwd.includes('donotdev');
}

// Load instructions (CRITICAL - makes Gemini less dumb)
const geminiInstructions = loadFile('GEMINI.md', '');
const constraints = loadFile('prompts/constraints.txt', '');

// Load context (general or dndev-specific)
const context = isDndevProject()
  ? loadFile('prompts/dndev-context.txt', loadFile('prompts/general-context.txt', ''))
  : loadFile('prompts/general-context.txt', '');

// Build prompt
const fullPrompt = `
${geminiInstructions}

${constraints}

${context}

---

**TASK:** ${query}

Remember:
- Max 500 words for research
- No fluff, no rambling
- Answer ONLY what was asked
- Read task 3x before responding
`.trim();

try {
  // Use gemini CLI with prompt file to avoid shell escaping issues
  const tmpFile = path.join('/tmp', `gemini-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, fullPrompt);

  const result = execSync(`gemini -f "${tmpFile}"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });

  // Cleanup
  fs.unlinkSync(tmpFile);

  console.log(result);
} catch (error) {
  console.error('Error running Gemini:', error.message);
  process.exit(1);
}
