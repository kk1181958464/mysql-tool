import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  value?: string // 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss'
  dateOnly?: boolean
  anchorRect?: { left: number; top: number; bottom: number } // 锚点位置
  onConfirm: (val: string) => void
  onCancel: () => void
}

const pad2 = (n: number) => n.toString().padStart(2, '0')
const DAYS = ['日', '一', '二', '三', '四', '五', '六']
const MONTHS = Array.from({ length: 12 }, (_, i) => i)

function parseDateStr(s: string | undefined): { y: number; m: number; d: number; h: number; mi: number; se: number } {
  const now = new Date()
  if (!s) return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate(), h: 0, mi: 0, se: 0 }
  const parts = s.split(/[\sT]/)
  const [y, m, d] = (parts[0] || '').split('-').map(Number)
  const [h, mi, se] = (parts[1] || '0:0:0').split(':').map(Number)
  return {
    y: y || now.getFullYear(), m: (m || 1) - 1, d: d || 1,
    h: h || 0, mi: mi || 0, se: se || 0,
  }
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

export function DateTimePicker({ value, dateOnly, anchorRect, onConfirm, onCancel }: Props) {
  const init = parseDateStr(value)
  const [year, setYear] = useState(init.y)
  const [month, setMonth] = useState(init.m)
  const [day, setDay] = useState(init.d)
  const [hour, setHour] = useState(init.h)
  const [minute, setMinute] = useState(init.mi)
  const [second, setSecond] = useState(init.se)
  const panelRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onCancel()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onCancel])

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfWeek(year, month)
  // 修正day越界
  const safeDay = Math.min(day, daysInMonth)

  const handleConfirm = useCallback(() => {
    const result = dateOnly
      ? `${year}-${pad2(month + 1)}-${pad2(safeDay)}`
      : `${year}-${pad2(month + 1)}-${pad2(safeDay)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
    onConfirm(result)
  }, [year, month, safeDay, hour, minute, second, dateOnly, onConfirm])

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(i)

  const S: Record<string, React.CSSProperties> = {
    panel: {
      position: 'fixed', zIndex: 9999, background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', padding: 8, width: 260, userSelect: 'none',
      left: anchorRect?.left ?? 0,
      top: (() => {
        if (!anchorRect) return 0
        const panelH = dateOnly ? 280 : 320
        return anchorRect.bottom + panelH > window.innerHeight ? anchorRect.top - panelH : anchorRect.bottom
      })(),
    },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    navBtn: {
      background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, padding: '2px 8px',
    },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' as const },
    weekDay: { fontSize: 10, color: 'var(--text-muted)', padding: 4 },
    dayCell: {
      fontSize: 12, padding: '4px 0', borderRadius: 4, cursor: 'pointer', border: 'none', background: 'transparent',
      color: 'var(--text-primary)',
    },
    daySelected: { background: 'var(--accent)', color: '#fff' },
    dayEmpty: { visibility: 'hidden' as const },
    timeRow: { display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', margin: '6px 0' },
    timeInput: {
      width: 40, textAlign: 'center' as const, padding: '2px 0', border: '1px solid var(--border)',
      borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
    },
    footer: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 },
    btn: {
      padding: '3px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)',
      background: 'var(--bg-surface)', color: 'var(--text-primary)',
    },
    btnPrimary: {
      padding: '3px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', border: '1px solid var(--accent)',
      background: 'var(--accent)', color: '#fff',
    },
  }

  return createPortal(
    <div ref={panelRef} style={S.panel} onMouseDown={e => e.stopPropagation()}>
      {/* 年月导航 */}
      <div style={S.header}>
        <button style={S.navBtn} onClick={() => setYear(y => y - 1)}>«</button>
        <button style={S.navBtn} onClick={prevMonth}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{year}年{month + 1}月</span>
        <button style={S.navBtn} onClick={nextMonth}>›</button>
        <button style={S.navBtn} onClick={() => setYear(y => y + 1)}>»</button>
      </div>
      {/* 星期头 */}
      <div style={S.grid}>
        {DAYS.map(d => <div key={d} style={S.weekDay}>{d}</div>)}
        {cells.map((c, i) => c === null
          ? <div key={`e${i}`} style={S.dayEmpty} />
          : <button key={c} style={{ ...S.dayCell, ...(c === safeDay ? S.daySelected : {}) }}
              onClick={() => setDay(c)}>{c}</button>
        )}
      </div>
      {/* 时分秒 */}
      {!dateOnly && (
        <div style={S.timeRow}>
          <input style={S.timeInput} type="number" min={0} max={23} value={pad2(hour)}
            onChange={e => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} />
          <span style={{ color: 'var(--text-muted)' }}>:</span>
          <input style={S.timeInput} type="number" min={0} max={59} value={pad2(minute)}
            onChange={e => setMinute(Math.max(0, Math.min(59, Number(e.target.value) || 0)))} />
          <span style={{ color: 'var(--text-muted)' }}>:</span>
          <input style={S.timeInput} type="number" min={0} max={59} value={pad2(second)}
            onChange={e => setSecond(Math.max(0, Math.min(59, Number(e.target.value) || 0)))} />
        </div>
      )}
      {/* 按钮 */}
      <div style={S.footer}>
        <button style={S.btn} onClick={onCancel}>取消</button>
        <button style={S.btnPrimary} onClick={handleConfirm}>确定</button>
      </div>
    </div>,
    document.body
  )
}
