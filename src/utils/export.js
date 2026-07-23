import { toPng, getFontEmbedCSS } from 'html-to-image'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

/**
 * Find the .screenshot-frame node for a given screenshot id, capture at native size.
 *
 * `fontEmbedCSS` is optional: pass a string to reuse a set of already-inlined @font-face
 * rules, or leave it out and html-to-image will derive them itself. Either way the capture
 * carries its own fonts — the SVG it rasterises is an isolated document that cannot see the
 * page's stylesheets, so a missing @font-face means the PNG silently renders in a fallback.
 */
export async function exportScreenshotPng(screenshotId, exportSize, fontEmbedCSS) {
  const node = document.querySelector(`[data-export-id="${screenshotId}"]`)
  if (!node) throw new Error('Screenshot node not found')
  const dataUrl = await toPng(node, {
    width: exportSize.width,
    height: exportSize.height,
    canvasWidth: exportSize.width,
    canvasHeight: exportSize.height,
    pixelRatio: 1,
    cacheBust: true,
    fontEmbedCSS,
    style: {
      transform: 'scale(1)',
      transformOrigin: 'top left'
    }
  })
  return dataUrl
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// Batch export: every screenshot × every language (renders each language by temporarily switching the active language).
export async function batchExport(screenshots, languages, exportSize, setActiveLanguage, sanitize, onProgress) {
  const zip = new JSZip()
  let count = 0
  const total = screenshots.length * languages.length

  // Collect the web fonts once for the whole batch. Reading every stylesheet and
  // base64-encoding every font file is the expensive half of an export, and the result is
  // identical for all N × M captures — nothing can change the document's fonts mid-run.
  // Passing `document.body` rather than one frame is what makes that safe: it picks up every
  // family in use across all frames, not just the first one's.
  let fontEmbedCSS
  try {
    // `|| undefined` so an empty result means "work it out yourself" rather than
    // "embed nothing" — an empty string is a valid instruction to skip fonts entirely.
    fontEmbedCSS = (await getFontEmbedCSS(document.body)) || undefined
  } catch (e) {
    // Not fatal — html-to-image just does the work itself, once per frame.
    console.warn('Could not pre-embed fonts for the batch; falling back to per-frame', e)
  }

  for (const lang of languages) {
    setActiveLanguage(lang)
    // Wait a frame so React re-renders with the new language
    await new Promise(r => requestAnimationFrame(() => r()))
    await new Promise(r => requestAnimationFrame(() => r()))
    for (const sc of screenshots) {
      try {
        const url = await exportScreenshotPng(sc.id, exportSize, fontEmbedCSS)
        const base64 = url.split(',')[1]
        const filename = `${sanitize(sc.name)}_${lang.toUpperCase()}.png`
        zip.file(filename, base64, { base64: true })
        count++
        onProgress?.(count, total, filename)
      } catch (e) {
        console.error('Failed to export', sc.name, lang, e)
      }
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `screenshots_${exportSize.width}x${exportSize.height}.zip`)
}

export function sanitizeFilename(name) {
  return (name || 'frame').replace(/[^a-z0-9-_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}
