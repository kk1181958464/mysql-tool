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
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => setShowImport(true)}>
            <ImportOutlined style={{ fontSize: 48, color: 'var(--accent)', marginBottom: 16 }} />
            <h3>导入数据</h3>
            <p style={{ color: 'var(--text-muted)' }}>从 CSV、Excel、SQL 文件导入数据</p>
            <Button type="primary" icon={<ImportOutlined />}>开始导入</Button>
          </Card>
        </Col>
        <Col span={12}>
          <Card style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => setShowExport(true)}>
            <ExportOutlined style={{ fontSize: 48, color: 'var(--success)', marginBottom: 16 }} />
            <h3>导出数据</h3>
            <p style={{ color: 'var(--text-muted)' }}>导出为 CSV、JSON、SQL、Excel 格式</p>
            <Button type="primary" icon={<ExportOutlined />} style={{ background: 'var(--success)' }}>开始导出</Button>
          </Card>
        </Col>
      </Row>

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
