import React from 'react'

// All values are proportional to the frame width (in unitless multiples).
// frameWidth is the on-canvas pixel width; everything else scales from it.
// Two-bezel structure (outer = colored metal frame, inner = thin black ring),
// matching modern iPhones. All sizes are fractions of `frameWidth`.
const SPECS = {
  'iphone-pro': {
    aspect: 19.5 / 9,
    outerBezel: 0.020,         // colored metal rim thickness
    innerBezel: 0.020,         // black bezel between rim and screen
    bodyRadius: 0.115,
    midRadius: 0.098,
    screenRadius: 0.082,
    island: { w: 0.295, h: 0.055, top: 0.030, radius: 0.028 },
    notch: null,
    sideButtons: [
      { side: 'left',  topPct: 0.13, lenPct: 0.045 },
      { side: 'left',  topPct: 0.20, lenPct: 0.075 },
      { side: 'left',  topPct: 0.29, lenPct: 0.075 },
      { side: 'right', topPct: 0.22, lenPct: 0.105 }
    ]
  },
  'iphone-notch': {
    aspect: 19.5 / 9,
    outerBezel: 0.020,
    innerBezel: 0.024,
    bodyRadius: 0.115,
    midRadius: 0.098,
    screenRadius: 0.078,
    island: null,
    notch: { w: 0.42, h: 0.035, radius: 0.018 },
    sideButtons: [
      { side: 'left',  topPct: 0.10, lenPct: 0.04 },
      { side: 'left',  topPct: 0.16, lenPct: 0.07 },
      { side: 'left',  topPct: 0.24, lenPct: 0.07 },
      { side: 'right', topPct: 0.18, lenPct: 0.10 }
    ]
  },
  'android': {
    aspect: 20 / 9,
    outerBezel: 0.018,
    innerBezel: 0.012,
    bodyRadius: 0.085,
    midRadius: 0.072,
    screenRadius: 0.060,
    island: null,
    notch: null,
    cameraHole: { dia: 0.04, top: 0.02 },
    sideButtons: [
      { side: 'right', topPct: 0.16, lenPct: 0.07 },
      { side: 'right', topPct: 0.25, lenPct: 0.11 }
    ]
  },
  // Modern iPad (no home button): uniform thin bezels, gently rounded corners,
  // a single front-camera dot on the short top edge, slim volume keys near the
  // top-right. Bezels/radii are a much smaller fraction of width than a phone's,
  // which is what reads as "tablet" rather than "big phone". Screen aspect lands
  // near a 11"/Air panel once the uniform bezel is inset.
  'ipad': {
    aspect: 1.40,
    outerBezel: 0.016,       // thin aluminium edge
    innerBezel: 0.034,       // the visible uniform black bezel
    bodyRadius: 0.052,
    midRadius: 0.044,
    screenRadius: 0.034,
    island: null,
    notch: null,
    cameraHole: { dia: 0.013, top: 0.017 },
    sideButtons: [
      { side: 'right', topPct: 0.018, lenPct: 0.05 },
      { side: 'right', topPct: 0.078, lenPct: 0.045 }
    ]
  }
}

// DeviceFrame renders at native pixel size (frameWidth × computed height).
// Children are clipped to the screen rectangle.
export default function DeviceFrame({
  type = 'iphone-pro',
  color = '#1d1d1f',
  showButtons = true,
  shadow = true,
  frameWidth,
  children,
  style = {}
}) {
  if (type === 'none' || !SPECS[type]) {
    return <div style={{ width: frameWidth, ...style }}>{children}</div>
  }
  const spec = SPECS[type]
  const w = frameWidth
  const h = w * spec.aspect
  const outerBezel = w * spec.outerBezel
  const innerBezel = w * spec.innerBezel
  const bodyR = w * spec.bodyRadius
  const midR = w * spec.midRadius
  const screenR = w * spec.screenRadius

  return (
    <div style={{
      position: 'relative',
      width: w,
      height: h,
      boxShadow: shadow ? '0 24px 60px rgba(0,0,0,0.35), 0 8px 16px rgba(0,0,0,0.18)' : 'none',
      borderRadius: bodyR,
      ...style
    }}>
      {/* Outer colored metal frame */}
      <div style={{
        position: 'absolute', inset: 0,
        background: color,
        borderRadius: bodyR,
        overflow: 'hidden'
      }}>
        {/* subtle inner highlight on the metal */}
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: bodyR,
          boxShadow:
            'inset 0 0 0 ' + (w*0.003) + 'px rgba(255,255,255,0.10),' +
            'inset 0 ' + (w*0.006) + 'px ' + (w*0.012) + 'px rgba(255,255,255,0.12),' +
            'inset 0 -' + (w*0.006) + 'px ' + (w*0.012) + 'px rgba(0,0,0,0.18)',
          pointerEvents: 'none'
        }}/>
      </div>

      {/* Inner black bezel ring */}
      <div style={{
        position: 'absolute',
        top: outerBezel, left: outerBezel,
        right: outerBezel, bottom: outerBezel,
        background: '#000',
        borderRadius: midR
      }}/>

      {/* Screen */}
      <div style={{
        position: 'absolute',
        top: outerBezel + innerBezel,
        left: outerBezel + innerBezel,
        right: outerBezel + innerBezel,
        bottom: outerBezel + innerBezel,
        borderRadius: screenR,
        overflow: 'hidden',
        background: '#000'
      }}>
        {children}

        {/* Dynamic Island */}
        {spec.island && (
          <div style={{
            position: 'absolute',
            top: w * spec.island.top,
            left: '50%',
            transform: 'translateX(-50%)',
            width: w * spec.island.w,
            height: w * spec.island.h,
            background: '#000',
            borderRadius: w * spec.island.radius,
            zIndex: 2
          }}/>
        )}

        {/* Notch */}
        {spec.notch && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: w * spec.notch.w,
            height: w * spec.notch.h,
            background: '#000',
            borderBottomLeftRadius: w * spec.notch.radius,
            borderBottomRightRadius: w * spec.notch.radius,
            zIndex: 2
          }}/>
        )}

        {/* Android camera hole */}
        {spec.cameraHole && (
          <div style={{
            position: 'absolute',
            top: w * spec.cameraHole.top,
            left: '50%',
            transform: 'translateX(-50%)',
            width: w * spec.cameraHole.dia,
            height: w * spec.cameraHole.dia,
            background: '#000',
            borderRadius: '50%',
            zIndex: 2
          }}/>
        )}
      </div>

      {/* Side buttons */}
      {showButtons && spec.sideButtons.map((b, i) => {
        const top = h * b.topPct
        const len = h * b.lenPct
        const thickness = w * 0.008
        const sideOffset = -thickness * 0.5
        return (
          <div key={i} style={{
            position: 'absolute',
            top,
            [b.side]: sideOffset,
            width: thickness,
            height: len,
            background: shade(color, -10),
            borderRadius: thickness * 0.5
          }}/>
        )
      })}
    </div>
  )
}

function shade(hex, amt) {
  // amt in percent; negative darkens
  const m = hex.replace('#','').match(/.{2}/g)
  if (!m) return hex
  const [r, g, b] = m.map(x => parseInt(x, 16))
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt/100))))
  return '#' + [adj(r), adj(g), adj(b)].map(v => v.toString(16).padStart(2,'0')).join('')
}

export { SPECS as DEVICE_SPECS }
