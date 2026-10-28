import React, { useState } from 'react'
import { Card, Row, Col, Button, Table, Tag, Space, Empty } from '../../components/ui'
import { ImportOutlined, ExportOutlined, HistoryOutlined } from '@ant-design/icons'
import ImportWizard from './ImportWizard'
import ExportWizard from './ExportWizard'

interface HistoryItem {
  id: string; type: 'import' | 'export'; file: string; format: string
  rows: number; status: 'success' | 'failed'; date: string
}

const ImportExport: React.FC = () => {
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [history] = useState<HistoryItem[]>([])

  const historyColumns = [
    { title: '类型', dataIndex: 'type', key: 'type', width: 80, render: (v: string) => <Tag type={v === 'import' ? 'primary' : 'success'}>{v === 'import' ? '导入' : '导出'}</Tag> },
    { title: '文件', dataIndex: 'file', key: 'file', ellipsis: true },
    { title: '格式', dataIndex: 'format', key: 'format', width: 80 },
    { title: '行数', dataIndex: 'rows', key: 'rows', width: 80 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag type={v === 'success' ? 'success' : 'error'}>{v === 'success' ? '成功' : '失败'}</Tag> },
    { title: '时间', dataIndex: 'date', key: 'date', width: 170 },
  ]

  if (showImport) return <ImportWizard onBack={() => setShowImport(false)} />
  if (showExport) return <ExportWizard onBack={() => setShowExport(false)} />

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <div className="action-cards">
        <button type="button" className="action-card" onClick={() => setShowImport(true)}>
          <span className="action-card-icon"><ImportOutlined /></span>
          <span className="action-card-text">
            <span className="action-card-title">导入数据</span>
            <span className="action-card-desc">从 CSV、Excel 或 SQL 文件导入到数据表</span>
          </span>
          <span className="action-card-go">开始导入 →</span>
        </button>
        <button type="button" className="action-card action-card-success" onClick={() => setShowExport(true)}>
          <span className="action-card-icon"><ExportOutlined /></span>
          <span className="action-card-text">
            <span className="action-card-title">导出数据</span>
            <span className="action-card-desc">导出为 CSV、JSON、SQL 或 Excel 文件</span>
          </span>
          <span className="action-card-go">开始导出 →</span>
        </button>
      </div>

      <Card title={<span><HistoryOutlined /> 最近操作</span>} size="small">
        {history.length > 0 ? (
          <Table dataSource={history} columns={historyColumns} rowKey="id" size="small" />
        ) : (
          <Empty description="暂无导入导出记录" />
        )}
      </Card>
    </div>
  )
}

export default ImportExport
