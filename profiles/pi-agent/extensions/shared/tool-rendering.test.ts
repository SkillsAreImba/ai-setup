import { describe, expect, mock, test } from 'bun:test'

import { firstText, lineCount, shortenPath } from './tool-text'

class FakeText {
  constructor(private readonly text: string) {}
  render() {
    return this.text.split('\n')
  }
}

const fakeTool = (name: string) => ({
  description: name,
  parameters: {},
  execute: async () => ({ content: [] }),
})

mock.module('@mariozechner/pi-tui', () => ({
  Text: FakeText,
  Key: {},
  matchesKey: () => false,
  truncateToWidth: (s: string, width: number) => s.length > width ? s.slice(0, width) : s,
  visibleWidth: (s: string) => s.length,
}))
mock.module('@mariozechner/pi-coding-agent', () => ({
  createReadTool: () => fakeTool('read'),
  createBashTool: () => fakeTool('bash'),
  createFindTool: () => fakeTool('find'),
  createGrepTool: () => fakeTool('grep'),
  createLsTool: () => fakeTool('ls'),
}))

const { registerCompactReadOnlyTools } = await import('./tool-rendering')

describe('tool rendering helpers', () => {
  test('shortenPath trims home directory', () => {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    if (!home) return
    expect(shortenPath(`${home}/foo/bar`)).toBe('~/foo/bar')
  })

  test('lineCount counts visible lines', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('one\ntwo\nthree')).toBe(3)
  })

  test('firstText extracts the first text block', () => {
    expect(firstText([{ type: 'image' }, { type: 'text', text: 'hello' }])).toBe('hello')
    expect(firstText([{ type: 'text', text: 'hi' }, { type: 'text', text: 'there' }])).toBe('hi')
  })
})


describe('compact read-only tool renderers', () => {
  const theme = {
    bold: (s: string) => s,
    fg: (_tone: string, s: string) => s,
  } as any

  function captureTools() {
    const tools = new Map<string, any>()
    registerCompactReadOnlyTools({
      registerTool(tool: any) {
        tools.set(tool.name, tool)
      },
    } as any, process.cwd())
    return tools
  }

  test('read never renders raw file contents, even expanded', () => {
    const tool = captureTools().get('read')
    const raw = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const rendered = tool.renderResult(
      { content: [{ type: 'text', text: raw }] },
      { expanded: true, isPartial: false },
      theme,
    )

    const output = rendered.render(120).join('\n')
    expect(output).toBe('100 lines')
    expect(output).not.toContain('line 99')
  })

  test('bash/grep/find/ls render summaries, not raw output', () => {
    const tools = captureTools()
    const result = { content: [{ type: 'text', text: 'one\ntwo\nthree' }] }

    expect(tools.get('bash').renderResult(result, { expanded: true, isPartial: false }, theme).render(120).join('\n')).toBe('3 lines')
    expect(tools.get('grep').renderResult(result, { expanded: true, isPartial: false }, theme).render(120).join('\n')).toBe('3 matches')
    expect(tools.get('find').renderResult(result, { expanded: true, isPartial: false }, theme).render(120).join('\n')).toBe('3 files')
    expect(tools.get('ls').renderResult(result, { expanded: true, isPartial: false }, theme).render(120).join('\n')).toBe('3 entries')
  })
})