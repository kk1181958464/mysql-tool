import React, { useMemo, useState } from 'react'
import { Modal, Tag, Button, Alert } from '../../components/ui'
import { useAppStore } from '../../stores/app.store'
import { useConnectionStore } from '../../stores/connection.store'
import { api } from '../../utils/ipc'
import type { TableDesign, ColumnDesign } from '../../../../shared/types/table-design'

interface Props {
  open: boolean
  onClose: () => void
  original: TableDesign
  current: TableDesign
}

export const StructureDiff: React.FC<Props> = ({ open, onClose, original, current }) => {
  const { selectedDatabase } = useAppStore()
  const { activeConnectionId } = useConnectionStore()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const diff = useMemo(() => {
    const origColMap = new Map(original.columns.map((c) => [c.name, c]))
    const currColMap = new Map(current.columns.map((c) => [c.name, c]))
    const added = current.columns.filter((c) => !origColMap.has(c.name))
    const removed = original.columns.filter((c) => !currColMap.has(c.name))
    const modified = current.columns.filter((c) => {
      const orig = origColMap.get(c.name)
      return orig && JSON.stringify(orig) !== JSON.stringify(c)
    })
    return { added, removed, modified }
  }, [original, current])

  const generateAlterSQL = (): string => {
    const lines: string[] = []
    const tbl = `\`${current.name}\``
    for (const col of diff.removed) lines.push(`ALTER TABLE ${tbl} DROP COLUMN \`${col.name}\`;`)
    for (const col of diff.added) {
      let def = `\`${col.name}\` ${col.type}`
      if (col.length) def += `(${col.length}${col.decimals ? `,${col.decimals}` : ''})`
      if (col.unsigned) def += ' UNSIGNED'
      if (!col.nullable) def += ' NOT NULL'
      if (col.autoIncrement) def += ' AUTO_INCREMENT'
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`
      if (col.comment) def += ` COMMENT '${col.comment}'`
      lines.push(`ALTER TABLE ${tbl} ADD COLUMN ${def};`)
    }
    for (const col of diff.modified) {
      let def = `\`${col.name}\` ${col.type}`
      if (col.length) def += `(${col.length}${col.decimals ? `,${col.decimals}` : ''})`
      if (col.unsigned) def += ' UNSIGNED'
      if (!col.nullable) def += ' NOT NULL'
      if (col.autoIncrement) def += ' AUTO_INCREMENT'
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`
      if (col.comment) def += ` COMMENT '${col.comment}'`
      lines.push(`ALTER TABLE ${tbl} MODIFY COLUMN ${def};`)
    }
    if (original.engine !== current.engine) lines.push(`ALTER TABLE ${tbl} ENGINE=${current.engine};`)
    if (original.charset !== current.charset) lines.push(`ALTER TABLE ${tbl} DEFAULT CHARSET=${current.charset};`)
    if (original.comment !== current.comment) lines.push(`ALTER TABLE ${tbl} COMMENT='${current.comment}';`)
    return lines.join('\n') || '-- 无变更'
  }

  const alterSQL = useMemo(generateAlterSQL, [diff, original, current])

  const handleApply = async () => {
    if (!activeConnectionId || !selectedDatabase) return
    try {
      await api.design.alterTable(activeConnectionId, selectedDatabase, current.name, current)
      setSuccess('变更已应用')
      setTimeout(() => { setSuccess(null); onClose() }, 1500)
    } catch (e: any) {
      setError(e.message || '应用失败')
    }
  }

  const renderCol = (col: ColumnDesign, bg: string) => (
    <div key={col.name} style={{ padding: '2px 8px', background: bg, borderRadius: 2, marginBottom: 2, fontSize: 12 }}>
      <code>{col.name}</code> {col.type}{col.length ? `(${col.length})` : ''} {col.nullable ? 'NULL' : 'NOT NULL'}
    </div>
  )

  return (
    <Modal title="结构差异" open={open} onClose={onClose} width={700}
      footer={<><Button onClick={onClose}>关闭</Button><Button type="primary" onClick={handleApply}>应用变更</Button></>}>
      {error && <Alert type="error" message={error} onClose={() => setError(null)} style={{ marginBottom: 12 }} />}
      {success && <Alert type="success" message={success} style={{ marginBottom: 12 }} />}
      <div style={{ marginBottom: 16 }}>
        {diff.added.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <Tag type="success">新增列 ({diff.added.length})</Tag>
            {diff.added.map((c) => renderCol(c, 'var(--success-bg, rgba(82,196,26,0.1))'))}
          </div>
        )}
        {diff.removed.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <Tag type="error">删除列 ({diff.removed.length})</Tag>
            {diff.removed.map((c) => renderCol(c, 'var(--error-bg, rgba(255,77,79,0.1))'))}
          </div>
        )}
        {diff.modified.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <Tag type="warning">修改列 ({diff.modified.length})</Tag>
            {diff.modified.map((c) => renderCol(c, 'var(--warning-bg, rgba(250,173,20,0.1))'))}
          </div>
        )}
        {diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>无列变更</span>
        )}
      </div>
      <div>
        <strong>ALTER SQL:</strong>
        <pre style={{ background: 'var(--bg-hover)', padding: 12, borderRadius: 4, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', maxHeight: 300, marginTop: 8 }}>
          {alterSQL}
        </pre>
      </div>
    </Modal>
  )
}
