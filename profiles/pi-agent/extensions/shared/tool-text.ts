export function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`
  return path
}

export function firstText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }
  return ''
}

export function lineCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split('\n').length
}
