import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import { array, boolean, looseObject, number, optional, picklist, record, safeParse, string, union, unknown } from 'valibot'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type TransportType = 'stdio' | 'sse' | 'streamable-http' | 'websocket'
export type ToolPrefixMode = 'server' | 'short' | 'none'
export type ServerLifecycle = 'lazy' | 'eager' | 'keep-alive'
export type DirectToolsSetting = boolean | string[]

export interface FileConfig {
  servers?: Array<RawServerConfig | (RawServerConfig & { name: string })>
  mcpServers?: Record<string, RawServerConfig>
  settings?: {
    toolPrefix?: ToolPrefixMode
    directTools?: DirectToolsSetting
    disableProxyTool?: boolean
    idleTimeout?: number
    importClaudeDesktop?: boolean
  }
}

export interface RawServerConfig {
  name?: string
  enabled?: boolean
  autoReconnect?: boolean
  maxReconnectAttempts?: number
  reconnectDelayMs?: number
  connectTimeoutMs?: number
  directTools?: DirectToolsSetting
  excludeTools?: string[]
  allowedTools?: string[]
  deniedTools?: string[]
  toolPrefix?: ToolPrefixMode
  lifecycle?: ServerLifecycle
  description?: string
  transport?: TransportConfig
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  stderr?: 'inherit' | 'pipe' | 'overlapped' | 'ignore'
  host?: string
  user?: string
  port?: number
  identityFile?: string
  remoteCommand?: string
  remoteArgs?: string[]
  url?: string
  headers?: Record<string, string>
  sessionId?: string
  bearerToken?: string
  bearerTokenEnv?: string
}

export interface TransportConfig {
  type: TransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  stderr?: 'inherit' | 'pipe' | 'overlapped' | 'ignore'
  host?: string
  user?: string
  port?: number
  identityFile?: string
  remoteCommand?: string
  remoteArgs?: string[]
  url?: string
  headers?: Record<string, string>
  sessionId?: string
  bearerToken?: string
  bearerTokenEnv?: string
}

export interface ToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface ResourceInfo {
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface PromptInfo {
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
  _meta?: Record<string, unknown>
}

export interface NormalizedServerConfig {
  name: string
  enabled: boolean
  autoReconnect: boolean
  maxReconnectAttempts: number
  reconnectDelayMs: number
  connectTimeoutMs: number
  directTools: DirectToolsSetting | undefined
  excludeTools: string[]
  allowedTools: string[]
  deniedTools: string[]
  toolPrefix: ToolPrefixMode
  lifecycle: ServerLifecycle
  description?: string
  transport: TransportConfig
  source: string
}

export interface LoadedConfig {
  settings: {
    toolPrefix: ToolPrefixMode
    directTools: DirectToolsSetting
    disableProxyTool: boolean
    idleTimeout: number
    importClaudeDesktop: boolean
  }
  servers: NormalizedServerConfig[]
}

export interface ProxyInput {
  action:
    | 'status'
    | 'list_servers'
    | 'list_tools'
    | 'search_tools'
    | 'call_tool'
    | 'list_resources'
    | 'read_resource'
    | 'list_prompts'
    | 'get_prompt'
    | 'connect'
    | 'disconnect'
    | 'refresh'
  server?: string
  tool?: string
  resource?: string
  prompt?: string
  query?: string
  arguments?: Record<string, unknown>
}

export const TransportSchema = looseObject({
  type: picklist(['stdio', 'ssh', 'sse', 'streamable-http', 'websocket']),
  command: optional(string()),
  args: optional(array(string())),
  env: optional(record(string(), string())),
  cwd: optional(string()),
  stderr: optional(picklist(['inherit', 'pipe', 'overlapped', 'ignore'])),
  host: optional(string()),
  user: optional(string()),
  port: optional(number()),
  identityFile: optional(string()),
  remoteCommand: optional(string()),
  remoteArgs: optional(array(string())),
  url: optional(string()),
  headers: optional(record(string(), string())),
  sessionId: optional(string()),
  bearerToken: optional(string()),
  bearerTokenEnv: optional(string()),
})

export const RawServerSchema = looseObject({
  name: optional(string()),
  enabled: optional(boolean()),
  autoReconnect: optional(boolean()),
  maxReconnectAttempts: optional(number()),
  reconnectDelayMs: optional(number()),
  connectTimeoutMs: optional(number()),
  directTools: optional(union([boolean(), array(string())])),
  excludeTools: optional(array(string())),
  allowedTools: optional(array(string())),
  deniedTools: optional(array(string())),
  toolPrefix: optional(picklist(['server', 'short', 'none'])),
  lifecycle: optional(picklist(['lazy', 'eager', 'keep-alive'])),
  description: optional(string()),
  transport: optional(TransportSchema),
  command: optional(string()),
  args: optional(array(string())),
  env: optional(record(string(), string())),
  cwd: optional(string()),
  stderr: optional(picklist(['inherit', 'pipe', 'overlapped', 'ignore'])),
  url: optional(string()),
  headers: optional(record(string(), string())),
  sessionId: optional(string()),
  bearerToken: optional(string()),
  bearerTokenEnv: optional(string()),
})

export const FileConfigSchema = looseObject({
  servers: optional(array(RawServerSchema)),
  mcpServers: optional(record(string(), RawServerSchema)),
  settings: optional(looseObject({
    toolPrefix: optional(picklist(['server', 'short', 'none'])),
    directTools: optional(union([boolean(), array(string())])),
    disableProxyTool: optional(boolean()),
    idleTimeout: optional(number()),
    importClaudeDesktop: optional(boolean()),
  })),
})

export const CONFIG_FILES = [
  join(homedir(), '.config/mcp/mcp.json'),
  join(homedir(), '.pi/agent/mcp.json'),
  join(process.cwd(), '.mcp.json'),
  join(process.cwd(), '.pi/mcp.json'),
  join(homedir(), '.claude/mcp.json'),
  join(homedir(), '.config/claude-code/mcp.json'),
]

export const EXAMPLE_CONFIG = {
  servers: [
    {
      name: 'filesystem',
      enabled: true,
      lifecycle: 'lazy',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
      },
    },
  ],
}

export const HELP_LINES = [
  'MCP bridge: /mcp opens the server picker · /mcp list | status | connect <name|all> | disconnect <name|all> | refresh <name|all> | setup',
  'Proxy tool: mcp({ action, server?, tool?, resource?, prompt?, query?, arguments? })',
  'Direct tools: opt-in via directTools in config; proxy stays available to save context.',
]

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readJsonFile(path: string): unknown | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDir(dirname(path))
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function updateServerEnabledInConfig(path: string, serverName: string, enabled: boolean): boolean {
  const raw = readJsonFile(path)
  if (!isRecord(raw)) return false
  const parsed = safeParse(FileConfigSchema, raw)
  if (!parsed.success) return false

  let changed = false

  if (Array.isArray(raw.servers)) {
    for (const entry of raw.servers) {
      if (!isRecord(entry)) continue
      if (entry.name !== serverName) continue
      if (entry.enabled === enabled) continue
      entry.enabled = enabled
      changed = true
    }
  }

  if (isRecord(raw.mcpServers) && isRecord(raw.mcpServers[serverName])) {
    const entry = raw.mcpServers[serverName] as Record<string, unknown>
    if (entry.enabled !== enabled) {
      entry.enabled = enabled
      changed = true
    }
  }

  if (!changed) return false
  writeJsonFile(path, raw)
  return true
}


export function interpolateEnv(input: unknown): unknown {
  if (typeof input === 'string') {
    return input.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '')
  }
  if (Array.isArray(input)) return input.map((value) => interpolateEnv(value))
  if (isRecord(input)) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) out[key] = interpolateEnv(value)
    return out
  }
  return input
}

export function normalizeTransport(raw: RawServerConfig, fallbackType?: TransportType): TransportConfig | null {
  const directTransport = raw.transport
  if (directTransport) {
    const transport = interpolateEnv(directTransport) as TransportConfig
    if (transport.type === 'stdio' && transport.command) return transport
    if (transport.type === 'ssh' && transport.host && transport.command) return transport
    if ((transport.type === 'sse' || transport.type === 'streamable-http' || transport.type === 'websocket') && transport.url) {
      return transport
    }
    return null
  }

  if (raw.command) {
    return {
      type: 'stdio',
      command: String(interpolateEnv(raw.command)),
      args: Array.isArray(raw.args) ? (interpolateEnv(raw.args) as string[]) : [],
      env: isRecord(raw.env) ? (interpolateEnv(raw.env) as Record<string, string>) : undefined,
      cwd: raw.cwd ? String(interpolateEnv(raw.cwd)) : undefined,
      stderr: raw.stderr,
    }
  }

  if (raw.host && raw.command) {
    return {
      type: 'ssh',
      host: String(interpolateEnv(raw.host)),
      user: raw.user ? String(interpolateEnv(raw.user)) : undefined,
      port: raw.port,
      identityFile: raw.identityFile ? String(interpolateEnv(raw.identityFile)) : undefined,
      command: String(interpolateEnv(raw.command)),
      remoteArgs: Array.isArray(raw.remoteArgs) ? (interpolateEnv(raw.remoteArgs) as string[]) : Array.isArray(raw.args) ? (interpolateEnv(raw.args) as string[]) : [],
      env: isRecord(raw.env) ? (interpolateEnv(raw.env) as Record<string, string>) : undefined,
      stderr: raw.stderr,
    }
  }

  if (raw.url) {
    const type = fallbackType ?? 'streamable-http'
    return {
      type,
      url: String(interpolateEnv(raw.url)),
      headers: isRecord(raw.headers) ? (interpolateEnv(raw.headers) as Record<string, string>) : undefined,
      sessionId: raw.sessionId ? String(interpolateEnv(raw.sessionId)) : undefined,
      bearerToken: raw.bearerToken ? String(interpolateEnv(raw.bearerToken)) : undefined,
      bearerTokenEnv: raw.bearerTokenEnv ? String(interpolateEnv(raw.bearerTokenEnv)) : undefined,
    }
  }

  return null
}

export function normalizeServer(name: string, raw: RawServerConfig, source: string): NormalizedServerConfig | null {
  const transport = normalizeTransport(raw)
  if (!transport) return null
  return {
    name,
    enabled: raw.enabled !== false,
    autoReconnect: raw.autoReconnect !== false,
    maxReconnectAttempts: raw.maxReconnectAttempts ?? 3,
    reconnectDelayMs: raw.reconnectDelayMs ?? 1000,
    connectTimeoutMs: raw.connectTimeoutMs ?? 30_000,
    directTools: raw.directTools,
    excludeTools: raw.excludeTools ?? [],
    allowedTools: raw.allowedTools ?? [],
    deniedTools: raw.deniedTools ?? [],
    toolPrefix: raw.toolPrefix ?? 'server',
    lifecycle: raw.lifecycle ?? 'lazy',
    description: raw.description,
    transport,
    source,
  }
}

export function asServerEntries(config: FileConfig, source: string): NormalizedServerConfig[] {
  const out: NormalizedServerConfig[] = []
  if (Array.isArray(config.servers)) {
    for (const entry of config.servers) {
      if (!isRecord(entry)) continue
      const raw = interpolateEnv(entry) as RawServerConfig
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null
      if (!name) continue
      const server = normalizeServer(name, raw, source)
      if (server) out.push(server)
    }
  }
  if (isRecord(config.mcpServers)) {
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (!isRecord(entry)) continue
      const raw = interpolateEnv(entry) as RawServerConfig
      const server = normalizeServer(name, raw, source)
      if (server) out.push(server)
    }
  }
  return out
}

export function mergeServers(base: NormalizedServerConfig[], next: NormalizedServerConfig[]): NormalizedServerConfig[] {
  const map = new Map(base.map((server) => [server.name, server]))
  for (const server of next) map.set(server.name, server)
  return [...map.values()]
}

export function mergeSettings(
  base: LoadedConfig['settings'],
  next: FileConfig['settings'],
): LoadedConfig['settings'] {
  if (!next) return base
  return {
    toolPrefix: next.toolPrefix ?? base.toolPrefix,
    directTools: next.directTools ?? base.directTools,
    disableProxyTool: next.disableProxyTool ?? base.disableProxyTool,
    idleTimeout: next.idleTimeout ?? base.idleTimeout,
    importClaudeDesktop: next.importClaudeDesktop ?? base.importClaudeDesktop,
  }
}

export function stringifyCompact(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function toolResultToText(result: { content?: unknown[]; [key: string]: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : []
  const parts = content.map((block) => {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      return block.text
    }
    return stringifyCompact(block)
  })
  if (parts.length === 0) return stringifyCompact(result)
  return parts.join('\n')
}

export function sanitizeToolName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_') || 'tool'
}

export function buildDirectToolName(server: string, tool: string, mode: ToolPrefixMode): string {
  const serverSlug = sanitizeToolName(mode === 'short' ? server.replace(/-mcp$/i, '') : server)
  const toolSlug = sanitizeToolName(tool)
  if (mode === 'none') return `mcp_${toolSlug}`
  return `mcp_${serverSlug}_${toolSlug}`
}

export function isToolAllowed(server: NormalizedServerConfig, tool: string): boolean {
  if (server.excludeTools.includes(tool)) return false
  if (server.allowedTools.length > 0 && !server.allowedTools.includes(tool)) return false
  if (server.deniedTools.includes(tool)) return false
  return true
}

export function createTransport(server: NormalizedServerConfig) {
  const transport = server.transport
  if (transport.type === 'stdio') {
    return new StdioClientTransport({
      command: transport.command ?? '',
      args: transport.args ?? [],
      env: transport.env,
      cwd: transport.cwd,
      stderr: transport.stderr ?? 'inherit',
    })
  }
  if (transport.type === 'ssh') {
    return new StdioClientTransport({
      command: 'ssh',
      args: buildSshArgs(transport),
      env: transport.env,
      stderr: transport.stderr ?? 'inherit',
    })
  }
  const url = new URL(transport.url ?? '')
  if (transport.type === 'sse') {
    const headers = buildHeaders(transport)
    return new SSEClientTransport(url, {
      requestInit: headers ? { headers } : undefined,
      eventSourceInit: headers ? { headers: headers as Record<string, string> } : undefined,
    })
  }
  if (transport.type === 'websocket') {
    return new WebSocketClientTransport(url)
  }
  const headers = buildHeaders(transport)
  return new StreamableHTTPClientTransport(url, {
    requestInit: headers ? { headers } : undefined,
    sessionId: transport.sessionId,
  })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function buildSshArgs(transport: Extract<TransportConfig, { type: 'ssh' }>): string[] {
  const args = ['-T', '-o', 'BatchMode=yes']
  if (transport.port) args.push('-p', String(transport.port))
  if (transport.identityFile) args.push('-i', transport.identityFile)
  if (transport.user) {
    args.push(`${transport.user}@${transport.host}`)
  } else {
    args.push(transport.host)
  }
  const remoteCommand = transport.command
  const remoteArgs = transport.remoteArgs ?? []
  const remote = ['sh', '-lc', shellQuote([remoteCommand, ...remoteArgs].map((part) => shellQuote(part)).join(' '))]
  return [...args, ...remote]
}

export function computeReconnectDelay(attempt: number, baseMs: number): number {
  const cappedBase = Math.max(250, Math.floor(baseMs))
  const exponent = Math.max(0, Math.floor(attempt))
  return Math.min(cappedBase * 2 ** exponent, 30_000)
}

export function buildHeaders(transport: TransportConfig): Headers | undefined {
  const headers = new Headers()
  for (const [key, value] of Object.entries(transport.headers ?? {})) headers.set(key, value)
  if (transport.bearerTokenEnv) {
    const token = process.env[transport.bearerTokenEnv]
    if (token) headers.set('authorization', `Bearer ${token}`)
  }
  if (transport.bearerToken) headers.set('authorization', `Bearer ${transport.bearerToken}`)
  return [...headers.entries()].length > 0 ? headers : undefined
}

