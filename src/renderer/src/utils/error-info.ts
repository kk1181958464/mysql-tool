import { formatErrorMessage, parseErrorCode } from '../../../shared/error-message'

export interface ErrorInfo {
  title: string
  hint: string
  detail: string
  code?: string
  errno?: number
}

interface Rule {
  test: RegExp
  errno?: number[]
  title: string
  hint: string
}

const RULES: Rule[] = [
  { test: /SSH 认证失败|All configured authentication methods failed/i, title: 'SSH 认证失败', hint: '请检查 SSH 用户名、密码或私钥是否正确；使用私钥时确认公钥已加入服务器的 authorized_keys。' },
  { test: /Timed out while waiting for handshake|SSH.*(timeout|timed out)/i, title: 'SSH 连接超时', hint: '无法在规定时间内连上 SSH 服务器，请检查 SSH 主机、端口和网络。' },
  { test: /Cannot parse privateKey|Unsupported key format|Encrypted private (OpenSSH )?key detected/i, title: 'SSH 私钥无法解析', hint: '请确认选择的是私钥文件（不是 .pub 公钥），加密私钥需要填写私钥密码。' },
  { test: /连接已断开|连接已失效|PROTOCOL_CONNECTION_LOST|Connection lost|server closed the connection/i, errno: [2006, 2013], title: '连接已断开', hint: '与服务器的连接已经断开，请重新连接后再试。' },
  { test: /ER_ACCESS_DENIED_ERROR|Access denied for user/i, errno: [1045], title: '用户名或密码错误', hint: 'MySQL 拒绝了登录，请检查用户名和密码，并确认该用户允许从当前主机连接。' },
  { test: /ER_DBACCESS_DENIED_ERROR|ER_TABLEACCESS_DENIED_ERROR|ER_SPECIFIC_ACCESS_DENIED|command denied to user/i, errno: [1044, 1142, 1143, 1227], title: '权限不足', hint: '当前 MySQL 用户没有执行该操作的权限，请联系管理员授权。' },
  { test: /ER_BAD_DB_ERROR|Unknown database/i, errno: [1049], title: '数据库不存在', hint: '指定的数据库不存在，请确认库名，或清空连接配置中的默认数据库后重试。' },
  { test: /ER_HOST_NOT_PRIVILEGED|is not allowed to connect/i, errno: [1130], title: '当前主机不允许连接', hint: 'MySQL 用户没有从当前 IP 访问的权限，需要在服务器上为该主机授权。' },
  { test: /ER_CON_COUNT_ERROR|Too many connections/i, errno: [1040], title: '服务器连接数已满', hint: 'MySQL 已达到最大连接数，请稍后重试或联系管理员。' },
  { test: /ER_PARSE_ERROR|error in your SQL syntax/i, errno: [1064], title: 'SQL 语法错误', hint: '语句存在语法错误，请检查报错位置附近的关键字、引号和括号。' },
  { test: /ER_NO_SUCH_TABLE|Table '.+' doesn't exist/i, errno: [1146], title: '表不存在', hint: '引用的表不存在，请确认表名和当前数据库是否正确。' },
  { test: /ER_BAD_FIELD_ERROR|Unknown column/i, errno: [1054], title: '字段不存在', hint: '引用了不存在的字段，请检查字段名拼写。' },
  { test: /ER_DUP_ENTRY|Duplicate entry/i, errno: [1062], title: '数据重复', hint: '写入的值与已有记录冲突，违反了主键或唯一索引约束。' },
  { test: /ER_ROW_IS_REFERENCED|Cannot delete or update a parent row/i, errno: [1451], title: '被其他表引用', hint: '该记录被其他表的外键引用，需先处理引用它的数据。' },
  { test: /ER_NO_REFERENCED_ROW|Cannot add or update a child row/i, errno: [1452], title: '外键约束失败', hint: '外键字段的值在关联表中不存在。' },
  { test: /ER_BAD_NULL_ERROR|cannot be null/i, errno: [1048], title: '字段不能为空', hint: '有字段不允许为 NULL，请填写该字段的值。' },
  { test: /ER_DATA_TOO_LONG|Data too long/i, errno: [1406], title: '数据过长', hint: '写入的内容超过了字段允许的长度。' },
  { test: /ER_TRUNCATED_WRONG_VALUE|ER_WRONG_VALUE|Incorrect (?:integer|decimal|datetime|date|string) value|Out of range value/i, errno: [1292, 1366, 1264], title: '数据格式不正确', hint: '写入的值与字段类型不匹配或超出范围，请检查数据格式。' },
  { test: /ER_TABLE_EXISTS_ERROR|already exists/i, errno: [1050], title: '对象已存在', hint: '同名的表或对象已经存在，请换一个名字。' },
  { test: /ER_LOCK_WAIT_TIMEOUT|Lock wait timeout/i, errno: [1205], title: '等待锁超时', hint: '数据被其他事务锁定，请稍后重试。' },
  { test: /ER_LOCK_DEADLOCK|Deadlock found/i, errno: [1213], title: '发生死锁', hint: '事务之间出现死锁，已被数据库回滚，请重试。' },
  { test: /ER_QUERY_TIMEOUT|maximum statement execution time exceeded/i, errno: [3024], title: '查询超时', hint: '语句执行时间超过限制，请优化查询或缩小范围。' },
  { test: /ER_QUERY_INTERRUPTED|Query execution was interrupted|已取消/i, errno: [1317], title: '查询已中断', hint: '查询在完成前被取消。' },
  { test: /ECONNREFUSED/i, title: '连接被拒绝', hint: '目标端口没有服务在监听，请检查主机、端口是否正确，以及 MySQL 是否已启动。' },
  { test: /ETIMEDOUT|connect timeout/i, title: '连接超时', hint: '服务器无响应，请检查网络、防火墙或安全组设置，也可以在“高级”里调大连接超时。' },
  { test: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i, title: '找不到主机', hint: '主机名无法解析，请检查主机地址是否拼写正确。' },
  { test: /EHOSTUNREACH|ENETUNREACH/i, title: '网络不可达', hint: '无法访问目标网络，请检查网络连接或 VPN。' },
  { test: /ECONNRESET|socket hang up/i, title: '连接被中断', hint: '连接建立后被服务器断开，可能是网络不稳定或服务器限制了连接。' },
  { test: /certificate|\bSSL\b|\bTLS\b|self[- ]signed/i, title: 'SSL 连接失败', hint: '请检查 SSL 模式和证书配置，自签名证书可尝试将 SSL 模式设为 REQUIRED。' },
]

function syntaxErrorHint(message: string, title: string): string | null {
  if (title !== 'SQL 语法错误') return null
  const match = message.match(/near '([\s\S]*)' at line (\d+)/)
  if (!match) return null
  const near = match[1].trim().replace(/\s+/g, ' ')
  if (!near) return `第 ${match[2]} 行语句不完整，请检查是否缺少结尾部分。`
  return `第 ${match[2]} 行附近有误：${near.length > 60 ? `${near.slice(0, 60)}…` : near}`
}

export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  return formatErrorMessage(error, fallback)
}

export function describeError(error: unknown, fallbackTitle = '操作失败'): ErrorInfo {
  const detail = getErrorMessage(error, fallbackTitle)
  const { message, code, errno } = parseErrorCode(detail)
  const rule = RULES.find((r) => (errno !== undefined && r.errno?.includes(errno)) || r.test.test(detail))
  if (rule) return { title: rule.title, hint: syntaxErrorHint(message, rule.title) ?? rule.hint, detail, code, errno }
  const firstLine = message.split('\n')[0]
  return { title: fallbackTitle, hint: firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine, detail, code, errno }
}

export function formatErrorSummary(error: unknown, fallbackTitle = '操作失败'): string {
  const info = describeError(error, fallbackTitle)
  return info.title === fallbackTitle ? `${fallbackTitle}：${info.hint}` : `${info.title}：${info.hint}`
}
