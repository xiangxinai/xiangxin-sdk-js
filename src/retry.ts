import { APIConnectionError, APIError, APITimeoutError, RateLimitError, parseRetryAfterMs } from './errors.js'

/**
 * 重试配置。客户端与单次调用都可以只传部分字段，未传的字段沿用上一层设置。
 *
 * Retry configuration. Partial overrides on the client or per call inherit
 * the remaining fields from the level above.
 */
export interface RetryPolicy {
  /** 首次请求之外的最大重试次数；`0` 关闭重试。默认 2。 / Retries after the first attempt. Default 2. */
  readonly maxRetries: number
  /** 会重试的 HTTP 状态码。默认 429、500、502、503、504、529。 / Retried statuses. */
  readonly httpStatuses: ReadonlySet<number>
  /** 首次退避（毫秒），之后每次翻倍。默认 500。 / First backoff in ms, doubled each retry. Default 500. */
  readonly backoffInitialMs: number
  /** 单次退避上限（毫秒）。默认 8000。 / Maximum backoff in ms. Default 8000. */
  readonly backoffMaxMs: number
  /** 每次退避随机扣减的比例（0–1）。默认 0.25。 / Fraction randomly subtracted. Default 0.25. */
  readonly backoffJitter: number
  /** 是否遵守 `retry-after` / `retry-after-ms`。默认 true。 / Honor retry-after headers. Default true. */
  readonly respectRetryAfter: boolean
  /** 服务端建议等待时间的上限（毫秒），超出按上限等待。默认 60000。 / Cap for server delays. Default 60000. */
  readonly maxRetryAfterMs: number
  /** 是否重试连接错误（`APIConnectionError`）。默认 true。 / Retry connection errors. Default true. */
  readonly apiConnectionError: boolean
  /** 是否重试超时（`APITimeoutError`）。默认 true。 / Retry timeouts. Default true. */
  readonly apiTimeoutError: boolean
}

/** 默认会重试的 HTTP 状态码。 / HTTP statuses retried by default. */
export const DEFAULT_RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504, 529])

/** 默认重试策略。 / The default retry policy. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxRetries: 2,
  httpStatuses: DEFAULT_RETRY_STATUSES,
  backoffInitialMs: 500,
  backoffMaxMs: 8000,
  backoffJitter: 0.25,
  respectRetryAfter: true,
  maxRetryAfterMs: 60_000,
  apiConnectionError: true,
  apiTimeoutError: true,
})

function nonNegative(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`retry.${name} 必须是非负数 / retry.${name} must be a non-negative number`)
  }
  return value
}

/** 把部分覆盖合并到基础策略上，并校验取值。 / Merge a partial override into a base policy. */
export function resolveRetryPolicy(base: RetryPolicy, override?: Partial<RetryPolicy>): RetryPolicy {
  const merged: RetryPolicy = { ...base, ...(override ?? {}) }
  const maxRetries = nonNegative('maxRetries', merged.maxRetries)
  if (!Number.isInteger(maxRetries)) throw new TypeError('retry.maxRetries 必须是整数 / must be an integer')
  nonNegative('backoffInitialMs', merged.backoffInitialMs)
  nonNegative('backoffMaxMs', merged.backoffMaxMs)
  nonNegative('maxRetryAfterMs', merged.maxRetryAfterMs)
  if (!(merged.backoffJitter >= 0 && merged.backoffJitter <= 1)) {
    throw new TypeError('retry.backoffJitter 必须在 0 到 1 之间 / must be between 0 and 1')
  }
  return Object.freeze({ ...merged, httpStatuses: new Set(merged.httpStatuses) })
}

/** 错误是否可重试（不考虑次数）。 / Whether an error is retryable, ignoring the attempt count. */
export function isRetryable(policy: RetryPolicy, error: unknown): boolean {
  if (error instanceof APITimeoutError) return policy.apiTimeoutError
  if (error instanceof APIConnectionError) return policy.apiConnectionError
  if (error instanceof APIError) return policy.httpStatuses.has(error.status)
  return false
}

/**
 * 第 `retryIndex` 次重试（从 0 起）前的等待毫秒数：优先服务端建议（封顶 `maxRetryAfterMs`），否则指数退避加抖动。
 *
 * Delay before the `retryIndex`-th retry (0-based): the server's hint (capped at
 * `maxRetryAfterMs`) when present, otherwise exponential backoff with jitter.
 */
export function retryDelayMs(
  policy: RetryPolicy,
  error: unknown,
  retryIndex: number,
  random: () => number = Math.random,
): number {
  if (policy.respectRetryAfter && error instanceof APIError) {
    const hinted = error instanceof RateLimitError ? error.retryAfterMs : parseRetryAfterMs(error.headers)
    if (hinted !== undefined) return Math.min(hinted, policy.maxRetryAfterMs)
  }
  if (policy.backoffInitialMs <= 0 || policy.backoffMaxMs <= 0) return 0
  const base = Math.min(policy.backoffMaxMs, policy.backoffInitialMs * 2 ** retryIndex)
  return base * (1 - policy.backoffJitter * random())
}
