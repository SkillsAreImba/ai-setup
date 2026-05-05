import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { createBashTool, createFindTool, createGrepTool, createLsTool, createReadTool, type Theme } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'
import { firstText, lineCount, shortenPath } from './tool-text'

export { firstText, lineCount, shortenPath }

export function renderSummary(theme: Theme, summary: string, tone: 'success' | 'warning' | 'error' = 'success'): Text {
  return new Text(theme.fg(tone, summary), 0, 0)
}

export function renderExpanded(theme: Theme, text: string): Text {
  const lines = text.split('\n').map((line) => theme.fg('toolOutput', line))
  return new Text(`\n${lines.join('\n')}`, 0, 0)
}

export function registerCompactReadOnlyTools(pi: ExtensionAPI, cwd: string): void {
  const readTool = createReadTool(cwd)
  const bashTool = createBashTool(cwd)
  const findTool = createFindTool(cwd)
  const grepTool = createGrepTool(cwd)
  const lsTool = createLsTool(cwd)

  pi.registerTool({
    name: 'read',
    label: 'read',
    description: readTool.description,
    parameters: readTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return readTool.execute(toolCallId, params, signal, onUpdate)
    },
    renderCall(args, theme) {
      const path = shortenPath(String(args.path || ''))
      const suffix = args.offset || args.limit ? theme.fg('muted', ` (${[args.offset && `offset=${args.offset}`, args.limit && `limit=${args.limit}`].filter(Boolean).join(', ')})`) : ''
      return new Text(`${theme.fg('toolTitle', theme.bold('read'))} ${theme.fg('accent', path || '...')}${suffix}`, 0, 0)
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return renderSummary(theme, 'Reading...')
      const text = firstText(result.content)
      const count = lineCount(text)
      if (!text) return renderSummary(theme, 'Read done')
      return renderSummary(theme, `${count} line${count === 1 ? '' : 's'}`)
    },
  })

  pi.registerTool({
    name: 'bash',
    label: 'bash',
    description: bashTool.description,
    parameters: bashTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return bashTool.execute(toolCallId, params, signal, onUpdate)
    },
    renderCall(args, theme) {
      const cmd = String(args.command || '...')
      return new Text(`${theme.fg('toolTitle', theme.bold('$'))} ${theme.fg('accent', cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd)}`, 0, 0)
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return renderSummary(theme, 'Running...')
      const text = firstText(result.content)
      const exit = text.match(/exit code: (\d+)/)?.[1]
      const count = lineCount(text)
      const summary = exit ? `exit ${exit}` : text ? `${count} line${count === 1 ? '' : 's'}` : 'done'
      return renderSummary(theme, summary, exit && exit !== '0' ? 'error' : 'success')
    },
  })

  pi.registerTool({
    name: 'find',
    label: 'find',
    description: findTool.description,
    parameters: findTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return findTool.execute(toolCallId, params, signal, onUpdate)
    },
    renderCall(args, theme) {
      const pattern = String(args.pattern || '...')
      const path = args.path ? ` ${theme.fg('accent', shortenPath(String(args.path)))}` : ''
      return new Text(`${theme.fg('toolTitle', theme.bold('find'))} ${theme.fg('accent', pattern)}${path}`, 0, 0)
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return renderSummary(theme, 'Searching...')
      const text = firstText(result.content)
      const count = lineCount(text)
      return renderSummary(theme, `${count} file${count === 1 ? '' : 's'}`)
    },
  })

  pi.registerTool({
    name: 'grep',
    label: 'grep',
    description: grepTool.description,
    parameters: grepTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return grepTool.execute(toolCallId, params, signal, onUpdate)
    },
    renderCall(args, theme) {
      const pattern = String(args.pattern || '...')
      const path = args.path ? ` ${theme.fg('accent', shortenPath(String(args.path)))}` : ''
      return new Text(`${theme.fg('toolTitle', theme.bold('grep'))} ${theme.fg('accent', pattern)}${path}`, 0, 0)
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return renderSummary(theme, 'Searching...')
      const text = firstText(result.content)
      const count = lineCount(text)
      return renderSummary(theme, `${count} match${count === 1 ? '' : 'es'}`)
    },
  })

  pi.registerTool({
    name: 'ls',
    label: 'ls',
    description: lsTool.description,
    parameters: lsTool.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return lsTool.execute(toolCallId, params, signal, onUpdate)
    },
    renderCall(args, theme) {
      const path = args.path ? shortenPath(String(args.path)) : '.'
      return new Text(`${theme.fg('toolTitle', theme.bold('ls'))} ${theme.fg('accent', path)}`, 0, 0)
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return renderSummary(theme, 'Listing...')
      const text = firstText(result.content)
      const count = lineCount(text)
      return renderSummary(theme, `${count} entr${count === 1 ? 'y' : 'ies'}`)
    },
  })
}
