import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Text } from '@mariozechner/pi-tui'
import { looseObject, optional, picklist, record, safeParse, string, unknown } from 'valibot'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { DirectToolsSetting, FileConfig, LoadedConfig, NormalizedServerConfig, PromptInfo, ProxyInput, ResourceInfo, ServerLifecycle, ToolInfo, TransportType } from './core'
import { FileConfigSchema } from './core'
import { CONFIG_FILES, EXAMPLE_CONFIG, HELP_LINES, asServerEntries, buildDirectToolName, computeReconnectDelay, createTransport, isRecord, isToolAllowed, interpolateEnv, mergeServers, mergeSettings, readJsonFile, stringifyCompact, toolResultToText, updateServerEnabledInConfig, writeJsonFile } from './core'
import { showMcpManager } from './ui'

let extensionApi: ExtensionAPI | null = null

class McpServerRuntime {
  private client: Client | null = null
  private transport: ReturnType<typeof createTransport> | null = null
  private connecting: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private manualDisconnect = false
  private connected = false
  private lastError: string | null = null
  private lastLoadedAt: number | null = null
  tools: ToolInfo[] = []
  resources: ResourceInfo[] = []
  prompts: PromptInfo[] = []

  constructor(public server: NormalizedServerConfig) {}

  get status(): 'connected' | 'connecting' | 'disconnected' | 'error' {
    if (this.connected) return 'connected'
    if (this.connecting) return 'connecting'
    return this.lastError ? 'error' : 'disconnected'
  }

  get error(): string | null {
    return this.lastError
  }

  get loadedAt(): number | null {
    return this.lastLoadedAt
  }

  private makeClient(): Client {
    return new Client({ name: 'pi-mcp-hybrid', version: '1.0.0' }, {
      capabilities: {
        roots: {},
        prompts: {},
        resources: {},
        tools: {},
      },
    })
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private scheduleReconnect(): void {
    if (!this.server.autoReconnect || this.manualDisconnect) return
    if (this.connecting || this.reconnectTimer) return
    if (this.reconnectAttempts >= this.server.maxReconnectAttempts) return

    const delay = computeReconnectDelay(this.reconnectAttempts, this.server.reconnectDelayMs)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect(true).catch(() => this.scheduleReconnect())
    }, delay)
  }

  async connect(force = false): Promise<void> {
    if (this.connected && !force) return
    if (this.connecting) return this.connecting

    this.manualDisconnect = false
    this.clearReconnectTimer()

    this.connecting = (async () => {
      await this.disconnect(true)
      const client = this.makeClient()
      const transport = createTransport(this.server)
      this.client = client
      this.transport = transport
      transport.onclose = () => {
        this.connected = false
        this.client = null
        this.transport = null
        this.tools = []
        this.resources = []
        this.prompts = []
        this.lastLoadedAt = null
        this.scheduleReconnect()
      }
      transport.onerror = (error) => {
        this.lastError = error.message
        this.connected = false
      }
      await client.connect(transport)
      this.connected = true
      this.lastError = null
      this.reconnectAttempts = 0
      await this.reloadMetadata()
      this.lastLoadedAt = Date.now()
    })().catch((error: unknown) => {
      this.connected = false
      this.lastError = error instanceof Error ? error.message : String(error)
      this.scheduleReconnect()
      throw error
    }).finally(() => {
      this.connecting = null
    })

    return this.connecting
  }

  async disconnect(internal = false): Promise<void> {
    if (!internal) this.manualDisconnect = true
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    this.connected = false
    this.lastError = null
    try {
      await this.transport?.close()
    } catch {
      // ignore
    }
    this.client = null
    this.transport = null
    this.tools = []
    this.resources = []
    this.prompts = []
    this.lastLoadedAt = null
  }

  async reloadMetadata(): Promise<void> {
    if (!this.client) return
    const [tools, resources, prompts] = await Promise.all([
      this.client.listTools().catch(() => null),
      this.client.listResources().catch(() => null),
      this.client.listPrompts().catch(() => null),
    ])
    this.tools = Array.isArray(tools?.tools) ? (tools.tools as ToolInfo[]) : []
    this.resources = Array.isArray(resources?.resources) ? (resources.resources as ResourceInfo[]) : []
    this.prompts = Array.isArray(prompts?.prompts) ? (prompts.prompts as PromptInfo[]) : []
  }

  async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }
  }

  async callTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureConnected()
    if (!this.client) throw new Error(`MCP client not available for ${this.server.name}`)
    const result = await this.client.callTool({ name: tool, arguments: args })
    return result
  }

  async readResource(uri: string): Promise<unknown> {
    await this.ensureConnected()
    if (!this.client) throw new Error(`MCP client not available for ${this.server.name}`)
    return this.client.readResource({ uri })
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureConnected()
    if (!this.client) throw new Error(`MCP client not available for ${this.server.name}`)
    return this.client.getPrompt({ name, arguments: args })
  }
}

class McpBridge {
  private config: LoadedConfig = {
    settings: {
      toolPrefix: 'server',
      directTools: false,
      disableProxyTool: false,
      idleTimeout: 10,
      importClaudeDesktop: true,
    },
    servers: [],
  }

  private runtimes = new Map<string, McpServerRuntime>()
  private registeredDirectTools = new Set<string>()
  private loaded = false

  async loadFromDisk(): Promise<void> {
    const files = CONFIG_FILES
    let merged: LoadedConfig = {
      settings: {
        toolPrefix: 'server',
        directTools: false,
        disableProxyTool: false,
        idleTimeout: 10,
        importClaudeDesktop: true,
      },
      servers: [],
    }

    for (const file of files) {
      const parsed = readJsonFile(file)
      if (!parsed || !isRecord(parsed)) continue
      const interpolated = interpolateEnv(parsed)
      const result = safeParse(FileConfigSchema, interpolated)
      if (!result.success) continue
      const config = result.output as FileConfig
      merged = {
        settings: mergeSettings(merged.settings, config.settings),
        servers: mergeServers(merged.servers, asServerEntries(config, file)),
      }
    }

    this.config = merged
    this.loaded = true
    this.syncRuntimes()
  }

  private syncRuntimes(): void {
    const nextNames = new Set(this.config.servers.map((s) => s.name))
    for (const name of [...this.runtimes.keys()]) {
      if (!nextNames.has(name)) {
        void this.runtimes.get(name)?.disconnect()
        this.runtimes.delete(name)
      }
    }
    for (const server of this.config.servers) {
      const existing = this.runtimes.get(server.name)
      if (existing) {
        existing.server = server
      } else {
        this.runtimes.set(server.name, new McpServerRuntime(server))
      }
    }
  }

  get loadedConfig(): LoadedConfig {
    return this.config
  }

  getRuntime(name: string): McpServerRuntime | null {
    return this.runtimes.get(name) ?? null
  }

  getRuntimes(): McpServerRuntime[] {
    return [...this.runtimes.values()]
  }

  getServerRows(): Array<{
    name: string
    enabled: boolean
    status: 'connected' | 'connecting' | 'disconnected' | 'error'
    transport: TransportType
    lifecycle: ServerLifecycle
    tools: number
    resources: number
    prompts: number
    description: string | null
    error: string | null
    source: string
  }> {
    return this.getRuntimes().map((runtime) => ({
      name: runtime.server.name,
      enabled: runtime.server.enabled,
      status: runtime.status,
      transport: runtime.server.transport.type,
      lifecycle: runtime.server.lifecycle,
      tools: runtime.tools.length,
      resources: runtime.resources.length,
      prompts: runtime.prompts.length,
      description: runtime.server.description ?? null,
      error: runtime.error,
      source: runtime.server.source,
    }))
  }

  async setServerEnabled(name: string, enabled: boolean): Promise<boolean> {
    const runtime = this.runtimes.get(name)
    if (!runtime) return false

    const saved = updateServerEnabledInConfig(runtime.server.source, name, enabled)
    runtime.server.enabled = enabled
    const updated = this.config.servers.find((server) => server.name === name)
    if (updated) updated.enabled = enabled

    if (enabled) {
      await runtime.connect()
      await this.registerDirectToolsForRuntime(runtime)
    } else {
      await runtime.disconnect()
    }

    return saved || true
  }

  async preloadDirectTools(): Promise<number> {
    let count = 0
    for (const runtime of this.runtimes.values()) {
      const shouldDirect = runtime.server.directTools ?? this.config.settings.directTools
      if (!shouldExposeDirectTools(shouldDirect)) continue
      if (!runtime.server.enabled) continue
      if (runtime.server.lifecycle === 'lazy') {
        // still preconnect so tools are known before the model sees the session
        // but keep it lightweight: if it fails, proxy mode still works.
      }
      try {
        await runtime.connect()
        count += await this.registerDirectToolsForRuntime(runtime)
      } catch {
        // proxy remains available
      }
    }
    return count
  }

  async registerDirectToolsForRuntime(runtime: McpServerRuntime): Promise<number> {
    let added = 0
    for (const tool of runtime.tools) {
      const directSetting = runtime.server.directTools ?? this.config.settings.directTools
      if (!isToolAllowed(runtime.server, tool.name)) continue
      if (!shouldExposeDirectTool(directSetting, tool.name)) continue
      const name = buildDirectToolName(runtime.server.name, tool.name, runtime.server.toolPrefix ?? this.config.settings.toolPrefix)
      if (this.registeredDirectTools.has(name)) continue
      this.registeredDirectTools.add(name)
      const schema = tool.inputSchema && isRecord(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} }
      extensionApi?.registerTool({
        name,
        label: `${runtime.server.name}: ${tool.name}`,
        description: tool.description ? `[${runtime.server.name}] ${tool.description}` : `[${runtime.server.name}] MCP tool ${tool.name}`,
        parameters: schema,
        promptSnippet: `Use the MCP tool ${tool.name} on server ${runtime.server.name}.`,
        renderCall(args, theme) {
          return new Text(`${theme.fg('toolTitle', theme.bold(`${runtime.server.name}/`))}${theme.fg('accent', tool.name)}`, 0, 0)
        },
        renderResult(result, { expanded, isPartial }, theme) {
          if (isPartial) return new Text(theme.fg('warning', `${runtime.server.name}/${tool.name} running...`), 0, 0)
          const payload = isRecord(result.details) && isRecord((result.details as { result?: unknown }).result)
            ? ((result.details as { result: unknown }).result)
            : result.details ?? result
          const summary = summarizeDirectToolResult(runtime.server.name, tool.name, payload)
          const text = expanded ? `${summary}\n${stringifyCompact(payload)}` : summary
          return new Text(text.split('\n').map((line, index) => (index === 0 ? theme.fg('success', line) : theme.fg('dim', line))).join('\n'), 0, 0)
        },
        async execute(_toolCallId, params) {
          const result = await runtime.callTool(tool.name, params as Record<string, unknown>)
          const summary = summarizeDirectToolResult(runtime.server.name, tool.name, result)
          return {
            content: [{ type: 'text', text: summary }],
            details: { server: runtime.server.name, tool: tool.name, result },
          }
        },
      })
      added += 1
    }
    return added
  }

  async connect(names?: string[]): Promise<number> {
    const explicit = Boolean(names && names.length > 0)
    const targets = explicit ? names! : [...this.runtimes.keys()]
    let ok = 0
    for (const name of targets) {
      const runtime = this.runtimes.get(name)
      if (!runtime) continue
      if (!explicit && !runtime.server.enabled) continue
      await runtime.connect()
      await this.registerDirectToolsForRuntime(runtime)
      ok += 1
    }
    return ok
  }

  async disconnect(names?: string[]): Promise<number> {
    const targets = names && names.length > 0 ? names : [...this.runtimes.keys()]
    let ok = 0
    for (const name of targets) {
      const runtime = this.runtimes.get(name)
      if (!runtime) continue
      await runtime.disconnect()
      ok += 1
    }
    return ok
  }

  async refresh(names?: string[]): Promise<number> {
    await this.loadFromDisk()
    return this.connect(names)
  }

  async ensureReady(piCtx?: ExtensionContext): Promise<void> {
    if (!this.loaded) {
      await this.loadFromDisk()
    }
    if (piCtx?.hasUI) {
      const serverNames = this.config.servers.map((server) => server.name).join(', ') || 'none'
      const directSetting = this.config.settings.directTools
      piCtx.ui.setStatus('mcp', `${serverNames} · direct=${formatDirectToolsLabel(directSetting)}`)
    }
  }

  summary(): string {
    const lines: string[] = []
    lines.push(`Servers: ${this.runtimes.size}`)
    for (const runtime of this.runtimes.values()) {
      lines.push(`- ${runtime.server.name} [${runtime.status}] tools=${runtime.tools.length} resources=${runtime.resources.length} prompts=${runtime.prompts.length}${runtime.error ? ` error=${runtime.error}` : ''}`)
    }
    return lines.join('\n')
  }

  searchTools(query: string, serverName?: string): Array<{ server: string; tool: ToolInfo }> {
    const q = query.trim().toLowerCase()
    const runtimes = serverName ? [this.runtimes.get(serverName)].filter(Boolean) as McpServerRuntime[] : [...this.runtimes.values()]
    const matches: Array<{ server: string; tool: ToolInfo }> = []
    for (const runtime of runtimes) {
      for (const tool of runtime.tools) {
        const hay = `${tool.name} ${tool.description ?? ''}`.toLowerCase()
        if (!q || hay.includes(q)) matches.push({ server: runtime.server.name, tool })
      }
    }
    return matches.slice(0, 25)
  }

  async mcpAction(input: ProxyInput): Promise<unknown> {
    await this.ensureReady()
    switch (input.action) {
      case 'status':
      case 'list_servers': {
        return {
          ok: true,
          settings: this.config.settings,
          servers: this.getRuntimes().map((runtime) => ({
            name: runtime.server.name,
            enabled: runtime.server.enabled,
            status: runtime.status,
            transport: runtime.server.transport.type,
            lifecycle: runtime.server.lifecycle,
            tools: runtime.tools.length,
            resources: runtime.resources.length,
            prompts: runtime.prompts.length,
            description: runtime.server.description ?? null,
            error: runtime.error,
          })),
        }
      }
      case 'connect': {
        return { ok: true, connected: await this.connect(input.server ? [input.server] : undefined) }
      }
      case 'disconnect': {
        return { ok: true, disconnected: await this.disconnect(input.server ? [input.server] : undefined) }
      }
      case 'refresh': {
        return { ok: true, refreshed: await this.refresh(input.server ? [input.server] : undefined) }
      }
      case 'list_tools': {
        const runtime = input.server ? this.runtimes.get(input.server) : null
        if (runtime) await runtime.connect()
        const list = input.server ? (runtime?.tools ?? []) : this.getRuntimes().flatMap((rt) => rt.tools.map((tool) => ({ server: rt.server.name, tool })))
        return { ok: true, tools: list }
      }
      case 'search_tools': {
        return { ok: true, matches: this.searchTools(input.query ?? '', input.server) }
      }
      case 'call_tool': {
        if (!input.server || !input.tool) return { ok: false, error: 'missing_server_or_tool' }
        const runtime = this.runtimes.get(input.server)
        if (!runtime) return { ok: false, error: 'unknown_server' }
        const result = await runtime.callTool(input.tool, input.arguments ?? {})
        return { ok: true, result }
      }
      case 'list_resources': {
        const runtime = input.server ? this.runtimes.get(input.server) : null
        if (runtime) await runtime.connect()
        const list = input.server ? (runtime?.resources ?? []) : this.getRuntimes().flatMap((rt) => rt.resources.map((resource) => ({ server: rt.server.name, resource })))
        return { ok: true, resources: list }
      }
      case 'read_resource': {
        if (!input.server || !input.resource) return { ok: false, error: 'missing_server_or_resource' }
        const runtime = this.runtimes.get(input.server)
        if (!runtime) return { ok: false, error: 'unknown_server' }
        const result = await runtime.readResource(input.resource)
        return { ok: true, result }
      }
      case 'list_prompts': {
        const runtime = input.server ? this.runtimes.get(input.server) : null
        if (runtime) await runtime.connect()
        const list = input.server ? (runtime?.prompts ?? []) : this.getRuntimes().flatMap((rt) => rt.prompts.map((prompt) => ({ server: rt.server.name, prompt })))
        return { ok: true, prompts: list }
      }
      case 'get_prompt': {
        if (!input.server || !input.prompt) return { ok: false, error: 'missing_server_or_prompt' }
        const runtime = this.runtimes.get(input.server)
        if (!runtime) return { ok: false, error: 'unknown_server' }
        const result = await runtime.getPrompt(input.prompt, input.arguments ?? {})
        return { ok: true, result }
      }
    }
  }
}

export function shouldExposeDirectTools(setting: DirectToolsSetting | undefined): boolean {
  if (setting === true) return true
  if (Array.isArray(setting)) return setting.length > 0
  return false
}

export function shouldExposeDirectTool(setting: DirectToolsSetting | undefined, toolName: string): boolean {
  if (setting === true) return true
  if (Array.isArray(setting)) return setting.includes(toolName)
  return false
}

const bridge = new McpBridge()

function formatDirectToolsLabel(setting: DirectToolsSetting): string {
  if (setting === true) return 'all'
  if (Array.isArray(setting)) return setting.length > 0 ? String(setting.length) : 'off'
  return 'off'
}

export function formatStartupMcpLines(
  bridgeState: Pick<McpBridge, 'loadedConfig' | 'getServerRows'>,
  theme?: ExtensionContext['ui']['theme'],
): string {
  const rows = bridgeState.getServerRows()
  const serverText = rows.length > 0
    ? rows.map((row) => `${row.name}${row.enabled ? '' : ' (off)'}`).join(', ')
    : 'none'
  const settings = bridgeState.loadedConfig.settings
  const heading = theme ? theme.fg('accent', '[MCP]') : '[MCP]'
  const detail = (line: string) => theme ? theme.fg('dim', line) : line
  return [
    heading,
    detail(`${rows.length} server${rows.length === 1 ? '' : 's'}: ${serverText}`),
    detail(`direct tools: ${formatDirectToolsLabel(settings.directTools)} · proxy: ${settings.disableProxyTool ? 'disabled' : 'enabled'}`),
  ].join('\n')
}
let lastStartupNoticeKey = ''
let lastStartupNoticeAt = 0

function notifyStartupMcpSummary(ctx: ExtensionContext, reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork'): void {
  if (!ctx.hasUI) return
  const message = formatStartupMcpLines(bridge, ctx.ui.theme)
  const key = `${reason}:${message}`
  const now = Date.now()
  if (key === lastStartupNoticeKey && now - lastStartupNoticeAt < 1000) return
  lastStartupNoticeKey = key
  lastStartupNoticeAt = now

  const send = () => ctx.ui.notify(message, 'info')
  if (reason === 'reload') {
    setTimeout(send, 50)
    return
  }
  send()
}
function formatServerLines(bridgeState: McpBridge): string {
  const lines = [
    `Configured MCP servers: ${bridgeState.loadedConfig.servers.length}`,
    `Direct tools: ${bridgeState.loadedConfig.settings.directTools === true ? 'all' : Array.isArray(bridgeState.loadedConfig.settings.directTools) ? bridgeState.loadedConfig.settings.directTools.join(', ') : 'off'}`,
    `Proxy tool: ${bridgeState.loadedConfig.settings.disableProxyTool ? 'disabled' : 'enabled'}`,
  ]
  for (const runtime of bridgeState.getRuntimes()) {
    lines.push(`- ${runtime.server.name} (${runtime.server.transport.type}, ${runtime.status}, tools=${runtime.tools.length})`)
  }
  return lines.join('\n')
}

function summarizeProxyInput(input: ProxyInput): string {
  switch (input.action) {
    case 'status':
      return 'status'
    case 'list_servers':
      return 'list servers'
    case 'list_tools':
      return input.server ? `list tools @ ${input.server}` : 'list tools'
    case 'search_tools':
      return input.server ? `search tools @ ${input.server}` : 'search tools'
    case 'call_tool':
      return input.server && input.tool ? `call ${input.server}/${input.tool}` : 'call tool'
    case 'list_resources':
      return input.server ? `list resources @ ${input.server}` : 'list resources'
    case 'read_resource':
      return input.server && input.resource ? `read ${input.server} ${input.resource}` : 'read resource'
    case 'list_prompts':
      return input.server ? `list prompts @ ${input.server}` : 'list prompts'
    case 'get_prompt':
      return input.server && input.prompt ? `get prompt ${input.server}/${input.prompt}` : 'get prompt'
    case 'connect':
      return input.server ? `connect ${input.server}` : 'connect all'
    case 'disconnect':
      return input.server ? `disconnect ${input.server}` : 'disconnect all'
    case 'refresh':
      return input.server ? `refresh ${input.server}` : 'refresh all'
  }
}

function summarizeProxyResult(input: ProxyInput, result: unknown): string {
  if (!isRecord(result)) return `MCP ${summarizeProxyInput(input)} → done`
  if (result.ok === false) {
    const error = typeof result.error === 'string' ? result.error : 'error'
    const detail = typeof result.detail === 'string' ? `: ${result.detail}` : ''
    return `MCP ${summarizeProxyInput(input)} → ${error}${detail}`
  }

  switch (input.action) {
    case 'status':
    case 'list_servers': {
      const servers = Array.isArray(result.servers) ? result.servers : []
      const connected = servers.filter((server) => isRecord(server) && server.status === 'connected').length
      return `MCP status: ${connected}/${servers.length} connected`
    }
    case 'list_tools': {
      const tools = Array.isArray(result.tools) ? result.tools : []
      return input.server ? `MCP tools @ ${input.server}: ${tools.length}` : `MCP tools: ${tools.length}`
    }
    case 'search_tools': {
      const matches = Array.isArray(result.matches) ? result.matches : []
      return input.server ? `MCP search @ ${input.server}: ${matches.length} match${matches.length === 1 ? '' : 'es'}` : `MCP search: ${matches.length} match${matches.length === 1 ? '' : 'es'}`
    }
    case 'call_tool':
      return input.server && input.tool ? `MCP call ${input.server}/${input.tool} → ok` : 'MCP call → ok'
    case 'list_resources': {
      const resources = Array.isArray(result.resources) ? result.resources : []
      return input.server ? `MCP resources @ ${input.server}: ${resources.length}` : `MCP resources: ${resources.length}`
    }
    case 'read_resource':
      return input.server && input.resource ? `MCP read ${input.server} ${input.resource} → ok` : 'MCP read resource → ok'
    case 'list_prompts': {
      const prompts = Array.isArray(result.prompts) ? result.prompts : []
      return input.server ? `MCP prompts @ ${input.server}: ${prompts.length}` : `MCP prompts: ${prompts.length}`
    }
    case 'get_prompt':
      return input.server && input.prompt ? `MCP prompt ${input.server}/${input.prompt} → ok` : 'MCP prompt → ok'
    case 'connect': {
      const connected = typeof result.connected === 'number' ? result.connected : 0
      return `MCP connect: ${connected} server${connected === 1 ? '' : 's'}`
    }
    case 'disconnect': {
      const disconnected = typeof result.disconnected === 'number' ? result.disconnected : 0
      return `MCP disconnect: ${disconnected} server${disconnected === 1 ? '' : 's'}`
    }
    case 'refresh': {
      const refreshed = typeof result.refreshed === 'number' ? result.refreshed : 0
      return `MCP refresh: ${refreshed} server${refreshed === 1 ? '' : 's'}`
    }
  }
}

function summarizeDirectToolResult(server: string, tool: string, result: unknown): string {
  if (typeof result === 'string') {
    const line = result.trim().split('\n').find(Boolean)
    return line ? `MCP ${server}/${tool} → ${line.length > 160 ? `${line.slice(0, 157)}...` : line}` : `MCP ${server}/${tool} → done`
  }
  if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'bigint') {
    return `MCP ${server}/${tool} → ${String(result)}`
  }
  if (!isRecord(result)) return `MCP ${server}/${tool} → done`
  if (typeof result.error === 'string' && result.error.trim()) {
    return `MCP ${server}/${tool} → error: ${result.error}`
  }
  if (result.isError === true) return `MCP ${server}/${tool} → error`
  const text = toolResultToText(result as { content?: unknown[] })
  const line = text.split('\n').map((entry) => entry.trim()).find(Boolean)
  if (!line) return `MCP ${server}/${tool} → done`
  return `MCP ${server}/${tool} → ${line.length > 160 ? `${line.slice(0, 157)}...` : line}`
}

function renderProxyResultText(input: ProxyInput, result: unknown, expanded: boolean): string {
  const summary = summarizeProxyResult(input, result)
  if (!expanded) return summary
  return `${summary}\n${stringifyCompact(result)}`
}

export const ProxyInputSchema = looseObject({
  action: picklist(['status', 'list_servers', 'list_tools', 'search_tools', 'call_tool', 'list_resources', 'read_resource', 'list_prompts', 'get_prompt', 'connect', 'disconnect', 'refresh']),
  server: optional(string()),
  tool: optional(string()),
  resource: optional(string()),
  prompt: optional(string()),
  query: optional(string()),
  arguments: optional(record(string(), unknown())),
})

const PROXY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'list_servers', 'list_tools', 'search_tools', 'call_tool', 'list_resources', 'read_resource', 'list_prompts', 'get_prompt', 'connect', 'disconnect', 'refresh'],
      description: 'What to do with the MCP bridge.',
    },
    server: {
      type: 'string',
      description: 'Target server name.',
    },
    tool: {
      type: 'string',
      description: 'Tool name when action=call_tool.',
    },
    resource: {
      type: 'string',
      description: 'Resource URI when action=read_resource.',
    },
    prompt: {
      type: 'string',
      description: 'Prompt name when action=get_prompt.',
    },
    query: {
      type: 'string',
      description: 'Search query for action=search_tools.',
    },
    arguments: {
      type: 'object',
      description: 'Arguments for tool/resource/prompt calls.',
      additionalProperties: true,
    },
  },
  required: ['action'],
}

export default async function (pi: ExtensionAPI) {
  extensionApi = pi
  await bridge.loadFromDisk()

  if (!bridge.loadedConfig.settings.disableProxyTool) {
    pi.registerTool({
      name: 'mcp',
      label: 'MCP',
      description: 'Bridge to MCP servers. actions: status | list_servers | list_tools | search_tools | call_tool | list_resources | read_resource | list_prompts | get_prompt | connect | disconnect | refresh',
      parameters: PROXY_SCHEMA,
      promptSnippet: 'Use the MCP bridge to discover, connect, and call external MCP servers. Prefer proxy mode to save context, direct tools when already registered.',
      renderCall(args, theme) {
        const input = (args && typeof args === 'object' ? args : { action: 'status' }) as ProxyInput
        return new Text(`${theme.fg('toolTitle', theme.bold('mcp '))}${theme.fg('accent', summarizeProxyInput(input))}`, 0, 0)
      },
      renderResult(result, { expanded, isPartial }, theme) {
        if (isPartial) return new Text(theme.fg('warning', 'MCP running...'), 0, 0)
        const payload = isRecord(result.details) ? (result.details as { input?: unknown; result?: unknown }) : null
        const input = payload && isRecord(payload.input) ? (payload.input as ProxyInput) : ({ action: 'status' } as ProxyInput)
        const data = payload?.result ?? result.details ?? result
        const text = renderProxyResultText(input, data, expanded)
        return new Text(text.split('\n').map((line, index) => (index === 0 ? theme.fg('success', line) : theme.fg('dim', line))).join('\n'), 0, 0)
      },
      async execute(_toolCallId, params, _signal, onUpdate) {
        const parsed = safeParse(ProxyInputSchema, params)
        const input = parsed.success ? (parsed.output as ProxyInput) : ({ action: 'status' } as ProxyInput)
        onUpdate?.({ content: [{ type: 'text', text: `MCP ${summarizeProxyInput(input)}...` }] })
        const result = await bridge.mcpAction(input)
        const summary = summarizeProxyResult(input, result)
        return {
          content: [{ type: 'text', text: summary }],
          details: { input, result },
        }
      },
    })
  }

  pi.registerCommand('mcp', {
    description: 'Inspect and manage MCP servers',
    handler: async (args, ctx) => {
      await bridge.ensureReady(ctx)
      const [subcommand = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
      const target = rest[0]
      if (!subcommand) {
        await showMcpManager(ctx, bridge)
        return
      }
      if (subcommand === 'list' || subcommand === 'status') {
        ctx.ui.notify(formatServerLines(bridge), 'info')
        return
      }
      if (subcommand === 'connect') {
        const count = await bridge.connect(target ? [target] : undefined)
        ctx.ui.notify(`Connected ${count} server(s)`, 'info')
        return
      }
      if (subcommand === 'disconnect') {
        const count = await bridge.disconnect(target ? [target] : undefined)
        ctx.ui.notify(`Disconnected ${count} server(s)`, 'info')
        return
      }
      if (subcommand === 'refresh') {
        const count = await bridge.refresh(target ? [target] : undefined)
        ctx.ui.notify(`Refreshed ${count} server(s)`, 'info')
        return
      }
      if (subcommand === 'setup') {
        const targetFile = join(process.cwd(), '.mcp.json')
        if (existsSync(targetFile)) {
          ctx.ui.notify(`Already exists: ${targetFile}`, 'warning')
          return
        }
        writeJsonFile(targetFile, EXAMPLE_CONFIG)
        ctx.ui.notify(`Wrote starter config: ${targetFile}`, 'info')
        return
      }
      ctx.ui.notify(HELP_LINES.join(' | '), 'info')
    },
  })

  pi.on('session_start', async (event, ctx) => {
    await bridge.ensureReady(ctx)
    await bridge.preloadDirectTools()
    notifyStartupMcpSummary(ctx, event.reason)
  })

  pi.on('resources_discover', async (event, ctx) => {
    if (event.reason === 'reload') {
      await bridge.ensureReady()
      notifyStartupMcpSummary(ctx, event.reason)
    }
    return {}
  })
}
