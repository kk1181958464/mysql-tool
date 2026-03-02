import React, { useEffect, useState } from 'react'
import { Button, Modal } from '../../components/ui'
import { ConnectionList } from './ConnectionList'
import { ConnectionForm } from './ConnectionForm'
import { useConnectionStore } from '../../stores/connection.store'
import type { ConnectionConfig } from '../../../../shared/types/connection'

interface Props {
  open: boolean
  onClose: () => void
  initialEditing?: ConnectionConfig | null
}

export const ConnectionManager: React.FC<Props> = ({ open, onClose, initialEditing }) => {
  const [editing, setEditing] = useState<ConnectionConfig | null>(null)
  const [previewColor, setPreviewColor] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const { loadConnections } = useConnectionStore()

  useEffect(() => {
    if (open) {
      loadConnections()
      if (initialEditing) {
        setEditing(initialEditing)
        setPreviewColor(null)
        setFormKey((k) => k + 1)
      }
    }
  }, [open, initialEditing])

  const handleNew = () => {
    setEditing(null)
    setPreviewColor(null)
    setFormKey((k) => k + 1) // 强制重新挂载表单
  }

  return (
    <Modal
      open={open}
      title="连接管理"
      width={900}
      onClose={onClose}
      footer={null}
    >
      <div style={{ display: 'flex', height: 500 }}>
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 16 }}>
          <ConnectionList
            onSelect={(conn) => {
              setEditing(conn)
              setPreviewColor(null)
            }}
            onNew={handleNew}
            onClose={onClose}
            selectedId={editing?.id}
            previewColor={previewColor}
          />
        </div>
        <div style={{ flex: 1, overflow: 'hidden', padding: 16, display: 'flex', flexDirection: 'column' }}>
          <ConnectionForm
            key={formKey}
            editing={editing}
            onSaved={() => {
              loadConnections()
              setPreviewColor(null)
              setEditing(null)
            }}
            onClose={onClose}
            onPreviewColor={(color) => setPreviewColor(color)}
          />
        </div>
      </div>
    </Modal>
  )
}

export default ConnectionManager
