/**
 * 客户端读取的环境变量名。显式传入的配置永远优先于环境变量；空白值会被忽略。
 *
 * Environment variable names read by the client. Explicit options always win;
 * blank values are ignored.
 */
export const ENV = {
  /** API 密钥（必填），未传 `apiKey` 时读取。 / Required API key, used when `apiKey` is omitted. */
  apiKey: 'XIANGXIN_API_KEY',
  /** API 根地址，默认 `https://api.xiangxinai.cn`。 / API root; defaults to `https://api.xiangxinai.cn`. */
  baseURL: 'XIANGXIN_BASE_URL',
  /** 默认模型，默认 `xiangxin-latest`。 / Default model; defaults to `xiangxin-latest`. */
  defaultModel: 'XIANGXIN_DEFAULT_MODEL',
  /** 日志级别，默认 `warn`。 / Log level; defaults to `warn`. */
  logLevel: 'XIANGXIN_LOG',
} as const

/** `ENV` 中任意一个环境变量名。 / Any environment variable name in `ENV`. */
export type EnvVar = (typeof ENV)[keyof typeof ENV]

/** 日志级别；`off` 关闭日志。 / Log verbosity; `off` disables logging. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'

/** 支持的日志级别，从最详细到最安静。 / Supported log levels, most to least verbose. */
export const LOG_LEVELS: readonly LogLevel[] = Object.freeze(['debug', 'info', 'warn', 'error', 'off'] as const)

/** 默认 API 根地址。 / Default API root. */
export const DEFAULT_BASE_URL = 'https://api.xiangxinai.cn'

/** 默认模型。 / Default model. */
export const DEFAULT_MODEL = 'xiangxin-latest'

/** 每次尝试的默认超时（毫秒）。 / Default timeout per attempt, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** 默认日志级别。 / Default log level. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'warn'

/** 请求 ID 响应头。 / Response header carrying the request ID. */
export const REQUEST_ID_HEADER = 'x-request-id'

/** 模型推理耗时（毫秒）响应头。 / Response header with model latency in ms. */
export const MODEL_MS_HEADER = 'x-xiangxin-model-ms'

/** 网关总耗时（毫秒）响应头。 / Response header with total gateway latency in ms. */
export const TOTAL_MS_HEADER = 'x-xiangxin-total-ms'
