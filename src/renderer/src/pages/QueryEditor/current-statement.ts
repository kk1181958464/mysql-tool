import { findStatementAt } from '../../../../shared/sql-splitter'

export const findCurrentStatement = (sql: string, offset: number): string => findStatementAt(sql, offset)
