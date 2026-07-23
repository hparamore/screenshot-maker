import { DEVICE_SPECS } from '../components/DeviceFrame'

// Width of the device mockup in canvas pixels (fits inside available area).
export function computeDeviceWidth(screenshot, exportSize) {
  const { width, height } = exportSize
  const padding = screenshot.padding
  const textBottom = screenshot.text.textAreaHeight
  const availableW = width - padding.left - padding.right
  const availableH = height - padding.top - textBottom - padding.bottom
  const device = screenshot.device
  let deviceWidth = availableW
  if (device.type !== 'none' && DEVICE_SPECS[device.type]) {
    const aspect = DEVICE_SPECS[device.type].aspect
    const heightAtFullWidth = availableW * aspect
    if (heightAtFullWidth > availableH) {
      deviceWidth = availableH / aspect
    }
  }
  return deviceWidth
}

// Where the dropped image actually sits on the canvas, in canvas pixels.
// (After padding, after text area, inside the device's two-bezel inset if applicable.)
export function computeScreenBounds(screenshot, exportSize, deviceWidth) {
  const { width, height } = exportSize
  const padding = screenshot.padding
  const textBottom = screenshot.text.textAreaHeight
  const device = screenshot.device
  const availableW = width - padding.left - padding.right
  const imageTop = padding.top + textBottom
  const deviceX = padding.left + (availableW - deviceWidth) / 2

  if (device.type === 'none' || !DEVICE_SPECS[device.type]) {
    return {
      x: padding.left,
      y: imageTop,
      w: availableW,
      h: height - padding.top - textBottom - padding.bottom
    }
  }
  const spec = DEVICE_SPECS[device.type]
  const totalBezel = deviceWidth * (spec.outerBezel + spec.innerBezel)
  return {
    x: deviceX + totalBezel,
    y: imageTop + totalBezel,
    w: deviceWidth - totalBezel * 2,
    h: deviceWidth * spec.aspect - totalBezel * 2
  }
}

// How far the dropped image may be panned before a gap opens at an edge.
//
// The image is laid out with `object-fit: cover`, so it already overflows the
// screen box on exactly one axis at scale 1 — this returns that slack, and 0 on
// the other axis. Zooming past 1 adds slack to both. Clamping to these bounds is
// what stops a drag from pushing the screenshot out of the device entirely.
export function imagePanBounds(screenBounds, imgNatural, imageScale = 1) {
  const natW = imgNatural?.naturalWidth
  const natH = imgNatural?.naturalHeight
  if (!screenBounds || !natW || !natH) return { maxX: 0, maxY: 0 }
  const scale = Math.max(0.05, Number(imageScale) || 1)
  const cover = Math.max(screenBounds.w / natW, screenBounds.h / natH)
  const shownW = natW * cover * scale
  const shownH = natH * cover * scale
  return {
    maxX: Math.max(0, (shownW - screenBounds.w) / 2),
    maxY: Math.max(0, (shownH - screenBounds.h) / 2)
  }
}

export function clampImageOffset(offset, bounds) {
  const maxX = bounds?.maxX || 0
  const maxY = bounds?.maxY || 0
  const clamp = (v, max) => Math.round(Math.min(max, Math.max(-max, Number(v) || 0)))
  return { x: clamp(offset?.x, maxX), y: clamp(offset?.y, maxY) }
}

// Given a zoom overlay and the source image's natural pixel size, compute the
// "natural canvas size" of the cropped region — i.e. the size the cropped
// region would occupy on the canvas at 1:1 scale (no zoom applied).
export function cropNaturalCanvasSize(overlay, screenBounds, imgNatural) {
  if (!overlay.srcRect || !imgNatural || !screenBounds) return null
  const w = (overlay.srcRect.w / imgNatural.naturalWidth) * screenBounds.w
  const h = (overlay.srcRect.h / imgNatural.naturalHeight) * screenBounds.h
  return { w, h }
}
