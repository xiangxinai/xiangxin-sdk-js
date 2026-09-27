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
  /** 默认模型，默认 `xiangxin-s1-latest`。 / Default model; defaults to `xiangxin-s1-latest`. */
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
export const DEFAULT_MODEL = 'xiangxin-s1-latest'

/** 每次尝试的默认超时（毫秒）。 / Default timeout per attempt, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 120_000 // 长 state（32k token）+ 多问题的请求可达约 60 秒

/** `reflexes.create` 的最短超时（毫秒）：请求体最大 50MB，上传需要更久。 / Minimum timeout for `reflexes.create`, in ms. */
export const REFLEX_CREATE_TIMEOUT_MS = 300_000

/** 系统一模型（象信·系统一）的别名。 / Alias of the System One model (象信·系统一). */
export const S1_MODEL = 'xiangxin-s1'

/** 基础条件反射模型的别名。 / Alias of the base reflex model. */
export const REFLEX_MODEL = 'xiangxin-reflex'

/** 训练结束的状态，`reflexes.wait` 等到其中之一即返回。 / Final statuses awaited by `reflexes.wait`. */
export const REFLEX_FINAL_STATUSES: ReadonlySet<string> = new Set(['ready', 'failed', 'cancelled'])

const REFLEX_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * 练出来的反射的模型名，用作 `systemOne` 的 `model`。
 *
 * Model name of a trained reflex, for the `model` of `systemOne`.
 *
 * @example
 * reflexModel('ticket-router') // 'xiangxin-reflex:ticket-router'
 * @throws {TypeError} 名字不符合 `^[a-z0-9][a-z0-9-]{0,62}$`。 / Invalid reflex name.
 */
export function reflexModel<const N extends string>(name: N): `xiangxin-reflex:${N}` {
  if (typeof name !== 'string' || !REFLEX_NAME_RE.test(name)) {
    throw new TypeError(
      `反射名须为小写字母、数字或连字符（1–63 个字符，不以连字符开头） / invalid reflex name: ${JSON.stringify(name)}`,
    )
  }
  return `${REFLEX_MODEL}:${name}`
}

/** 默认日志级别。 / Default log level. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'warn'

/** 请求 ID 响应头。 / Response header carrying the request ID. */
export const REQUEST_ID_HEADER = 'x-request-id'

/** 模型推理耗时（毫秒）响应头。 / Response header with model latency in ms. */
export const MODEL_MS_HEADER = 'x-xiangxin-model-ms'

/** 网关总耗时（毫秒）响应头。 / Response header with total gateway latency in ms. */
export const TOTAL_MS_HEADER = 'x-xiangxin-total-ms'
