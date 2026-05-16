import { api } from './ipc'
import type { PerfMetricPayload } from '../../../../preload/types'

const PERF_METRICS_ENABLED = import.meta.env.DEV

export function reportPerfMetric(metric: PerfMetricPayload): void {
  if (!PERF_METRICS_ENABLED) return
  void api.perf.reportMetric(metric)
}
