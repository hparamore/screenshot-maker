// Parse text with *asterisk* markers into segments.
// Each line becomes its own array; *foo* → italic flag.
export function parseText(text) {
  if (!text) return [[]]
  const lines = text.split('\n')
  return lines.map(line => {
    const parts = []
    const regex = /\*([^*\n]+)\*/g
    let lastIndex = 0
    let match
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ italic: false, text: line.slice(lastIndex, match.index) })
      }
      parts.push({ italic: true, text: match[1] })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < line.length) {
      parts.push({ italic: false, text: line.slice(lastIndex) })
    }
    if (parts.length === 0) parts.push({ italic: false, text: '' })
    return parts
  })
}
