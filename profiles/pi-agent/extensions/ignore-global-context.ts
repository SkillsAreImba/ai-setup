import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface ProjectSettings {
  ignoreGlobalContext?: boolean;
}

interface ContextFile {
  path: string;
  content: string;
}

interface SkillLike {
  filePath: string;
}

function normalizePath(path: string): string {
  return resolve(path);
}

function isUnder(path: string, parent: string): boolean {
  const child = normalizePath(path);
  const root = normalizePath(parent);
  return child === root || child.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function findGitRoot(cwd: string): string | undefined {
  let current = normalizePath(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findProjectSettingsPath(cwd: string): string {
  const repoRoot = findGitRoot(cwd);
  return join(repoRoot ?? cwd, ".pi", "settings.json");
}

function ignoreGlobalContextEnabled(cwd: string): boolean {
  const settingsPath = findProjectSettingsPath(cwd);
  if (!existsSync(settingsPath)) return false;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as ProjectSettings;
    return settings.ignoreGlobalContext === true;
  } catch {
    return false;
  }
}

function shouldDropPath(filePath: string, cwd: string): boolean {
  const repoRoot = findGitRoot(cwd);
  if (repoRoot) return !isUnder(filePath, repoRoot);
  return !isUnder(filePath, cwd);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeContextBlock(prompt: string, filePath: string, content: string): string {
  const block = `## ${filePath}\n\n${content}\n\n`;
  return prompt.replace(new RegExp(escapeRegExp(block), "g"), "");
}

function removeEmptyProjectContextSection(prompt: string): string {
  return prompt.replace(
    /\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n(?=(?:\n# |Current date:|Current working directory:|$))/g,
    "\n\n",
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function removeSkillBlock(prompt: string, filePath: string): string {
  const escapedLocation = escapeRegExp(escapeXml(filePath));
  return prompt.replace(
    new RegExp(
      `  <skill>\\n(?:    <[^>]+>.*</[^>]+>\\n)*    <location>${escapedLocation}</location>\\n(?:    <[^>]+>.*</[^>]+>\\n)*  </skill>\\n?`,
      "g",
    ),
    "",
  );
}

function removeEmptySkillsSection(prompt: string): string {
  return prompt.replace(
    /\n\nThe following skills provide specialized instructions for specific tasks\.\nUse the read tool to load a skill's file when the task matches its description\.\nWhen a skill file references a relative path, resolve it against the skill directory \(parent of SKILL\.md \/ dirname of the path\) and use that absolute path in tool commands\.\n\n<available_skills>\n<\/available_skills>/g,
    "",
  );
}

function removeGlobalPromptFileContents(prompt: string): string {
  let next = prompt;
  for (const filename of ["SYSTEM.md", "APPEND_SYSTEM.md"]) {
    const filePath = join(homedir(), ".pi", "agent", filename);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf-8");
      if (content.trim().length === 0) continue;
      next = next.replace(new RegExp(escapeRegExp(content), "g"), "");
    } catch {}
  }
  return next;
}

export default function ignoreGlobalContext(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const cwd = event.systemPromptOptions.cwd;
    if (!ignoreGlobalContextEnabled(cwd)) return;

    const contextFiles = (event.systemPromptOptions.contextFiles ?? []) as ContextFile[];
    const droppedContextFiles = contextFiles.filter((file) => shouldDropPath(file.path, cwd));
    const skills = (event.systemPromptOptions.skills ?? []) as SkillLike[];
    const droppedSkills = skills.filter((skill) => shouldDropPath(skill.filePath, cwd));

    let systemPrompt = removeGlobalPromptFileContents(event.systemPrompt);
    for (const file of droppedContextFiles) {
      systemPrompt = removeContextBlock(systemPrompt, file.path, file.content);
    }
    for (const skill of droppedSkills) {
      systemPrompt = removeSkillBlock(systemPrompt, skill.filePath);
    }

    if (systemPrompt === event.systemPrompt) return;
    return { systemPrompt: removeEmptySkillsSection(removeEmptyProjectContextSection(systemPrompt)) };
  });
}
