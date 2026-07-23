import React from 'react'
import { parseText } from '../utils/text'

export default function TextRender({ text, primaryColor, secondaryColor, italicWeight, style }) {
  const lines = parseText(text)
  return (
    <div style={style}>
      {lines.map((parts, li) => (
        <div key={li}>
          {parts.length === 0 ? ' ' : parts.map((p, i) => (
            <span
              key={i}
              style={{
                color: p.italic ? secondaryColor : primaryColor,
                fontStyle: p.italic ? 'italic' : 'normal',
                fontWeight: p.italic && italicWeight ? italicWeight : 'inherit'
              }}
            >{p.text || (parts.length === 1 ? ' ' : '')}</span>
          ))}
        </div>
      ))}
    </div>
  )
}
