import { LOG_LEVELS, type LogLevel } from './constants.js'

/** 与 `console` 兼容的日志接口。 / Logger interface compatible with `console`. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, off: 100 }

/** 解析日志级别字符串（大小写不敏感，`warning` 视为 `warn`）。 / Parse a level string. */
export function parseLogLevel(raw: string | undefined): LogLevel | undefined {
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (v === 'warning') return 'warn'
  return (LOG_LEVELS as readonly string[]).includes(v) ? (v as LogLevel) : undefined
}

const noop = () => {}

/** 包一层按级别过滤的日志器。 / Wrap a logger so that only `level` and above are emitted. */
export function filterLogger(base: Logger, level: LogLevel): Logger {
  const enabled = (l: Exclude<LogLevel, 'off'>) => RANK[l] >= RANK[level]
  return {
    debug: enabled('debug') ? (m, ...a) => base.debug(m, ...a) : noop,
    info: enabled('info') ? (m, ...a) => base.info(m, ...a) : noop,
    warn: enabled('warn') ? (m, ...a) => base.warn(m, ...a) : noop,
    error: enabled('error') ? (m, ...a) => base.error(m, ...a) : noop,
  }
}

/** 默认日志器：带 `[xiangxin]` 前缀的 `console`。 / Default logger: `console` with a prefix. */
export const consoleLogger: Logger = {
  debug: (m, ...a) => console.debug(`[xiangxin] ${m}`, ...a),
  info: (m, ...a) => console.info(`[xiangxin] ${m}`, ...a),
  warn: (m, ...a) => console.warn(`[xiangxin] ${m}`, ...a),
  error: (m, ...a) => console.error(`[xiangxin] ${m}`, ...a),
}

const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key'])

/** 隐去鉴权类请求头，用于日志。 / Redact credential headers for logging. */
export function redactHeaders(headers: Record<string, string> | Headers): Record<string, string> {
  const out: Record<string, string> = {}
  const entries: Iterable<[string, string]> = headers instanceof Headers ? headers.entries() : Object.entries(headers)
  for (const [key, value] of entries) {
    const lower = key.toLowerCase()
    out[key] = SECRET_HEADERS.has(lower) || lower.includes('token') || lower.includes('secret') ? '<redacted>' : value
  }
  return out
}
