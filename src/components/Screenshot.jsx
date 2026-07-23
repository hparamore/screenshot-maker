import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { useStore } from '../store'
import DeviceFrame from './DeviceFrame'
import TextRender from './TextRender'
import Overlay from './Overlay'
import ConfirmDialog from './ConfirmDialog'
import {
  computeDeviceWidth,
  computeScreenBounds,
  imagePanBounds,
  clampImageOffset
} from '../utils/layout'
import { readTextMetrics, isOverflowing, overflowAmount } from '../utils/textMetrics'
import { useFamilyAvailable } from '../utils/fontRegistry'
import {
  resolveTextTransform,
  isVariantUnlocked,
  isPrimaryLanguage,
  isIdentityTextTransform,
  textTransformOrigin
} from '../utils/variants'

// Renders one screenshot at native canvas size, scaled into the workspace.
// frame element is at full export resolution; wrapper applies CSS scale for display.
export default function Screenshot({ screenshot, displayScale, selected, index = 0, count = 1 }) {
  const exportSize = useStore(s => s.exportSize)
  const activeLanguage = useStore(s => s.activeLanguage)
  const selectScreenshot = useStore(s => s.selectScreenshot)
  const updateScreenshot = useStore(s => s.updateScreenshot)
  const addOverlay = useStore(s => s.addOverlay)
  const selectOverlay = useStore(s => s.selectOverlay)
  const selectedOverlayId = useStore(s => s.selectedOverlayId)
  const zoomMode = useStore(s => s.zoomMode)
  const setZoomMode = useStore(s => s.setZoomMode)
  const cropEditingId = useStore(s => s.cropEditingId)
  const setCropEditing = useStore(s => s.setCropEditing)
  const updateOverlayStore = useStore(s => s.updateOverlay)
  const removeScreenshot = useStore(s => s.removeScreenshot)
  const duplicateScreenshot = useStore(s => s.duplicateScreenshot)
  const reorderScreenshot = useStore(s => s.reorderScreenshot)
  const languages = useStore(s => s.languages)
  const setTextTransform = useStore(s => s.setTextTransform)
  const unlockTextVariant = useStore(s => s.unlockTextVariant)
  const setTextMetrics = useStore(s => s.setTextMetrics)
  const textMetrics = useStore(s => s.textMetrics[screenshot.id])

  const { width, height } = exportSize
  const t = screenshot.texts[activeLanguage] || { preheader: '', heading: '' }

  const [isDragOver, setDragOver] = useState(false)
  const [zoomDrag, setZoomDrag] = useState(null) // {x, y, w, h} in native canvas px
  const [imgNatural, setImgNatural] = useState(null)
  const [textHover, setTextHover] = useState(false)
  const [textDragging, setTextDragging] = useState(false)
  const [imagePanning, setImagePanning] = useState(false)
  const [askUnlock, setAskUnlock] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(screenshot.name)
  const [fontEpoch, setFontEpoch] = useState(0)
  const frameRef = useRef(null)
  const nameInputRef = useRef(null)
  const measureRefs = useRef({})

  useEffect(() => {
    if (!screenshot.image) { setImgNatural(null); return }
    const img = new Image()
    img.onload = () => setImgNatural({
      src: screenshot.image,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight
    })
    img.src = screenshot.image
  }, [screenshot.image])

  // Drag-drop and paste for the dropped image
  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      updateScreenshot(screenshot.id, { image: ev.target.result })
    }
    reader.readAsDataURL(file)
  }, [screenshot.id, updateScreenshot])

  const onFileInput = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      updateScreenshot(screenshot.id, { image: ev.target.result })
    }
    reader.readAsDataURL(file)
  }, [screenshot.id, updateScreenshot])

  // Paste handler — when this screenshot is selected, paste adds an overlay (or sets the main image if none yet)
  useEffect(() => {
    if (!selected) return
    const onPaste = (e) => {
      const items = [...(e.clipboardData?.items || [])]
      const imgItem = items.find(it => it.type.startsWith('image/'))
      if (!imgItem) return
      const file = imgItem.getAsFile()
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const src = ev.target.result
        if (!screenshot.image) {
          updateScreenshot(screenshot.id, { image: src })
        } else {
          // add as overlay, default size 30% of canvas width centered
          const tmp = new Image()
          tmp.onload = () => {
            const w = width * 0.35
            const h = w * (tmp.naturalHeight / tmp.naturalWidth)
            addOverlay(screenshot.id, {
              type: 'image',
              src,
              x: (width - w) / 2,
              y: (height - h) / 2,
              w, h,
              rotation: 0,
              radius: 16,
              shadow: { y: 20, blur: 40, opacity: 0.35 },
              border: { width: 0, color: '#000000', opacity: 1 }
            })
          }
          tmp.src = src
        }
      }
      reader.readAsDataURL(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [selected, screenshot.id, screenshot.image, width, height, addOverlay, updateScreenshot])

  // Background style
  const bgStyle = (() => {
    const bg = screenshot.background
    if (bg.type === 'solid') return { background: bg.color1 }
    if (bg.type === 'gradient') return {
      background: `linear-gradient(${bg.angle}deg, ${bg.color1}, ${bg.color2})`
    }
    if (bg.type === 'image' && bg.image) return {
      backgroundImage: `url(${bg.image})`,
      backgroundSize: bg.imageFit || 'cover',
      backgroundPosition: 'center'
    }
    return { background: bg.color1 }
  })()

  const padding = screenshot.padding
  const textBottom = screenshot.text.textAreaHeight
  const device = screenshot.device
  const deviceWidth = computeDeviceWidth(screenshot, exportSize)
  const screenBounds = computeScreenBounds(screenshot, exportSize, deviceWidth)

  // Text block transform for the language currently on screen.
  const textTf = resolveTextTransform(screenshot, activeLanguage, languages)
  const textUnlocked = isVariantUnlocked(screenshot, activeLanguage, languages)
  const textIsPrimary = isPrimaryLanguage(activeLanguage, languages)
  const textOrigin = textTransformOrigin(screenshot.text.textAlign)
  // Emit nothing at all for an untouched block, so pre-feature projects keep the
  // exact non-composited paint path they had before.
  const textTfCss = isIdentityTextTransform(textTf)
    ? undefined
    : `translate(${textTf.x}px, ${textTf.y}px) scale(${textTf.scale}) rotate(${textTf.rotation}deg)`
  const masterLang = (languages[0] || '').toUpperCase()

  /* ---------------- text overflow measurement ---------------- */

  // Webfonts land after first paint and change every measurement, so re-measure
  // once the font set settles rather than trusting the first pass.
  useEffect(() => {
    if (!document.fonts?.ready) return
    let alive = true
    document.fonts.ready.then(() => { if (alive) setFontEpoch(e => e + 1) })
    return () => { alive = false }
  }, [screenshot.text.fontFamily])

  // Everything that can change the rendered height of the text block. Dragging
  // the block changes x/y only, which is deliberately absent — a pan must not
  // force a synchronous layout read on every mousemove.
  const measureKey = JSON.stringify([
    languages,
    languages.map(l => screenshot.texts[l] || null),
    languages.map(l => resolveTextTransform(screenshot, l, languages).scale),
    screenshot.text,
    width, padding.left, padding.right,
    fontEpoch
  ])

  useLayoutEffect(() => {
    const next = {}
    for (const lang of languages) {
      const el = measureRefs.current[lang]
      if (!el) continue
      const scale = resolveTextTransform(screenshot, lang, languages).scale || 1
      next[lang] = {
        // A scaled-down block occupies proportionally less of the fixed area.
        contentHeight: Math.round(el.scrollHeight * scale),
        areaHeight: Math.round(screenshot.text.textAreaHeight),
        scale
      }
    }
    setTextMetrics(screenshot.id, next)
    // measureKey folds in every input above; listing them again would only
    // re-run this on identical values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey, screenshot.id, setTextMetrics])

  const activeFit = textMetrics?.[activeLanguage]
  const textOverflows = isOverflowing(activeFit)

  /* ---------------- image pan / zoom ---------------- */

  const imageScale = Number.isFinite(screenshot.imageScale) ? screenshot.imageScale : 1
  const imageOffset = {
    x: Number(screenshot.imageOffset?.x) || 0,
    y: Number(screenshot.imageOffset?.y) || 0
  }
  // Identity stays untransformed so an untouched frame keeps its old paint path.
  const imageTransform = (imageScale !== 1 || imageOffset.x !== 0 || imageOffset.y !== 0)
    ? `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})`
    : undefined
  const panBounds = imagePanBounds(screenBounds, imgNatural, imageScale)
  const canPan = panBounds.maxX > 0.5 || panBounds.maxY > 0.5

  const onImageMouseDown = (e) => {
    if (e.button !== 0) return
    // Zoom-region selection and crop editing own the cursor while armed; let the
    // event bubble to the frame so they still get their drag.
    if (zoomMode || cropEditingId) return
    e.stopPropagation()
    e.preventDefault()
    selectScreenshot(screenshot.id)
    selectOverlay(null)
    if (!canPan) return

    const start = { cx: e.clientX, cy: e.clientY, x: imageOffset.x, y: imageOffset.y, moved: false }
    const onMove = (ev) => {
      if (!start.moved) {
        if (Math.abs(ev.clientX - start.cx) < 3 && Math.abs(ev.clientY - start.cy) < 3) return
        start.moved = true
        setImagePanning(true)
      }
      // Mouse deltas are screen pixels; the frame renders at export resolution.
      let dx = (ev.clientX - start.cx) / displayScale
      let dy = (ev.clientY - start.cy) / displayScale
      if (ev.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      updateScreenshot(screenshot.id, {
        imageOffset: clampImageOffset({ x: start.x + dx, y: start.y + dy }, panBounds)
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setImagePanning(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ---------------- text block drag ---------------- */

  // Drag the text block on canvas. Mouse deltas are screen pixels; the frame is
  // rendered at export resolution, so divide by displayScale to get canvas pixels.
  const onTextMouseDown = (e) => {
    if (e.button !== 0) return
    // Zoom / crop selection own the cursor while they're armed.
    if (zoomMode || cropEditingId) return
    if (!textIsPrimary && !textUnlocked) {
      // Mirrored: refuse to move anything and offer the unlock instead.
      setAskUnlock(true)
      return
    }
    const start = { cx: e.clientX, cy: e.clientY, x: textTf.x, y: textTf.y, moved: false }
    const onMove = (ev) => {
      if (!start.moved) {
        // A click with no travel must still fall through to the deselect handler.
        if (Math.abs(ev.clientX - start.cx) < 3 && Math.abs(ev.clientY - start.cy) < 3) return
        start.moved = true
        setTextDragging(true)
      }
      let dx = (ev.clientX - start.cx) / displayScale
      let dy = (ev.clientY - start.cy) / displayScale
      if (ev.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      setTextTransform(screenshot.id, activeLanguage, languages, {
        x: Math.round(start.x + dx),
        y: Math.round(start.y + dy)
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTextDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Click handler to start zoom selection (or crop edit)
  const onFrameMouseDown = (e) => {
    selectScreenshot(screenshot.id)
    const editingThisCrop = cropEditingId &&
      screenshot.overlays.some(o => o.id === cropEditingId)

    if ((zoomMode && imgNatural) || (editingThisCrop && imgNatural)) {
      const rect = frameRef.current.getBoundingClientRect()
      const startX = (e.clientX - rect.left) / displayScale
      const startY = (e.clientY - rect.top) / displayScale
      setZoomDrag({ x: startX, y: startY, w: 0, h: 0 })
      const onMove = (ev) => {
        const x2 = (ev.clientX - rect.left) / displayScale
        const y2 = (ev.clientY - rect.top) / displayScale
        setZoomDrag({
          x: Math.min(startX, x2),
          y: Math.min(startY, y2),
          w: Math.abs(x2 - startX),
          h: Math.abs(y2 - startY)
        })
      }
      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const x2 = (ev.clientX - rect.left) / displayScale
        const y2 = (ev.clientY - rect.top) / displayScale
        const finalRect = {
          x: Math.min(startX, x2),
          y: Math.min(startY, y2),
          w: Math.abs(x2 - startX),
          h: Math.abs(y2 - startY)
        }
        setZoomDrag(null)
        if (finalRect.w > 20 && finalRect.h > 20) {
          if (editingThisCrop) {
            updateCrop(cropEditingId, finalRect)
            setCropEditing(null)
          } else {
            createZoomOverlay(finalRect)
            setZoomMode(false)
          }
        } else {
          setZoomMode(false)
          setCropEditing(null)
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    } else if (e.target === frameRef.current || e.target.dataset?.deselect === 'true') {
      selectOverlay(null)
    }
  }

  // Update the srcRect of an existing zoom overlay based on a new canvas-pixel rectangle.
  const updateCrop = (overlayId, canvasRect) => {
    if (!imgNatural || !screenBounds) return
    const localX = (canvasRect.x - screenBounds.x) / screenBounds.w
    const localY = (canvasRect.y - screenBounds.y) / screenBounds.h
    const localW = canvasRect.w / screenBounds.w
    const localH = canvasRect.h / screenBounds.h
    const cx = Math.max(0, localX)
    const cy = Math.max(0, localY)
    const cw = Math.min(1 - cx, localW)
    const ch = Math.min(1 - cy, localH)
    if (cw <= 0 || ch <= 0) return
    updateOverlayStore(screenshot.id, overlayId, {
      srcRect: {
        x: cx * imgNatural.naturalWidth,
        y: cy * imgNatural.naturalHeight,
        w: cw * imgNatural.naturalWidth,
        h: ch * imgNatural.naturalHeight
      }
    })
  }

  // Convert a canvas-pixel rectangle into a srcRect in the source image's coords
  // and create a zoom overlay positioned just to the side of that rect.
  const createZoomOverlay = (canvasRect) => {
    if (!imgNatural || !screenBounds) return
    // Figure out which portion of the source image the rect corresponds to.
    // We assume the dropped image covers the entire screen of the device proportionally.
    const localX = (canvasRect.x - screenBounds.x) / screenBounds.w
    const localY = (canvasRect.y - screenBounds.y) / screenBounds.h
    const localW = canvasRect.w / screenBounds.w
    const localH = canvasRect.h / screenBounds.h
    const srcX = Math.max(0, localX) * imgNatural.naturalWidth
    const srcY = Math.max(0, localY) * imgNatural.naturalHeight
    const srcW = Math.min(1 - Math.max(0, localX), localW) * imgNatural.naturalWidth
    const srcH = Math.min(1 - Math.max(0, localY), localH) * imgNatural.naturalHeight
    if (srcW <= 0 || srcH <= 0) return

    // place overlay enlarged 1.6x and offset to the right (or left if no room)
    const enlarge = 1.6
    let ow = canvasRect.w * enlarge
    let oh = canvasRect.h * enlarge
    let ox = canvasRect.x + canvasRect.w * 0.4
    let oy = canvasRect.y - canvasRect.h * 0.2
    if (ox + ow > exportSize.width - 20) ox = exportSize.width - ow - 20
    if (oy + oh > exportSize.height - 20) oy = exportSize.height - oh - 20
    if (ox < 20) ox = 20
    if (oy < 20) oy = 20

    addOverlay(screenshot.id, {
      type: 'zoom',
      x: ox, y: oy, w: ow, h: oh,
      srcRect: { x: srcX, y: srcY, w: srcW, h: srcH },
      rotation: 0,
      radius: 28,
      shadow: { y: 24, blur: 60, opacity: 0.4 },
      border: { width: 6, color: '#ffffff', opacity: 1 }
    })
  }

  /* ---------------- frame name ---------------- */

  useEffect(() => {
    if (!editingName) return
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }, [editingName])

  const startRename = () => {
    setDraftName(screenshot.name)
    setEditingName(true)
  }

  const commitName = () => {
    const next = draftName.trim()
    if (next && next !== screenshot.name) updateScreenshot(screenshot.id, { name: next })
    setEditingName(false)
  }

  const onNameKeyDown = (e) => {
    // Both keys are global shortcuts elsewhere; renaming owns them while open.
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      commitName()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setEditingName(false)
    }
  }

  const move = (delta) => reorderScreenshot(screenshot.id, index + delta)

  const showTextBox = textHover || textDragging
  const showTextChrome = showTextBox || textUnlocked || textOverflows

  // A project can name a font this machine doesn't have. Nothing about the frame looks broken —
  // it just quietly draws the fallback, and exports it. Say so before the PNG is on disk.
  const { family: textFamily, available: fontAvailable } = useFamilyAvailable(screenshot.text.fontFamily)

  return (
    <div className={'screenshot-card' + (selected ? ' selected' : '')}
         style={{ width: width * displayScale, height: height * displayScale }}>
      <div className="frame-header">
        {editingName ? (
          <input
            ref={nameInputRef}
            className="text frame-name-input"
            value={draftName}
            maxLength={64}
            aria-label={`Rename frame ${screenshot.name}`}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={onNameKeyDown}
            onBlur={commitName}
          />
        ) : (
          <button
            type="button"
            className="frame-name"
            title="Click to rename"
            aria-label={`Frame ${index + 1} of ${count}: ${screenshot.name}. Click to rename.`}
            onClick={(e) => { e.stopPropagation(); startRename() }}
          >
            {screenshot.name}
          </button>
        )}
        <div className="actions">
          <button className="btn small ghost" disabled={index === 0}
                  aria-label={`Move ${screenshot.name} left`} title="Move left"
                  onClick={(e) => { e.stopPropagation(); move(-1) }}>◀</button>
          <button className="btn small ghost" disabled={index >= count - 1}
                  aria-label={`Move ${screenshot.name} right`} title="Move right"
                  onClick={(e) => { e.stopPropagation(); move(1) }}>▶</button>
          <button className="btn small ghost" aria-label={`Duplicate ${screenshot.name}`}
                  onClick={(e) => { e.stopPropagation(); duplicateScreenshot(screenshot.id) }}>Dup</button>
          <button className="btn small danger" aria-label={`Delete ${screenshot.name}`}
                  onClick={(e) => { e.stopPropagation(); setAskDelete(true) }}>Del</button>
        </div>
      </div>
      <div className="screenshot-frame-wrapper" style={{ width: width * displayScale, height: height * displayScale }}>
        <div
          className="screenshot-frame"
          ref={frameRef}
          data-export-id={screenshot.id}
          style={{
            width, height,
            transform: `scale(${displayScale})`,
            ...bgStyle,
            cursor: (zoomMode || cropEditingId) ? 'crosshair' : 'default'
          }}
          onClick={() => selectScreenshot(screenshot.id)}
          onMouseDown={onFrameMouseDown}
        >
          {/* Text area — top-anchored under padding.top */}
          <div
            className="text-area"
            data-deselect="true"
            onMouseDown={onTextMouseDown}
            onMouseEnter={() => setTextHover(true)}
            onMouseLeave={() => setTextHover(false)}
            style={{
              left: padding.left,
              right: padding.right,
              top: padding.top,
              width: width - padding.left - padding.right,
              height: screenshot.text.textAreaHeight,
              fontFamily: screenshot.text.fontFamily,
              textAlign: screenshot.text.textAlign,
              transform: textTfCss,
              transformOrigin: textTfCss ? textOrigin : undefined,
              cursor: (zoomMode || cropEditingId) ? 'crosshair' : 'move'
            }}
          >
            <TextBlock text={screenshot.text} content={t} />
          </div>

          {/* Device + dropped image — pushed down by padding.top + textAreaHeight */}
          <div
            className="image-area"
            data-deselect="true"
            style={{
              position: 'absolute',
              left: padding.left,
              right: padding.right,
              top: padding.top + textBottom,
              bottom: padding.bottom,
              width: width - padding.left - padding.right,
              height: height - padding.top - textBottom - padding.bottom,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start'
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {!screenshot.image ? (
              <label className={'drop-zone' + (isDragOver ? ' over' : '')}>
                <span>Drop screenshot<br/><span style={{fontSize:32, opacity:0.6}}>or click to upload</span></span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileInput} />
              </label>
            ) : (
              <DeviceFrame
                type={device.type}
                color={device.color}
                showButtons={device.showButtons}
                shadow={device.shadow}
                frameWidth={deviceWidth}
              >
                <img
                  src={screenshot.image}
                  alt=""
                  draggable={false}
                  onMouseDown={onImageMouseDown}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    // `cover` stays the base fit; pan/zoom composes on top of it,
                    // so scale 1 / offset 0 paints exactly as it always did.
                    transform: imageTransform,
                    transformOrigin: 'center center',
                    cursor: (zoomMode || cropEditingId)
                      ? 'crosshair'
                      : canPan ? (imagePanning ? 'grabbing' : 'grab') : 'default'
                  }}
                />
              </DeviceFrame>
            )}
          </div>

          {/* Overlays */}
          <div className="overlays-layer">
            {screenshot.overlays.map(o => (
              <Overlay
                key={o.id}
                overlay={o}
                screenshot={screenshot}
                scale={displayScale}
                selected={selectedOverlayId === o.id}
                onSelect={selectOverlay}
                sourceImage={imgNatural}
              />
            ))}
          </div>

          {/* Source-rect outline for selected zoom overlays */}
          {imgNatural && screenBounds && screenshot.overlays
            .filter(o => o.type === 'zoom' && (selectedOverlayId === o.id || cropEditingId === o.id))
            .map(o => {
              const sb = screenBounds
              const x = sb.x + (o.srcRect.x / imgNatural.naturalWidth) * sb.w
              const y = sb.y + (o.srcRect.y / imgNatural.naturalHeight) * sb.h
              const w = (o.srcRect.w / imgNatural.naturalWidth) * sb.w
              const h = (o.srcRect.h / imgNatural.naturalHeight) * sb.h
              return (
                <div key={o.id} style={{
                  position: 'absolute',
                  left: x, top: y, width: w, height: h,
                  border: '4px solid #4a7cff',
                  background: 'rgba(74,124,255,0.10)',
                  pointerEvents: 'none',
                  borderRadius: 6
                }}/>
              )
            })}

          {/* Zoom drag rectangle */}
          {zoomDrag && (
            <div className="zoom-selector" style={{
              left: zoomDrag.x, top: zoomDrag.y,
              width: zoomDrag.w, height: zoomDrag.h
            }}/>
          )}
        </div>

        {/*
          Canvas chrome for the text block. Deliberately a SIBLING of
          .screenshot-frame: the exporter captures [data-export-id] only, so
          nothing rendered here can ever reach a PNG. It mirrors the frame's
          `scale(displayScale)` so its children can use canvas coordinates.
        */}
        {showTextChrome && (
          <div
            className="text-chrome-layer"
            style={{ width, height, transform: `scale(${displayScale})` }}
          >
            <div
              className={'text-chrome-box' + (textOverflows ? ' is-overflow' : '')}
              style={{
                left: padding.left,
                top: padding.top,
                width: width - padding.left - padding.right,
                height: screenshot.text.textAreaHeight,
                transform: textTfCss,
                transformOrigin: textTfCss ? textOrigin : undefined,
                // Chrome should read at a constant on-screen weight at any zoom.
                outlineWidth: (showTextBox || textOverflows) ? 2 / displayScale : 0
              }}
            >
              {textUnlocked && (
                <div
                  className="text-unlinked-badge"
                  style={{
                    transform: `scale(${1 / (displayScale * (textTf.scale || 1))}) rotate(${-textTf.rotation}deg)`
                  }}
                >
                  ⛓ {activeLanguage.toUpperCase()} unlinked
                </div>
              )}
              {textOverflows && (
                <div
                  className="text-overflow-badge"
                  style={{
                    transform: `scale(${1 / (displayScale * (textTf.scale || 1))}) rotate(${-textTf.rotation}deg)`
                  }}
                >
                  ⚠ {activeLanguage.toUpperCase()} overflows by {overflowAmount(activeFit)}px
                </div>
              )}
            </div>
          </div>
        )}

        {/*
          Missing-font badge. Same layer rule as the text chrome above: a sibling of
          .screenshot-frame, so it cannot reach a PNG. Unscaled, because it's a UI label
          about the frame rather than something positioned in canvas coordinates.
        */}
        {fontAvailable === false && (
          <div className="frame-font-warning" role="status">
            <span aria-hidden="true">⚠</span>
            <span>“{textFamily}” isn’t installed — exporting a fallback</span>
          </div>
        )}

        {/*
          Off-screen measuring copies — one per language, at canvas scale.
          Also a sibling of .screenshot-frame, for the same export-purity reason.
          `visibility: hidden` still lays out, which is the whole point.
        */}
        <div className="text-measure-layer" aria-hidden="true">
          {languages.map(lang => (
            <div
              key={lang}
              ref={(el) => { measureRefs.current[lang] = el }}
              className="text-measure-block"
              style={{
                width: width - padding.left - padding.right,
                fontFamily: screenshot.text.fontFamily,
                textAlign: screenshot.text.textAlign
              }}
            >
              <TextBlock text={screenshot.text} content={screenshot.texts[lang] || {}} />
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={askUnlock}
        title={`"${activeLanguage.toUpperCase()}" text is mirrored to "${masterLang}"`}
        message="Position, scale and rotation currently follow the master. Unlock this language to adjust it on its own? Wording stays synced either way."
        confirmLabel={`Unlock ${activeLanguage.toUpperCase()}`}
        onConfirm={() => {
          unlockTextVariant(screenshot.id, activeLanguage)
          setAskUnlock(false)
        }}
        onCancel={() => setAskUnlock(false)}
      />

      <ConfirmDialog
        open={askDelete}
        title={`Delete "${screenshot.name}"?`}
        message="The frame and every language variant of its text go with it. This can't be undone."
        confirmLabel="Delete frame"
        danger
        onConfirm={() => { setAskDelete(false); removeScreenshot(screenshot.id) }}
        onCancel={() => setAskDelete(false)}
      />
    </div>
  )
}

// The rendered text block. Shared by the real canvas and the hidden measuring
// copies — if these ever drift apart the overflow warning starts lying.
function TextBlock({ text, content }) {
  const m = readTextMetrics(text)
  const c = content || {}
  return (
    <>
      <TextRender
        text={c.preheader}
        primaryColor={text.primaryColor}
        secondaryColor={text.secondaryColor}
        style={{
          fontSize: text.preheaderSize,
          fontWeight: text.preheaderWeight,
          letterSpacing: `${m.preheaderTracking}em`,
          textTransform: 'uppercase',
          marginBottom: m.preheaderGap,
          textAlign: text.textAlign
        }}
      />
      <TextRender
        text={c.heading}
        primaryColor={text.primaryColor}
        secondaryColor={text.secondaryColor}
        style={{
          fontSize: text.headingSize,
          fontWeight: text.headingWeight,
          lineHeight: m.headingLineHeight,
          textAlign: text.textAlign
        }}
      />
    </>
  )
}
