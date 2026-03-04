export interface TableTransformRequest {
  id: string
  rows: Array<Record<string, unknown>>
}

export interface TableTransformResponse {
  id: string
  rows: Array<Record<string, unknown>>
}

self.onmessage = (event: MessageEvent<TableTransformRequest>) => {
  const { id, rows } = event.data

  try {
    const normalizedRows = rows.map((row) => {
      const next: Record<string, unknown> = {}
      Object.keys(row).forEach((key) => {
        const value = row[key]
        if (typeof value === 'bigint') {
          next[key] = value.toString()
          return
        }
        if (value instanceof Date) {
          next[key] = value.toISOString()
          return
        }
        next[key] = value
      })
      return next
    })

    const payload: TableTransformResponse = { id, rows: normalizedRows }
    self.postMessage(payload)
  } catch {
    const payload: TableTransformResponse = { id, rows }
    self.postMessage(payload)
  }
}
