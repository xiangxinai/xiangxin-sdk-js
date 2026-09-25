import { APIPromise, type RawResponse } from './api-promise.js'
import {
  DEFAULT_BASE_URL,
  DEFAULT_LOG_LEVEL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  ENV,
  REQUEST_ID_HEADER,
  type LogLevel,
} from './constants.js'
import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  XiangxinError,
} from './errors.js'
import { consoleLogger, filterLogger, parseLogLevel, redactHeaders, type Logger } from './logger.js'
import { DEFAULT_RETRY_POLICY, isRetryable, resolveRetryPolicy, retryDelayMs, type RetryPolicy } from './retry.js'
import type { Fetch, ModelCard, Questions, SystemOneRequest, SystemOneResult } from './types.js'
import { VERSION } from './version.js'

/**
 * 客户端配置。显式传入的值优先于环境变量，其次是 SDK 默认值。
 *
 * Client options. Explicit values take precedence over environment variables, then SDK defaults.
 */
export interface XiangxinClientConfig {
  /** API 密钥（必填），默认读取 `XIANGXIN_API_KEY`。 / API key; falls back to `XIANGXIN_API_KEY`. */
  apiKey?: string
  /**
   * API 根地址，默认读取 `XIANGXIN_BASE_URL`，否则为 `https://api.xiangxinai.cn`。
   * / API root; falls back to `XIANGXIN_BASE_URL`, then `https://api.xiangxinai.cn`.
   */
  baseURL?: string
  /**
   * 请求省略 `model` 时使用的模型，默认读取 `XIANGXIN_DEFAULT_MODEL`，否则为 `xiangxin-latest`。
   * / Default model; falls back to `XIANGXIN_DEFAULT_MODEL`, then `xiangxin-latest`.
   */
  defaultModel?: string
  /** 每次尝试的超时（毫秒），默认 30000。 / Timeout per attempt in ms. Default 30000. */
  timeout?: number
  /** 重试策略的部分覆盖。 / Partial retry overrides. */
  retry?: Partial<RetryPolicy>
  /** 附加到每个请求的请求头（不能覆盖 `Authorization` / `Accept`）。 / Extra headers for every request. */
  defaultHeaders?: Record<string, string>
  /** 自定义 `fetch`（代理、测试等），默认使用全局 `fetch`。 / Custom fetch; defaults to global `fetch`. */
  fetch?: Fetch
  /** 日志器，默认带前缀的 `console`。 / Logger; defaults to a prefixed `console`. */
  logger?: Logger
  /**
   * 日志级别，默认读取 `XIANGXIN_LOG`，否则为 `warn`。`info` 每个请求一行摘要，
   * `debug` 额外输出请求头与正文（鉴权头会被隐去，正文不会）。
   * / Log level; falls back to `XIANGXIN_LOG`, then `warn`.
   */
  logLevel?: LogLevel
  /**
   * 允许在浏览器中使用。这会把 API 密钥暴露给页面访问者，默认 false。
   * 请改用服务端代理。 / Allow use in browsers, exposing the API key. Default false.
   */
  dangerouslyAllowBrowser?: boolean
}

/** 单次调用的选项，覆盖客户端设置。 / Per-call options overriding client settings. */
export interface RequestOptions {
  /** 本次调用每次尝试的超时（毫秒）。 / Timeout per attempt in ms for this call. */
  timeout?: number
  /** 本次调用的重试覆盖，未传字段沿用客户端设置。 / Retry overrides for this call. */
  retry?: Partial<RetryPolicy>
  /** 附加请求头，覆盖 `defaultHeaders`。 / Extra headers merged over `defaultHeaders`. */
  headers?: Record<string, string>
  /** 取消信号，同时取消进行中的请求与等待中的重试。 / Cancels the request and pending retries. */
  signal?: AbortSignal
}

/** 模型资源：`client.models`。 / The models resource: `client.models`. */
export interface Models {
  /** 列出当前账户可用的模型。 / List the models available to the account. */
  list(options?: RequestOptions): APIPromise<ModelCard[]>
}

const SYSTEM_ONE_PATH = '/v1/systemone'
const MODELS_PATH = '/v1/models'
const PROTECTED_HEADERS = new Set(['authorization', 'accept'])
const QUESTION_TYPES = new Set(['noul', 'choice', 'score'])

function readEnv(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> }; Deno?: { env?: { get?(n: string): string | undefined } } }
  try {
    const v = g.process?.env?.[name]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  } catch {
    /* 无权访问环境变量 / env not accessible */
  }
  try {
    const v = g.Deno?.env?.get?.(name)
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  } catch {
    /* Deno 未授权 --allow-env / no --allow-env */
  }
  return undefined
}

function isBrowser(): boolean {
  const g = globalThis as { window?: { document?: unknown }; navigator?: unknown }
  return typeof g.window !== 'undefined' && typeof g.window.document !== 'undefined' && typeof g.navigator !== 'undefined'
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateTimeout(timeout: unknown, where: string): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    throw new XiangxinError(`${where} 必须是正数（毫秒） / ${where} must be a positive number of milliseconds`)
  }
  return timeout
}

function resolveApiKey(explicit: string | undefined): string {
  const key = explicit !== undefined ? explicit.trim() : readEnv(ENV.apiKey)
  if (key === undefined) {
    throw new XiangxinError(
      `缺少 API 密钥：请传入 apiKey 或设置环境变量 ${ENV.apiKey}。 / Missing API key: pass apiKey or set ${ENV.apiKey}.`,
    )
  }
  if (key === '') throw new XiangxinError('API 密钥为空。 / The API key is empty.')
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new XiangxinError(
      'API 密钥包含空白、控制字符或非 ASCII 字符。 / The API key contains whitespace, control or non-ASCII characters.',
    )
  }
  return key
}

function resolveBaseURL(explicit: string | undefined): string {
  const url = (explicit ?? readEnv(ENV.baseURL) ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) {
    throw new XiangxinError(`baseURL 必须以 http:// 或 https:// 开头 / invalid baseURL: ${JSON.stringify(url)}`)
  }
  return url
}

function parseBody(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function validateSystemOneRequest(request: unknown): void {
  if (!isPlainObject(request)) throw new XiangxinError('request 必须是对象 / request must be an object')
  const { state, questions, model } = request
  if (state === undefined || state === null) throw new XiangxinError('state 不能为空 / state is required')
  if (model !== undefined && (typeof model !== 'string' || model.trim() === '')) {
    throw new XiangxinError('model 必须是非空字符串 / model must be a non-empty string')
  }
  if (!isPlainObject(questions) || Object.keys(questions).length === 0) {
    throw new XiangxinError('questions 必须是非空对象 / questions must be a non-empty object')
  }
  for (const [name, q] of Object.entries(questions)) {
    if (!isPlainObject(q) || typeof q.type !== 'string' || !QUESTION_TYPES.has(q.type)) {
      throw new XiangxinError(
        `问题 ${JSON.stringify(name)} 的 type 必须是 noul / choice / score / question ${JSON.stringify(name)} needs type noul, choice or score`,
      )
    }
    if (q.type === 'choice' && (!isPlainObject(q.criteria) || Object.keys(q.criteria).length === 0)) {
      throw new XiangxinError(
        `choice 问题 ${JSON.stringify(name)} 的 criteria 必须是非空对象 / choice question ${JSON.stringify(name)} needs non-empty criteria`,
      )
    }
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
      throw new XiangxinError(
        `score 问题 ${JSON.stringify(name)} 的 criteria 必须是至少两项的数组 / score question ${JSON.stringify(name)} needs an array of at least 2 levels`,
      )
    }
  }
}

/** 等待 `ms` 毫秒，可被 `signal` 取消。 / Sleep for `ms`, cancellable by `signal`. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new APIUserAbortError())
    const onAbort = () => {
      clearTimeout(timer)
      reject(new APIUserAbortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 让 `promise` 在 `signal` 触发时立即拒绝（即使自定义 fetch 忽略了 signal）。 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/**
 * 象信 AI API 客户端。 / Client for the 象信 AI API.
 *
 * @example
 * ```ts
 * import { XiangxinClient, noul } from '@xiangxinai/sdk'
 *
 * const client = new XiangxinClient() // 读取 XIANGXIN_API_KEY
 * const { answers } = await client.systemOne({
 *   state: '我被重复扣费了两次，请尽快处理！',
 *   questions: { billing: noul('这是否与扣费相关？') },
 * })
 * console.log(answers.billing.noul)
 * ```
 */
export class XiangxinClient {
  /** API 根地址（已去掉末尾斜杠）。 / API root without trailing slashes. */
  readonly baseURL: string
  /** 请求省略 `model` 时使用的模型。 / Model used when a request omits `model`. */
  readonly defaultModel: string
  /** 每次尝试的超时（毫秒）。 / Timeout per attempt in ms. */
  readonly timeout: number
  /** 合并后的客户端重试策略。 / Client retry policy with overrides applied. */
  readonly retry: RetryPolicy
  /** 附加到每个请求的请求头。 / Extra headers sent with each request. */
  readonly defaultHeaders: Readonly<Record<string, string>>
  /** 使用的 `fetch` 实现。 / The fetch implementation. */
  readonly fetch: Fetch
  /** 按 `logLevel` 过滤后的日志器。 / The logger, filtered to `logLevel`. */
  readonly logger: Logger
  /** 日志级别。 / Log level. */
  readonly logLevel: LogLevel
  /** 模型资源。 / The models resource. */
  readonly models: Models

  readonly #apiKey: string

  /**
   * @throws {XiangxinError} 缺少或非法的 API 密钥、非法配置，或在浏览器中未显式允许。
   *   / Missing or invalid API key, invalid options, or browser use without opt-in.
   */
  constructor(config: XiangxinClientConfig = {}) {
    if (isBrowser() && !config.dangerouslyAllowBrowser) {
      throw new XiangxinError(
        '检测到浏览器环境。在前端使用会把 API 密钥暴露给所有访问者，请改用服务端代理；' +
          '确需如此请传入 dangerouslyAllowBrowser: true。 / Refusing to run in a browser: this would expose your API key. ' +
          'Use a server-side proxy, or pass dangerouslyAllowBrowser: true.',
      )
    }
    this.#apiKey = resolveApiKey(config.apiKey)
    this.baseURL = resolveBaseURL(config.baseURL)
    const model = config.defaultModel ?? readEnv(ENV.defaultModel) ?? DEFAULT_MODEL
    if (typeof model !== 'string' || model.trim() === '') {
      throw new XiangxinError('defaultModel 必须是非空字符串 / defaultModel must be a non-empty string')
    }
    this.defaultModel = model.trim()
    this.timeout = validateTimeout(config.timeout ?? DEFAULT_TIMEOUT_MS, 'timeout')
    this.retry = resolveRetryPolicy(DEFAULT_RETRY_POLICY, config.retry)
    this.defaultHeaders = Object.freeze({ ...(config.defaultHeaders ?? {}) })

    const f = config.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined)
    if (typeof f !== 'function') {
      throw new XiangxinError('当前运行时没有全局 fetch，请通过 fetch 选项传入实现。 / No global fetch; pass the fetch option.')
    }
    this.fetch = f

    const level = config.logLevel ?? parseLogLevel(readEnv(ENV.logLevel)) ?? DEFAULT_LOG_LEVEL
    if (parseLogLevel(level) !== level) {
      throw new XiangxinError(`logLevel 无效 / invalid logLevel: ${JSON.stringify(level)}`)
    }
    this.logLevel = level
    this.logger = filterLogger(config.logger ?? consoleLogger, level)

    this.models = {
      list: (options: RequestOptions = {}) =>
        new APIPromise(this.#request('GET', MODELS_PATH, undefined, options), (raw) => {
          const data = this.#json(raw)
          if (!isPlainObject(data) || !Array.isArray(data.models)) {
            throw this.#invalid(raw, data, '响应缺少 models 数组 / response is missing the models array')
          }
          return data.models as ModelCard[]
        }),
    }
  }

  /**
   * 对 `state` 提出一组带名字的问题，一次前向返回全部答案。答案类型由问题推断：
   * Choice 的 `choice` 是选项名的字面量联合，Score 的 `legend` 以档位为键。
   *
   * Ask named questions about `state` and get every answer in one forward pass.
   * Answer types are inferred from the questions.
   *
   * @param request state、questions 与可选的 model；其余字段原样转发。 / State, questions and optional model.
   * @param options 单次调用的超时、重试、请求头与取消信号。 / Per-call options.
   * @returns 可 `await` 的 {@link APIPromise}；`.withResponse()` 额外返回 HTTP 响应。
   *
   * 以下情况会以错误拒绝 / Rejects with:
   * - `XiangxinError`：请求参数不合法（问题为空、Score 少于两档等）。
   * - `APIError` 子类：重试后服务端仍返回非 2xx。
   * - `APIConnectionError` / `APITimeoutError`：重试后仍无法连接或超时。
   * - `APIUserAbortError`：调用方取消。
   */
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options: RequestOptions = {},
  ): APIPromise<SystemOneResult<Q>> {
    const raw = Promise.resolve().then(() => {
      validateSystemOneRequest(request)
      const { state, questions, model, ...extra } = request
      const body = { state, model: model ?? this.defaultModel, questions, ...extra }
      return this.#request('POST', SYSTEM_ONE_PATH, body, options)
    })
    return new APIPromise(raw, (r) => {
      const data = this.#json(r)
      if (!isPlainObject(data) || !isPlainObject(data.answers) || typeof data.model !== 'string') {
        throw this.#invalid(r, data, '响应缺少 model 或 answers / response is missing model or answers')
      }
      return data as unknown as SystemOneResult<Q>
    })
  }

  #json(raw: RawResponse): unknown {
    try {
      return JSON.parse(raw.body)
    } catch {
      throw this.#invalid(raw, raw.body, '响应不是合法 JSON / response is not valid JSON')
    }
  }

  #invalid(raw: RawResponse, body: unknown, message: string): APIResponseValidationError {
    return new APIResponseValidationError(raw.response.status, body, raw.response.headers, message)
  }

  #headers(extra: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
    const out: Record<string, string> = { accept: 'application/json' }
    if (hasBody) out['content-type'] = 'application/json'
    if (!isBrowser()) out['user-agent'] = `xiangxin-js/${VERSION}`
    for (const source of [this.defaultHeaders, extra ?? {}]) {
      for (const [k, v] of Object.entries(source)) {
        const lower = k.toLowerCase()
        if (!PROTECTED_HEADERS.has(lower) && typeof v === 'string') out[lower] = v
      }
    }
    out.authorization = `Bearer ${this.#apiKey}`
    return out
  }

  async #request(method: string, path: string, body: unknown, options: RequestOptions): Promise<RawResponse> {
    const policy = resolveRetryPolicy(this.retry, options.retry)
    const timeout = options.timeout === undefined ? this.timeout : validateTimeout(options.timeout, 'options.timeout')
    const headers = this.#headers(options.headers, body !== undefined)
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const url = this.baseURL + path
    const { signal } = options
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new APIUserAbortError(undefined, { cause: signal.reason })
      try {
        return await this.#attempt(method, url, path, headers, payload, timeout, signal)
      } catch (error) {
        if (error instanceof APIUserAbortError || attempt >= policy.maxRetries || !isRetryable(policy, error)) throw error
        const delay = retryDelayMs(policy, error, attempt)
        this.logger.warn(
          `Retrying ${method} ${path} in ${Math.round(delay)}ms (attempt ${attempt + 1}/${policy.maxRetries}) after: ${(error as Error).message}`,
        )
        await sleep(delay, signal)
      }
    }
  }

  async #attempt(
    method: string,
    url: string,
    path: string,
    headers: Record<string, string>,
    payload: string | undefined,
    timeout: number,
    signal: AbortSignal | undefined,
  ): Promise<RawResponse> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new APITimeoutError(`请求超时（${timeout}ms） / Request timed out after ${timeout}ms.`))
    }, timeout)
    const onAbort = () => controller.abort(new APIUserAbortError(undefined, { cause: signal?.reason }))
    signal?.addEventListener('abort', onAbort, { once: true })

    const translate = (cause: unknown): Error => {
      if (signal?.aborted) return cause instanceof APIUserAbortError ? cause : new APIUserAbortError(undefined, { cause })
      if (timedOut) return cause instanceof APITimeoutError ? cause : new APITimeoutError(`请求超时（${timeout}ms） / Request timed out after ${timeout}ms.`, { cause })
      if (cause instanceof XiangxinError) return cause
      const reason = cause instanceof Error ? cause.message : String(cause)
      return new APIConnectionError(`连接失败 / Connection error: ${reason}`, { cause })
    }

    const started = Date.now()
    try {
      this.logger.debug(`Request ${method} ${url}`, { headers: redactHeaders(headers), body: payload })
      let response: Response
      let text: string
      try {
        const init: RequestInit = { method, headers, signal: controller.signal }
        if (payload !== undefined) init.body = payload
        response = await raceAbort(this.fetch(url, init), controller.signal)
        text = await raceAbort(response.text(), controller.signal)
      } catch (error) {
        throw translate(error)
      }
      const requestId = response.headers.get(REQUEST_ID_HEADER) ?? '-'
      this.logger.info(`${method} ${path} -> ${response.status} in ${Date.now() - started}ms (request_id=${requestId})`)
      this.logger.debug('Response', { headers: redactHeaders(response.headers), body: text })
      if (!response.ok) throw APIError.fromResponse(response.status, parseBody(text), response.headers)
      return { response, body: text }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 不包含 API 密钥的可读表示。 / A readable representation that never includes the API key. */
  toString(): string {
    return `XiangxinClient(baseURL=${this.baseURL}, defaultModel=${this.defaultModel})`
  }
}
