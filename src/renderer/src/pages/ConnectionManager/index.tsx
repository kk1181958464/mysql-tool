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
  const [previewIcon, setPreviewIcon] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const { loadConnections } = useConnectionStore()

  useEffect(() => {
    if (open) {
      loadConnections()
      if (initialEditing) {
        setEditing(initialEditing)
        setPreviewColor(null)
        setPreviewIcon(null)
        setFormKey((k) => k + 1)
      }
    }
  }, [open, initialEditing])

  const handleNew = () => {
    setEditing(null)
    setPreviewColor(null)
    setPreviewIcon(null)
    setFormKey((k) => k + 1) // 强制重新挂载表单
  }

  return (
    <Modal
      open={open}
      title="连接管理"
      width={980}
      onClose={onClose}
      footer={null}
      className="cm-modal"
    >
      <div className="cm-layout">
        <div className="cm-side">
          <ConnectionList
            onSelect={(conn) => {
              setEditing(conn)
              setPreviewColor(null)
              setPreviewIcon(null)
            }}
            onNew={handleNew}
            onClose={onClose}
            selectedId={editing?.id}
            previewColor={previewColor}
            previewIcon={previewIcon}
          />
        </div>
        <div className="cm-main">
          <ConnectionForm
            key={formKey}
            editing={editing}
            onSaved={() => {
              loadConnections()
              setPreviewColor(null)
              setPreviewIcon(null)
              setEditing(null)
            }}
            onClose={onClose}
            onPreviewColor={(color) => setPreviewColor(color)}
            onPreviewIcon={(icon) => setPreviewIcon(icon)}
          />
        </div>
      </div>
    </Modal>
  )
}

export default ConnectionManager
