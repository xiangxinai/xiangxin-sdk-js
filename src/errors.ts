import { REQUEST_ID_HEADER } from './constants.js'

/**
 * 所有 SDK 错误的基类；配置错误（如缺少 API 密钥）也直接抛出此类。
 *
 * Base class for every SDK error. Configuration problems such as a missing
 * API key are thrown as this class directly.
 */
export class XiangxinError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

function messageFromBody(status: number, body: unknown): string {
  const detail = body && typeof body === 'object' && !Array.isArray(body) ? (body as { detail?: unknown }).detail : body
  if (detail === undefined || detail === null || detail === '') return `HTTP ${status}`
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

/**
 * 服务端返回了不成功（非 2xx）的 HTTP 响应。
 *
 * An unsuccessful (non-2xx) HTTP response from the API.
 */
export class APIError extends XiangxinError {
  /** HTTP 状态码。 / HTTP status code. */
  readonly status: number
  /** 解析后的 JSON 错误体、纯文本，或空体时为 `undefined`。 / Parsed JSON, text, or `undefined`. */
  readonly body: unknown
  /** 响应头。 / Response headers. */
  readonly headers: Headers
  /** `x-request-id` 响应头，联系技术支持时请提供。 / The `x-request-id` header. */
  readonly requestId: string | undefined

  constructor(status: number, body: unknown, headers: Headers, message?: string, options?: ErrorOptions) {
    const text = message ?? messageFromBody(status, body)
    const requestId = headers.get(REQUEST_ID_HEADER) ?? undefined
    super(`${status} ${text}${requestId ? ` (request_id=${requestId})` : ''}`, options)
    this.status = status
    this.body = body
    this.headers = headers
    this.requestId = requestId
  }

  /**
   * 错误体中的 `detail` 字段：字符串（如 `"insufficient_balance"`）或校验错误列表；没有时为 `undefined`。
   *
   * The `detail` field of the error body, or `undefined`.
   */
  get detail(): unknown {
    const b = this.body
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as { detail?: unknown }).detail : undefined
  }

  /**
   * 按状态码创建对应的错误子类。 / Create the error subclass for an HTTP status.
   */
  static fromResponse(status: number, body: unknown, headers: Headers): APIError {
    const Cls = errorClassForStatus(status)
    return new Cls(status, body, headers)
  }
}

/** 400：请求格式错误。 / The request was malformed. */
export class BadRequestError extends APIError {}

/** 401：API 密钥缺失、无效或已禁用。 / Missing, invalid, or disabled API key. */
export class AuthenticationError extends APIError {}

/** 402：组织余额不足，请到控制台充值。不会自动重试。 / Balance exhausted; top up in the console. */
export class InsufficientBalanceError extends APIError {}

/** 403：无权访问。 / Access denied. */
export class PermissionDeniedError extends APIError {}

/** 404：资源不存在，例如未知模型。 / Not found, e.g. an unknown model. */
export class NotFoundError extends APIError {}

/**
 * 422：请求未通过服务端校验（选项过多、超出 token 上限等）。不会自动重试。
 *
 * The request failed validation (too many choices, too many tokens, ...). Never retried.
 */
export class UnprocessableEntityError extends APIError {}

/** 429：超出速率限制。 / Rate limit exceeded. */
export class RateLimitError extends APIError {
  /** 服务端建议的等待时间（毫秒），没有该头或无法解析时为 `undefined`。 / Server-suggested delay in ms. */
  readonly retryAfterMs: number | undefined

  constructor(status: number, body: unknown, headers: Headers, message?: string, options?: ErrorOptions) {
    super(status, body, headers, message, options)
    this.retryAfterMs = parseRetryAfterMs(headers)
  }

  /** 服务端建议的等待时间（秒）。 / Server-suggested delay in seconds. */
  get retryAfter(): number | undefined {
    return this.retryAfterMs === undefined ? undefined : this.retryAfterMs / 1000
  }
}

/** 529：服务过载或模型后端暂不可用，稍后重试即可。 / Overloaded; retrying later usually succeeds. */
export class OverloadedError extends APIError {}

/** 其他 5xx：服务端内部错误。 / Any other 5xx server error. */
export class InternalServerError extends APIError {}

/**
 * HTTP 成功，但响应体不是预期的结构。 / A 2xx response whose body has an unexpected shape.
 */
export class APIResponseValidationError extends APIError {}

/**
 * 没有拿到 HTTP 响应：DNS 失败、连接被拒绝或中断、响应体读取中断等。
 *
 * No HTTP response: DNS failure, refused or reset connection, interrupted body, ...
 */
export class APIConnectionError extends XiangxinError {
  constructor(message = '连接失败 / Connection error.', options?: ErrorOptions) {
    super(message, options)
  }
}

/** 单次尝试超过了配置的超时时间。 / An attempt exceeded its timeout. */
export class APITimeoutError extends APIConnectionError {
  constructor(message = '请求超时 / Request timed out.', options?: ErrorOptions) {
    super(message, options)
  }
}

/** 调用方通过 `AbortSignal` 取消了请求。不会重试。 / The caller aborted the request. Never retried. */
export class APIUserAbortError extends XiangxinError {
  constructor(message = '请求已取消 / Request was aborted.', options?: ErrorOptions) {
    super(message, options)
  }
}

type APIErrorClass = new (status: number, body: unknown, headers: Headers) => APIError

const STATUS_TO_ERROR: Readonly<Record<number, APIErrorClass>> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: InsufficientBalanceError,
  403: PermissionDeniedError,
  404: NotFoundError,
  422: UnprocessableEntityError,
  429: RateLimitError,
  529: OverloadedError,
}

/** 把 HTTP 状态码映射到错误类。 / Map an HTTP status to its error class. */
export function errorClassForStatus(status: number): APIErrorClass {
  return STATUS_TO_ERROR[status] ?? (status >= 500 ? InternalServerError : APIError)
}

/**
 * 解析 `retry-after-ms` 或 `retry-after`（秒数或 HTTP 日期），返回毫秒。
 *
 * Parse `retry-after-ms` or `retry-after` (seconds or an HTTP date) into milliseconds.
 */
export function parseRetryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const ms = headers.get('retry-after-ms')
  if (ms !== null && ms.trim() !== '') {
    const value = Number(ms)
    if (Number.isFinite(value) && value >= 0) return value
  }
  const raw = headers.get('retry-after')
  if (raw === null || raw.trim() === '') return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}
