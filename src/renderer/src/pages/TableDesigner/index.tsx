import React, { useState, useEffect, useCallback } from 'react'
import { Tabs, Button, Modal } from '../../components/ui'
import { SaveOutlined, DiffOutlined } from '@ant-design/icons'
import { ColumnEditor } from './ColumnEditor'
import { IndexEditor } from './IndexEditor'
import { ForeignKeyEditor } from './ForeignKeyEditor'
import { TableOptions } from './TableOptions'
import { StructureDiff } from './StructureDiff'
import { useTabStore, DesignTab } from '../../stores/tab.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'
import type { TableDesign, ColumnDesign, IndexDesign, ForeignKeyDesign } from '../../../../shared/types/table-design'

const emptyDesign: TableDesign = {
  name: '', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci',
  comment: '', columns: [], indexes: [], foreignKeys: [],
}

interface Props {
  tabId: string
}

const TableDesigner: React.FC<Props> = ({ tabId }) => {
  const { tabs, activeTabId, updateDesign, updateTabTitle, setDesignDirty } = useTabStore()
  const { loadTables } = useDatabaseStore()
  const tab = tabs.find((t) => t.id === tabId) as DesignTab | undefined

  const connectionId = tab?.connectionId
  const database = tab?.database
  const tableName = tab?.table  // null = 新建表

  const isEdit = !!tableName
  const [design, setDesign] = useState<TableDesign>({ ...emptyDesign })
  const [original, setOriginal] = useState<TableDesign | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [ddlPreview, setDdlPreview] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isEdit && connectionId && database && tableName) {
      loadExisting()
    } else {
      setDesign({ ...emptyDesign })
      setOriginal(null)
    }
  }, [tableName, database, connectionId])

  const loadExisting = async () => {
    if (!connectionId || !database || !tableName) return
    try {
      const cols = await api.meta.columns(connectionId, database, tableName)
      const idxs = await api.meta.indexes(connectionId, database, tableName)
      const fks = await api.meta.foreignKeys(connectionId, database, tableName)
      const status = await api.meta.tableStatus(connectionId, database)

      const columns: ColumnDesign[] = cols.map((c) => ({
        name: c.name, type: c.dataType.toUpperCase(),
        length: c.maxLength != null ? String(c.maxLength) : '',
        decimals: c.numericScale != null ? String(c.numericScale) : '',
        nullable: c.nullable, defaultValue: c.defaultValue != null ? String(c.defaultValue) : '',
        autoIncrement: c.autoIncrement, primaryKey: c.primaryKey, unique: false, comment: c.comment,
        unsigned: c.columnType.includes('unsigned'), zerofill: c.columnType.includes('zerofill'),
        onUpdateCurrentTimestamp: c.extra.includes('on update CURRENT_TIMESTAMP'),
      }))

      const indexes: IndexDesign[] = idxs.filter((i) => i.name !== 'PRIMARY').map((i) => ({
        name: i.name, type: i.unique ? 'UNIQUE' : 'INDEX', method: 'BTREE' as const,
        columns: i.columns.map((c) => ({ name: c.name, order: c.order })), comment: i.comment,
      }))

      const foreignKeys: ForeignKeyDesign[] = fks.map((f) => ({
        name: f.name, columns: f.columns, referencedTable: f.referencedTable,
        referencedColumns: f.referencedColumns,
        onUpdate: f.onUpdate as ForeignKeyDesign['onUpdate'],
        onDelete: f.onDelete as ForeignKeyDesign['onDelete'],
      }))

      const d: TableDesign = {
        name: tableName, engine: status?.engine || 'InnoDB', charset: 'utf8mb4',
        collation: status?.collation || 'utf8mb4_general_ci', comment: status?.comment || '',
        columns, indexes, foreignKeys,
      }
      setDesign(d)
      setOriginal(JSON.parse(JSON.stringify(d)))
    } catch (e: any) {
      setError(e.message || '加载表结构失败')
    }
  }

  const generateDDL = (): string => {
    const d = design
    const lines: string[] = [`CREATE TABLE \`${d.name}\` (`]
    const colDefs: string[] = d.columns.map((c) => {
      let def = `  \`${c.name}\` ${c.type}`
      if (c.length) def += `(${c.length}${c.decimals ? `,${c.decimals}` : ''})`
      if (c.unsigned) def += ' UNSIGNED'
      if (!c.nullable) def += ' NOT NULL'
      if (c.autoIncrement) def += ' AUTO_INCREMENT'
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`
      if (c.comment) def += ` COMMENT '${c.comment}'`
      return def
    })
    const pks = d.columns.filter((c) => c.primaryKey).map((c) => `\`${c.name}\``)
    if (pks.length) colDefs.push(`  PRIMARY KEY (${pks.join(', ')})`)
    for (const idx of d.indexes) colDefs.push(`  ${idx.type} \`${idx.name}\` (${idx.columns.map((c) => `\`${c.name}\` ${c.order}`).join(', ')}) USING ${idx.method}`)
    for (const fk of d.foreignKeys) colDefs.push(`  CONSTRAINT \`${fk.name}\` FOREIGN KEY (${fk.columns.map((c) => `\`${c}\``).join(', ')}) REFERENCES \`${fk.referencedTable}\` (${fk.referencedColumns.map((c) => `\`${c}\``).join(', ')}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}`)
    lines.push(colDefs.join(',\n'))
    lines.push(`) ENGINE=${d.engine} DEFAULT CHARSET=${d.charset} COLLATE=${d.collation}${d.comment ? ` COMMENT='${d.comment}'` : ''};`)
    return lines.join('\n')
  }

  useEffect(() => { setDdlPreview(generateDDL()) }, [design])

  const handleDesignChange = (newDesign: TableDesign) => {
    setDesign(newDesign)
    setDesignDirty(tabId, true)
    // 更新标签页标题
    if (newDesign.name && !isEdit) {
      updateTabTitle(tabId, `新建表: ${newDesign.name}`)
    }
  }

  const validateDesign = (): string | null => {
    if (!design.name.trim()) return '请输入表名'
    if (design.columns.length === 0) return '请至少添加一个字段'
    for (let i = 0; i < design.columns.length; i++) {
      const col = design.columns[i]
      if (!col.name.trim()) return `第 ${i + 1} 个字段缺少名称`
      if (!col.type) return `字段 "${col.name}" 缺少类型`
    }
    return null
  }

  const handleSave = useCallback(async () => {
    if (!connectionId || !database) { setErrorMsg('请先选择连接和数据库'); return }
    const validationError = validateDesign()
    if (validationError) { setErrorMsg(validationError); return }

    // 如果没有改动，不执行保存
    if (isEdit && !tab?.isDirty) { return }

    try {
      if (isEdit && original) {
        // 编辑模式：先计算差异再提交
        const diff = await api.design.diff(original, design)
        await api.design.alterTable(connectionId, database, design.name, diff)
        setOriginal(JSON.parse(JSON.stringify(design)))  // 更新原始状态
      } else {
        await api.design.createTable(connectionId, database, design)
        setOriginal(JSON.parse(JSON.stringify(design)))  // 新建后设为原始状态
      }
      // 刷新左侧表列表
      await loadTables(connectionId, database)
      setSuccessMsg(isEdit ? '表已修改' : '表已创建')
      setDesignDirty(tabId, false)
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (e: any) {
      const msg = e.message || '操作失败'
      // 转换常见错误为友好提示
      if (msg.includes('Duplicate entry')) setErrorMsg('数据重复，请检查唯一约束')
      else if (msg.includes('Duplicate column')) setErrorMsg('字段名重复，请检查')
      else if (msg.includes('Table') && msg.includes('already exists')) setErrorMsg('表名已存在')
      else if (msg.includes('syntax')) setErrorMsg('SQL语法错误，请检查字段定义')
      else setErrorMsg(msg)
    }
  }, [connectionId, database, design, isEdit, original, tabId, tab?.isDirty, setDesignDirty])

  // Ctrl+S 快捷键保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && activeTabId === tabId) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, activeTabId, tabId])

  if (!tab) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <div className="table-designer-toolbar">
        <label className="toolbar-field">
          <span>表名</span>
          <input value={design.name} onChange={(e) => handleDesignChange({ ...design, name: e.target.value })} />
        </label>
        <label className="toolbar-field">
          <span>引擎</span>
          <select value={design.engine} onChange={(e) => handleDesignChange({ ...design, engine: e.target.value })}>
            <option value="InnoDB">InnoDB</option>
            <option value="MyISAM">MyISAM</option>
            <option value="MEMORY">MEMORY</option>
          </select>
        </label>
        <label className="toolbar-field">
          <span>字符集</span>
          <select value={design.charset} onChange={(e) => handleDesignChange({ ...design, charset: e.target.value })}>
            <option value="utf8mb4">utf8mb4</option>
            <option value="utf8">utf8</option>
            <option value="latin1">latin1</option>
          </select>
        </label>
        <label className="toolbar-field">
          <span>注释</span>
          <input value={design.comment} onChange={(e) => handleDesignChange({ ...design, comment: e.target.value })} />
        </label>
        <Button size="small" type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
        {isEdit && <Button size="small" icon={<DiffOutlined />} onClick={() => setDiffOpen(true)}>查看差异</Button>}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Tabs items={[
          { key: 'columns', label: '列', children: <ColumnEditor columns={design.columns} onChange={(columns) => handleDesignChange({ ...design, columns })} /> },
          { key: 'indexes', label: '索引', children: <IndexEditor indexes={design.indexes} columns={design.columns} onChange={(indexes) => handleDesignChange({ ...design, indexes })} /> },
          { key: 'fk', label: '外键', children: <ForeignKeyEditor foreignKeys={design.foreignKeys} columns={design.columns} onChange={(foreignKeys) => handleDesignChange({ ...design, foreignKeys })} /> },
          { key: 'options', label: '选项', children: <TableOptions design={design} onChange={handleDesignChange} /> },
          { key: 'preview', label: 'DDL 预览', children: <pre style={{ background: 'var(--bg-hover)', padding: 12, borderRadius: 4, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', maxHeight: 500 }}>{ddlPreview}</pre> },
        ]} />
      </div>

      {original && <StructureDiff open={diffOpen} onClose={() => setDiffOpen(false)} original={original} current={design} />}

      {/* 成功提示 - 顶部浮动 */}
      {successMsg && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--success)', color: '#fff', padding: '8px 24px',
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000
        }}>
          ✓ {successMsg}
        </div>
      )}

      {/* 错误弹窗 */}
      <Modal
        open={!!errorMsg}
        title="错误"
        width={360}
        onClose={() => setErrorMsg(null)}
        footer={<Button variant="primary" onClick={() => setErrorMsg(null)}>确定</Button>}
      >
        <div style={{ padding: '8px 0', color: 'var(--error)' }}>
          {errorMsg}
        </div>
      </Modal>
    </div>
  )
}

export default TableDesigner
