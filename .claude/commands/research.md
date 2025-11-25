---
description: Research a topic using Gemini AI (saves Claude tokens)
---

CRITICAL: Delegate research to Gemini to save Claude tokens.

**Current research request:** {{prompt}}

1. Use Bash to invoke the Gemini agent:
   ```bash
   node .claude/agents/gemini-agent.js "{{prompt}}"
   ```

2. If gemini-agent.js not available, use gemini directly:
   ```bash
   gemini -p "Research and provide detailed technical information about: {{prompt}}"
   ```

3. Present findings clearly to Rodolphe

4. If findings reveal actionable insights, offer to implement

DO NOT use Claude's knowledge for research - always delegate to Gemini.
