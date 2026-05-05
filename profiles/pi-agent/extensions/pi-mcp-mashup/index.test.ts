import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { safeParse } from 'valibot'

import {
  FileConfigSchema,
  ProxyInputSchema,
  formatStartupMcpLines,
  buildDirectToolName,
  interpolateEnv,
  buildSshArgs,
  computeReconnectDelay,
  normalizeTransport,
  sanitizeToolName,
  shouldExposeDirectTool,
  shouldExposeDirectTools,
  updateServerEnabledInConfig,
  writeJsonFile,
} from './index'

describe('mcp mashup helpers', () => {
  test('sanitizes tool and server names deterministically', () => {
    expect(sanitizeToolName('GitHub MCP')).toBe('github_mcp')
    expect(sanitizeToolName('  --API::Tool--  ')).toBe('api_tool')
  })

  test('builds direct tool names with the requested prefix mode', () => {
    expect(buildDirectToolName('github', 'search_repositories', 'server')).toBe('mcp_github_search_repositories')
    expect(buildDirectToolName('github-mcp', 'search_repositories', 'short')).toBe('mcp_github_search_repositories')
    expect(buildDirectToolName('github', 'search_repositories', 'none')).toBe('mcp_search_repositories')
  })

  test('direct tool gating is explicit', () => {
    expect(shouldExposeDirectTools(true)).toBe(true)
    expect(shouldExposeDirectTools(false)).toBe(false)
    expect(shouldExposeDirectTools(['search_repositories'])).toBe(true)
    expect(shouldExposeDirectTools([])).toBe(false)
    expect(shouldExposeDirectTool(true, 'anything')).toBe(true)
    expect(shouldExposeDirectTool(['search_repositories'], 'search_repositories')).toBe(true)
    expect(shouldExposeDirectTool(['search_repositories'], 'delete_repository')).toBe(false)
  })

  test('interpolates env vars recursively', () => {
    const prev = process.env.MCP_TEST_TOKEN
    process.env.MCP_TEST_TOKEN = 'secret'
    try {
      const value = interpolateEnv({
        headers: { authorization: 'Bearer ${MCP_TEST_TOKEN}' },
        args: ['--token', '${MCP_TEST_TOKEN}'],
      }) as { headers: { authorization: string }; args: string[] }
      expect(value.headers.authorization).toBe('Bearer secret')
      expect(value.args[1]).toBe('secret')
    } finally {
      if (prev === undefined) delete process.env.MCP_TEST_TOKEN
      else process.env.MCP_TEST_TOKEN = prev
    }
  })

  test('validates proxy input with valibot', () => {
    const parsed = safeParse(ProxyInputSchema, {
      action: 'search_tools',
      query: 'github',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.output.action).toBe('search_tools')
      expect(parsed.output.query).toBe('github')
    }
  })

  test('accepts sane config envelopes', () => {
    const parsed = safeParse(FileConfigSchema, {
      settings: {
        toolPrefix: 'server',
        directTools: ['search_repositories'],
        disableProxyTool: false,
        idleTimeout: 5,
        importClaudeDesktop: true,
      },
      mcpServers: {
        filesystem: {
          transport: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('normalizes stdio, ssh, http and websocket transports', () => {
    expect(normalizeTransport({ transport: { type: 'stdio', command: 'npx', args: ['x'] } })?.type).toBe('stdio')
    expect(normalizeTransport({ transport: { type: 'ssh', host: 'box', command: 'node', remoteArgs: ['server.js'] } })?.type).toBe('ssh')
    expect(normalizeTransport({ transport: { type: 'streamable-http', url: 'https://example.com/mcp' } })?.type).toBe('streamable-http')
    expect(normalizeTransport({ transport: { type: 'websocket', url: 'ws://example.com/mcp' } })?.type).toBe('websocket')
  })

  test('builds ssh args safely', () => {
    const args = buildSshArgs({
      type: 'ssh',
      host: 'mcp.example',
      user: 'pi',
      port: 2222,
      identityFile: '/home/pi/.ssh/id_ed25519',
      command: 'node',
      remoteArgs: ['server.js', '--flag', "value with spaces"],
    })
    expect(args[0]).toBe('-T')
    expect(args).toContain('pi@mcp.example')
    expect(args).toContain('-p')
    expect(args).toContain('2222')
    expect(args).toContain('-i')
    expect(args).toContain('/home/pi/.ssh/id_ed25519')
    expect(args.slice(-3)).toEqual(['sh', '-lc', expect.any(String)])
  })

  test('reconnect backoff grows but is capped', () => {
    expect(computeReconnectDelay(0, 100)).toBe(250)
    expect(computeReconnectDelay(1, 500)).toBe(1000)
    expect(computeReconnectDelay(5, 5000)).toBe(30_000)
  })

  test('can persist server enabled state into an mcp config file', () => {
    const path = `${process.cwd()}/.tmp-mcp-test.json`
    try {
      writeJsonFile(path, {
        mcpServers: {
          donotdev: { command: 'bunx', args: ['@donotdev/mcp-server@latest'], enabled: false },
        },
      })
      expect(updateServerEnabledInConfig(path, 'donotdev', true)).toBe(true)
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: { donotdev: { enabled: boolean } } }
      expect(parsed.mcpServers.donotdev.enabled).toBe(true)
    } finally {
      rmSync(path, { force: true })
    }
  })
  test('formats startup MCP summary like native resource sections', () => {
    const summary = formatStartupMcpLines({
      loadedConfig: {
        settings: {
          toolPrefix: 'server',
          directTools: false,
          disableProxyTool: false,
          idleTimeout: 10,
          importClaudeDesktop: true,
        },
        servers: [],
      },
      getServerRows: () => [
        { name: 'donotdev', enabled: true, status: 'disconnected', transport: 'stdio', lifecycle: 'lazy', tools: 0, resources: 0, prompts: 0, description: null, error: null, source: '.mcp.json' },
        { name: 'github', enabled: false, status: 'disconnected', transport: 'stdio', lifecycle: 'lazy', tools: 0, resources: 0, prompts: 0, description: null, error: null, source: '.mcp.json' },
      ],
    } as any)

    expect(summary).toBe('[MCP]\n2 servers: donotdev, github (off)\ndirect tools: off · proxy: enabled')
  })
  test('colors startup MCP heading with the active theme', () => {
    const theme = {
      fg: (name: string, value: string) => `<${name}>${value}</${name}>`,
    } as any
    const summary = formatStartupMcpLines({
      loadedConfig: {
        settings: { toolPrefix: 'server', directTools: true, disableProxyTool: true, idleTimeout: 10, importClaudeDesktop: true },
        servers: [],
      },
      getServerRows: () => [],
    } as any, theme)

    expect(summary).toBe('<accent>[MCP]</accent>\n<dim>0 servers: none</dim>\n<dim>direct tools: all · proxy: disabled</dim>')
  })
})
