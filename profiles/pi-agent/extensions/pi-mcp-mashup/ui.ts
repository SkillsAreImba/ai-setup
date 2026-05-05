import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import { Key, matchesKey, truncateToWidth, visibleWidth } from '@mariozechner/pi-tui'

import type { LoadedConfig } from './core'

export interface McmServerRow {
  name: string
  enabled: boolean
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  transport: 'stdio' | 'ssh' | 'sse' | 'streamable-http' | 'websocket'
  lifecycle: 'lazy' | 'eager' | 'keep-alive'
  tools: number
  resources: number
  prompts: number
  description: string | null
  error: string | null
  source: string
}

export interface McpManagerBridge {
  loadedConfig: LoadedConfig
  getServerRows(): McmServerRow[]
  setServerEnabled(name: string, enabled: boolean): Promise<boolean>
}

function statusLabel(row: McmServerRow): string {
  const source = row.source.split('/').pop() ?? row.source
  const parts = [
    row.transport,
    row.status,
    `${row.tools} tool${row.tools === 1 ? '' : 's'}`,
    `${row.resources} res`,
    `${row.prompts} prompt${row.prompts === 1 ? '' : 's'}`,
    source,
  ]
  if (row.error) parts.push(row.error)
  return parts.join(' · ')
}

class McpManagerComponent {
  private rows: McmServerRow[]
  private selectedIndex = 0
  private busy = false
  private cachedWidth?: number
  private cachedLines?: string[]

  constructor(
    private readonly bridge: McpManagerBridge,
    private readonly theme: {
      fg: (name: string, text: string) => string
      bold: (text: string) => string
    },
    private readonly tui: { requestRender: () => void },
    private readonly done: (value: undefined) => void,
    private readonly notify: (message: string, level?: 'info' | 'warning' | 'error') => void,
  ) {
    this.rows = bridge.getServerRows()
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }

  private refreshRows(): void {
    this.rows = this.bridge.getServerRows()
    if (this.selectedIndex >= this.rows.length) {
      this.selectedIndex = Math.max(0, this.rows.length - 1)
    }
    this.invalidate()
  }

  private async toggleSelected(): Promise<void> {
    if (this.busy) return
    const row = this.rows[this.selectedIndex]
    if (!row) return

    this.busy = true
    this.invalidate()
    this.tui.requestRender()

    const nextEnabled = !row.enabled
    row.enabled = nextEnabled
    this.invalidate()
    this.tui.requestRender()

    try {
      const ok = await this.bridge.setServerEnabled(row.name, nextEnabled)
      if (!ok) {
        row.enabled = !nextEnabled
        this.notify(`MCP toggle failed for ${row.name}: config write failed`, 'error')
      } else {
        this.refreshRows()
        this.notify(`${row.name}: ${nextEnabled ? 'enabled' : 'disabled'}`, 'info')
      }
    } catch (error) {
      row.enabled = !nextEnabled
      const message = error instanceof Error ? error.message : String(error)
      this.notify(`MCP toggle failed for ${row.name}: ${message}`, 'error')
      this.refreshRows()
    } finally {
      this.busy = false
      this.invalidate()
      this.tui.requestRender()
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.done(undefined)
      return
    }

    if (this.rows.length === 0) return

    if (matchesKey(data, Key.up)) {
      this.selectedIndex = this.selectedIndex === 0 ? this.rows.length - 1 : this.selectedIndex - 1
      this.invalidate()
      this.tui.requestRender()
      return
    }

    if (matchesKey(data, Key.down)) {
      this.selectedIndex = this.selectedIndex === this.rows.length - 1 ? 0 : this.selectedIndex + 1
      this.invalidate()
      this.tui.requestRender()
      return
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      void this.toggleSelected()
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines

    const lines: string[] = []
    const push = (text: string) => lines.push(truncateToWidth(text, width))
    const border = '─'.repeat(Math.max(0, width))
    const summary = `${this.rows.length} configured · ↑↓ move · Enter/Space toggle · Esc close${this.busy ? ' · applying change' : ''}`
    const visibleRows = this.rows.length === 0 ? 0 : Math.min(8, this.rows.length)
    const start = this.rows.length <= visibleRows ? 0 : Math.max(0, Math.min(this.selectedIndex - Math.floor(visibleRows / 2), this.rows.length - visibleRows))
    const end = Math.min(this.rows.length, start + visibleRows)

    push(this.theme.fg('accent', border))
    push(this.theme.fg('accent', this.theme.bold('MCP Servers')))
    push(this.theme.fg('muted', summary))
    lines.push('')

    if (this.rows.length === 0) {
      push(this.theme.fg('dim', 'No MCP servers configured in this repo.'))
      push(this.theme.fg('dim', 'Create .mcp.json in the repo root or use /mcp setup.'))
      lines.push('')
      push(this.theme.fg('accent', border))
      this.cachedWidth = width
      this.cachedLines = lines
      return lines
    }

    for (let i = start; i < end; i++) {
      const row = this.rows[i]
      const selected = i === this.selectedIndex
      const marker = row.enabled
        ? (row.status === 'connected' ? '✓' : row.status === 'connecting' ? '…' : '·')
        : '○'
      const prefix = selected ? this.theme.fg('accent', '>') : ' '
      const label = `${marker} ${truncateToWidth(row.name, Math.max(10, width - 28), '')}`
      const state = `${row.transport} · ${row.status}`
      const tail = row.error ? ` · ${row.error}` : ''
      const rendered = `${prefix} ${selected ? this.theme.fg('accent', label) : label} — ${selected ? this.theme.fg('muted', state) : state}${tail}`
      push(rendered)
    }

    while (lines.length < 8) lines.push('')
    push(this.theme.fg('accent', border))

    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }
}

export async function showMcpManager(ctx: ExtensionCommandContext, bridge: McpManagerBridge): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const component = new McpManagerComponent(
      bridge,
      theme,
      tui,
      done,
      (message, level = 'info') => ctx.ui.notify(message, level),
    )

    return {
      render(width: number) {
        return component.render(width)
      },
      invalidate() {
        component.invalidate()
      },
      handleInput(data: string) {
        component.handleInput(data)
      },
    }
  })
}
