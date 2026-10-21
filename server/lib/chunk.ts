export function chunkText(
  text: string,
  options: { maxChars?: number; overlap?: number } = {},
) {
  const maxChars = options.maxChars ?? 900
  const overlap = options.overlap ?? 140
  const cleaned = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()
  if (!cleaned) return []
  if (cleaned.length <= maxChars) return [cleaned]

  const chunks: string[] = []
  let start = 0
  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + maxChars)
    const window = cleaned.slice(start, end)
    const lastBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'))
    if (end < cleaned.length && lastBreak > maxChars * 0.4) {
      end = start + lastBreak
    }
    const piece = cleaned.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= cleaned.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks
}
