import { useState, useEffect } from 'react'
import { Modal, Input, Select, Button } from './ui'
import { api } from '../utils/ipc'
import { useDatabaseStore } from '../stores/database.store'

interface Props {
  open: boolean
  connectionId: string | null
  onClose: () => void
}

const CHARSETS = [
  'utf8mb4', 'utf8mb3', 'utf8', 'utf16', 'utf16le', 'utf32',
  'latin1', 'latin2', 'latin5', 'latin7',
  'gbk', 'gb2312', 'gb18030', 'big5',
  'ascii', 'binary', 'cp1250', 'cp1251', 'cp1256', 'cp1257',
  'greek', 'hebrew', 'armscii8', 'ujis', 'sjis', 'euckr', 'tis620'
]

const COLLATIONS: Record<string, string[]> = {
  utf8mb4: ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_bin', 'utf8mb4_0900_ai_ci', 'utf8mb4_0900_as_cs', 'utf8mb4_unicode_520_ci'],
  utf8mb3: ['utf8mb3_general_ci', 'utf8mb3_unicode_ci', 'utf8mb3_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  utf16: ['utf16_general_ci', 'utf16_unicode_ci', 'utf16_bin'],
  utf16le: ['utf16le_general_ci', 'utf16le_bin'],
  utf32: ['utf32_general_ci', 'utf32_unicode_ci', 'utf32_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_general_cs', 'latin1_bin', 'latin1_danish_ci', 'latin1_german1_ci', 'latin1_german2_ci', 'latin1_spanish_ci'],
  latin2: ['latin2_general_ci', 'latin2_bin', 'latin2_hungarian_ci', 'latin2_croatian_ci'],
  latin5: ['latin5_turkish_ci', 'latin5_bin'],
  latin7: ['latin7_general_ci', 'latin7_general_cs', 'latin7_bin', 'latin7_estonian_cs'],
  gbk: ['gbk_chinese_ci', 'gbk_bin'],
  gb2312: ['gb2312_chinese_ci', 'gb2312_bin'],
  gb18030: ['gb18030_chinese_ci', 'gb18030_bin', 'gb18030_unicode_520_ci'],
  big5: ['big5_chinese_ci', 'big5_bin'],
  ascii: ['ascii_general_ci', 'ascii_bin'],
  binary: ['binary'],
  cp1250: ['cp1250_general_ci', 'cp1250_bin', 'cp1250_croatian_ci', 'cp1250_czech_cs', 'cp1250_polish_ci'],
  cp1251: ['cp1251_general_ci', 'cp1251_bin', 'cp1251_ukrainian_ci', 'cp1251_bulgarian_ci'],
  cp1256: ['cp1256_general_ci', 'cp1256_bin'],
  cp1257: ['cp1257_general_ci', 'cp1257_bin', 'cp1257_lithuanian_ci'],
  greek: ['greek_general_ci', 'greek_bin'],
  hebrew: ['hebrew_general_ci', 'hebrew_bin'],
  armscii8: ['armscii8_general_ci', 'armscii8_bin'],
  ujis: ['ujis_japanese_ci', 'ujis_bin'],
  sjis: ['sjis_japanese_ci', 'sjis_bin'],
  euckr: ['euckr_korean_ci', 'euckr_bin'],
  tis620: ['tis620_thai_ci', 'tis620_bin'],
}

export function CreateDatabaseModal({ open, connectionId, onClose }: Props) {
  const [name, setName] = useState('')
  const [charset, setCharset] = useState('utf8mb4')
  const [collation, setCollation] = useState('utf8mb4_general_ci')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { loadDatabases } = useDatabaseStore()

  useEffect(() => {
    if (open) {
      setName('')
      setCharset('utf8mb4')
      setCollation('utf8mb4_general_ci')
      setError('')
    }
  }, [open])

  useEffect(() => {
    const collations = COLLATIONS[charset] || []
    if (!collations.includes(collation)) {
      setCollation(collations[0] || '')
    }
  }, [charset])

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('请输入数据库名称')
      return
    }
    if (!connectionId) return

    setLoading(true)
    setError('')
    try {
      const sql = `CREATE DATABASE \`${name}\` CHARACTER SET ${charset} COLLATE ${collation}`
      await api.query.execute(connectionId, sql)
      await loadDatabases(connectionId)
      onClose()
    } catch (e: any) {
      setError(e.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      title="新建数据库"
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button variant="default" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleCreate} disabled={loading}>
            {loading ? '创建中...' : '创建'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>数据库名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入数据库名称"
            autoFocus
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>字符集</label>
          <Select
            value={charset}
            onChange={setCharset}
            options={CHARSETS.map(c => ({ value: c, label: c }))}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>排序规则</label>
          <Select
            value={collation}
            onChange={setCollation}
            options={(COLLATIONS[charset] || []).map(c => ({ value: c, label: c }))}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </Modal>
  )
}
