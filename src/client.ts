import { APIPromise, type RawResponse } from './api-promise.js'
import {
  DEFAULT_BASE_URL,
  DEFAULT_LOG_LEVEL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  ENV,
  REFLEX_CREATE_TIMEOUT_MS,
  REFLEX_FINAL_STATUSES,
  REQUEST_ID_HEADER,
  type LogLevel,
} from './constants.js'
import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  WaitTimeoutError,
  XiangxinError,
} from './errors.js'
import { consoleLogger, filterLogger, parseLogLevel, redactHeaders, type Logger } from './logger.js'
import { DEFAULT_RETRY_POLICY, isRetryable, resolveRetryPolicy, retryDelayMs, type RetryPolicy } from './retry.js'
import type {
  Fetch,
  ModelCard,
  Questions,
  Reflex,
  ReflexCreateRequest,
  ReflexMetrics,
  SystemOneRequest,
  SystemOneResult,
} from './types.js'
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
   * 请求省略 `model` 时使用的模型，默认读取 `XIANGXIN_DEFAULT_MODEL`，否则为 `xiangxin-s1-latest`。
   * / Default model; falls back to `XIANGXIN_DEFAULT_MODEL`, then `xiangxin-s1-latest`.
   */
  defaultModel?: string
  /** 每次尝试的超时（毫秒），默认 120000。 / Timeout per attempt in ms. Default 120000. */
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

/** `reflexes.wait` 的选项。 / Options of `reflexes.wait`. */
export interface ReflexWaitOptions extends RequestOptions {
  /** 两次查询的间隔（毫秒），默认 2000。 / Delay between polls in ms. Default 2000. */
  pollIntervalMs?: number
  /**
   * 最长等待时间（毫秒），超出抛 `WaitTimeoutError`；默认不限。`timeout` 仍是每次查询的 HTTP 超时。
   * / Maximum total wait in ms; `timeout` stays the per-request HTTP timeout. Default unlimited.
   */
  waitTimeoutMs?: number
}

/**
 * 条件反射资源：`client.reflexes`。用标注数据练出自己的反射，再以
 * `model: reflexModel(name)` 调用 `systemOne`。
 *
 * The reflexes resource: train your own reflex from labeled data, then call
 * `systemOne` with `model: reflexModel(name)`.
 */
export interface Reflexes {
  /**
   * 提交训练：新建反射，或给同名反射重练（新版本练好前旧版本照常可用）。标注类型由问题推断：
   * Noul 标 `true/false`，Choice 标选项名，Score 标档位下标；可以只标部分问题。
   * 默认超时不短于 300 秒，且默认不重试超时（避免重复提交）；409 / 422 从不重试。
   *
   * Submit training, or retrain an existing reflex of the same name. The default
   * timeout is at least 300s and timeouts are not retried by default.
   *
   * 以下情况会以错误拒绝 / Rejects with:
   * - `ConflictError`：`reflex_busy`（正在训练）或 `too_many_reflexes`。
   * - `UnprocessableEntityError`：名字不合法、样本过少 / 过多、问题或标注不合法。
   * - `RequestTooLargeError`：请求体超过 50MB。
   * - `InternalServerError`：`trainer_unavailable`（503，会自动重试）。
   */
  create<const Q extends Questions>(request: ReflexCreateRequest<Q>, options?: RequestOptions): APIPromise<Reflex>
  /** 列出本组织的反射，新建的在前。 / List the organization's reflexes, newest first. */
  list(options?: RequestOptions): APIPromise<Reflex[]>
  /** 查询一个反射（含训练进度与成绩）；不存在时以 `NotFoundError` 拒绝。 / Get a reflex. */
  get(name: string, options?: RequestOptions): APIPromise<Reflex>
  /** 取消排队或训练中的任务；已有旧版本则旧版本继续可用。 / Cancel training; a live version stays live. */
  cancel(name: string, options?: RequestOptions): APIPromise<Reflex>
  /** 删除反射及其权重，名字可以重用。 / Delete a reflex and its weights. */
  delete(name: string, options?: RequestOptions): APIPromise<void>
  /**
   * 轮询直到训练结束（`ready` / `failed` / `cancelled`）并返回反射；重练时 `ready` 表示新版本已上线。
   * 训练失败或被取消时照常返回，请检查 `status`；超过 `waitTimeoutMs` 以 `WaitTimeoutError` 拒绝。
   *
   * Poll until training reaches a final status and return the reflex. Failed or
   * cancelled trainings resolve normally; exceeding `waitTimeoutMs` rejects with `WaitTimeoutError`.
   */
  wait(name: string, options?: ReflexWaitOptions): Promise<Reflex>
}

const SYSTEM_ONE_PATH = '/v1/systemone'
const MODELS_PATH = '/v1/models'
const REFLEXES_PATH = '/v1/reflexes'
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
  validateQuestions(questions)
}

function validateReflexName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name === '') {
    throw new XiangxinError('反射名不能为空 / reflex name must be a non-empty string')
  }
}

function validateReflexCreateRequest(request: unknown): void {
  if (!isPlainObject(request)) throw new XiangxinError('request 必须是对象 / request must be an object')
  const { name, questions, examples, description } = request
  validateReflexName(name)
  validateQuestions(questions)
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new XiangxinError('examples 必须是非空数组 / examples must be a non-empty array')
  }
  examples.forEach((example: unknown, i) => {
    if (!isPlainObject(example) || example.state === undefined || example.state === null || !isPlainObject(example.answers)) {
      throw new XiangxinError(
        `第 ${i} 条样本须为 {state, answers} 对象 / example ${i} must be an object with state and answers`,
      )
    }
  })
  if (description !== undefined && typeof description !== 'string') {
    throw new XiangxinError('description 必须是字符串 / description must be a string')
  }
}

function reflexPath(name: string, suffix = ''): string {
  validateReflexName(name)
  return `${REFLEXES_PATH}/${encodeURIComponent(name)}${suffix}`
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 宽松解析反射对象：忽略未知字段，缺失的可选字段取默认值。 / Tolerant reflex parsing. */
function toReflex(data: unknown): Reflex | undefined {
  if (!isPlainObject(data) || typeof data.id !== 'string' || typeof data.name !== 'string' || typeof data.status !== 'string') {
    return undefined
  }
  const queuePosition = num(data.queue_position)
  return {
    id: data.id,
    name: data.name,
    model: str(data.model) ?? `xiangxin-reflex:${data.name}`,
    description: str(data.description) ?? '',
    status: data.status,
    usable: data.usable === true,
    progress: num(data.progress) ?? 0,
    stage: str(data.stage),
    ...(queuePosition === null ? {} : { queue_position: queuePosition }),
    questions: isPlainObject(data.questions) ? (data.questions as Reflex['questions']) : {},
    examples: num(data.examples),
    metrics: isPlainObject(data.metrics) ? (data.metrics as ReflexMetrics) : null,
    error: str(data.error),
    created_at: str(data.created_at),
    updated_at: str(data.updated_at),
    trained_at: str(data.trained_at),
  }
}

function validateQuestions(questions: unknown): void {
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
  /** 条件反射资源。 / The reflexes resource. */
  readonly reflexes: Reflexes

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

    const reflex = (raw: RawResponse): Reflex => {
      const data = this.#json(raw)
      const r = toReflex(data)
      if (!r) throw this.#invalid(raw, data, '响应不是反射对象 / response is not a reflex object')
      return r
    }
    const get = (name: string, options: RequestOptions = {}): APIPromise<Reflex> =>
      new APIPromise(
        Promise.resolve().then(() => this.#request('GET', reflexPath(name), undefined, options)),
        reflex,
      )
    this.reflexes = {
      create: (request, options = {}) => {
        const raw = Promise.resolve().then(() => {
          validateReflexCreateRequest(request)
          const timeout = options.timeout ?? Math.max(this.timeout, REFLEX_CREATE_TIMEOUT_MS)
          const retry = { apiTimeoutError: false, ...(options.retry ?? {}) }
          return this.#request('POST', REFLEXES_PATH, request, { ...options, timeout, retry })
        })
        return new APIPromise(raw, reflex)
      },
      list: (options = {}) =>
        new APIPromise(this.#request('GET', REFLEXES_PATH, undefined, options), (raw) => {
          const data = this.#json(raw)
          const items = isPlainObject(data) && Array.isArray(data.reflexes) ? data.reflexes.map(toReflex) : undefined
          if (!items || items.some((r) => r === undefined)) {
            throw this.#invalid(raw, data, '响应缺少 reflexes 数组 / response is missing the reflexes array')
          }
          return items as Reflex[]
        }),
      get,
      cancel: (name, options = {}) =>
        new APIPromise(
          Promise.resolve().then(() => this.#request('POST', reflexPath(name, '/cancel'), undefined, options)),
          reflex,
        ),
      delete: (name, options = {}) =>
        new APIPromise(
          Promise.resolve().then(() => this.#request('DELETE', reflexPath(name), undefined, options)),
          () => undefined,
        ),
      wait: async (name, options = {}) => {
        const { pollIntervalMs = 2000, waitTimeoutMs, ...requestOptions } = options
        validateTimeout(pollIntervalMs, 'pollIntervalMs')
        if (waitTimeoutMs !== undefined && !(typeof waitTimeoutMs === 'number' && waitTimeoutMs >= 0)) {
          throw new XiangxinError('waitTimeoutMs 必须是非负数（毫秒） / waitTimeoutMs must be a non-negative number')
        }
        const deadline = waitTimeoutMs === undefined ? undefined : Date.now() + waitTimeoutMs
        for (;;) {
          const r = await get(name, requestOptions)
          if (REFLEX_FINAL_STATUSES.has(r.status)) return r
          let delay = pollIntervalMs
          if (deadline !== undefined) {
            const remaining = deadline - Date.now()
            if (remaining <= 0) {
              throw new WaitTimeoutError(
                `等待反射 ${JSON.stringify(name)} 超时，当前状态 ${r.status} / timed out waiting for reflex ${JSON.stringify(name)} (status=${r.status})`,
                r,
              )
            }
            delay = Math.min(delay, remaining)
          }
          await sleep(delay, requestOptions.signal)
        }
      },
    }
  }

  /**
   * 对 `state` 提出一组带名字的问题，一次前向返回全部答案。答案类型由问题推断：
   * Choice 的 `choice` 是选项名的字面量联合，Score 的 `legend` 以档位为键。
   *
   * Ask named questions about `state` and get every answer in one forward pass.
   * Answer types are inferred from the questions.
   *
   * @param request state、questions 与可选的 model（如 `S1_MODEL`、`REFLEX_MODEL` 或 `reflexModel(name)`）；
   *   其余字段原样转发。 / State, questions and optional model; other fields are forwarded.
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
