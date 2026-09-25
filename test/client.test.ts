import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APIConnectionError,
  APIError,
  APIPromise,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  DEFAULT_RETRY_POLICY,
  InsufficientBalanceError,
  InternalServerError,
  NotFoundError,
  OverloadedError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  VERSION,
  XiangxinClient,
  XiangxinError,
  choice,
  noul,
  score,
  type Logger,
} from '../src/index.js'
import { retryDelayMs, resolveRetryPolicy } from '../src/retry.js'
import { MODELS_BODY, SYSTEM_ONE_BODY, json, mockFetch } from './mock-fetch.js'

const KEY = 'sk-xx-0123456789abcdef0123456789abcdef01234567'
const questions = {
  is_urgent: noul('是否需要紧急处理？'),
  department: choice('分派部门', { billing: '扣费、退款', technical: null, sales: null }),
  frustration: score('情绪激动程度', ['平静', '不满', '非常愤怒']),
}
const fast = { backoffInitialMs: 1, backoffMaxMs: 2 }

function client(fetch: any, extra: Record<string, unknown> = {}) {
  return new XiangxinClient({ apiKey: KEY, fetch, retry: fast, logLevel: 'off', ...extra })
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('XIANGXIN_API_KEY', '')
  vi.stubEnv('XIANGXIN_BASE_URL', '')
  vi.stubEnv('XIANGXIN_DEFAULT_MODEL', '')
  vi.stubEnv('XIANGXIN_LOG', '')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('configuration', () => {
  it('reads XIANGXIN_API_KEY and XIANGXIN_BASE_URL from the environment', async () => {
    vi.stubEnv('XIANGXIN_API_KEY', KEY)
    vi.stubEnv('XIANGXIN_BASE_URL', 'http://localhost:8000/')
    const { fetch, calls } = mockFetch(json(MODELS_BODY))
    const c = new XiangxinClient({ fetch })
    expect(c.baseURL).toBe('http://localhost:8000')
    await c.models.list()
    expect(calls[0]!.url).toBe('http://localhost:8000/v1/models')
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it('uses documented defaults', () => {
    const c = new XiangxinClient({ apiKey: KEY, fetch: mockFetch().fetch })
    expect(c.baseURL).toBe('https://api.xiangxinai.cn')
    expect(c.defaultModel).toBe('xiangxin-latest')
    expect(c.timeout).toBe(120_000)
    expect(c.logLevel).toBe('warn')
    expect(c.retry.maxRetries).toBe(2)
    expect([...c.retry.httpStatuses].sort()).toEqual([429, 500, 502, 503, 504, 529])
  })

  it('throws XiangxinError when the API key is missing or malformed', () => {
    expect(() => new XiangxinClient({ fetch: mockFetch().fetch })).toThrow(XiangxinError)
    expect(() => new XiangxinClient({ fetch: mockFetch().fetch })).toThrow(/XIANGXIN_API_KEY/)
    expect(() => new XiangxinClient({ apiKey: 'sk xx', fetch: mockFetch().fetch })).toThrow(XiangxinError)
    expect(() => new XiangxinClient({ apiKey: KEY, baseURL: 'ftp://x', fetch: mockFetch().fetch })).toThrow(XiangxinError)
    expect(() => new XiangxinClient({ apiKey: KEY, timeout: 0, fetch: mockFetch().fetch })).toThrow(XiangxinError)
  })

  it('never exposes the API key through inspect, JSON or toString', () => {
    const c = client(mockFetch().fetch)
    expect(inspect(c, { depth: 5, showHidden: true })).not.toContain(KEY)
    expect(JSON.stringify(c)).not.toContain(KEY)
    expect(String(c)).not.toContain(KEY)
  })
})

describe('systemOne', () => {
  it('sends the documented request shape and headers', async () => {
    const { fetch, calls } = mockFetch(json(SYSTEM_ONE_BODY))
    const c = client(fetch, { defaultHeaders: { 'X-Team': 'cs', Authorization: 'Bearer evil' } })
    const result = await c.systemOne(
      { state: { 工单: '我被重复扣费了两次' }, questions, trace_id: 't1' },
      { headers: { 'x-call': '1', accept: 'text/html' } },
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    const call = calls[0]!
    expect(call.url).toBe('https://api.xiangxinai.cn/v1/systemone')
    expect(call.init.method).toBe('POST')
    expect(call.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': `xiangxin-js/${VERSION}`,
      'x-team': 'cs',
      'x-call': '1',
    })
    expect(call.init.signal).toBeInstanceOf(AbortSignal)
    expect(call.body).toEqual({
      state: { 工单: '我被重复扣费了两次' },
      model: 'xiangxin-latest',
      trace_id: 't1',
      questions: {
        is_urgent: { type: 'noul', instructions: '是否需要紧急处理？' },
        department: {
          type: 'choice',
          instructions: '分派部门',
          criteria: { billing: '扣费、退款', technical: null, sales: null },
        },
        frustration: { type: 'score', instructions: '情绪激动程度', criteria: ['平静', '不满', '非常愤怒'] },
      },
    })

    expect(result.model).toBe('xiangxin-1.0.0')
    expect(result.answers.is_urgent.noul).toBe(0.95)
    expect(result.answers.department.choice).toBe('billing')
    expect(result.answers.department.probabilities.technical).toBe(0.12)
    expect(result.answers.frustration.legend['2']).toBe('非常愤怒')
    expect(result.usage.input_tokens).toBe(296)
  })

  it('honours the model override and defaultModel', async () => {
    const { fetch, calls } = mockFetch(json(SYSTEM_ONE_BODY))
    const c = client(fetch, { defaultModel: 'xiangxin-preview' })
    await c.systemOne({ state: 'x', questions })
    await c.systemOne({ state: 'x', questions, model: 'xiangxin-1.0.0' })
    expect(calls.map((c) => c.body.model)).toEqual(['xiangxin-preview', 'xiangxin-1.0.0'])
  })

  it('accepts plain question objects', async () => {
    const { fetch, calls } = mockFetch(json(SYSTEM_ONE_BODY))
    await client(fetch).systemOne({
      state: ['a', 'b'],
      questions: { q: { type: 'noul', instructions: '?', criteria: { true: '是', false: '否' } } },
    })
    expect(calls[0]!.body.questions.q).toEqual({ type: 'noul', instructions: '?', criteria: { true: '是', false: '否' } })
  })

  it('rejects invalid requests without calling fetch', async () => {
    const { fetch } = mockFetch(json(SYSTEM_ONE_BODY))
    const c = client(fetch)
    await expect(c.systemOne({ state: 'x', questions: {} })).rejects.toThrow(XiangxinError)
    await expect(c.systemOne({ state: 'x', questions: { s: { type: 'score', criteria: ['one'] } as any } })).rejects.toThrow(
      /at least 2/,
    )
    await expect(c.systemOne({ state: 'x', questions: { c: { type: 'choice', criteria: {} } } })).rejects.toThrow(
      /non-empty criteria/,
    )
    await expect(c.systemOne({ state: undefined as any, questions })).rejects.toThrow(/state/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns an APIPromise with withResponse(), asResponse() and map()', async () => {
    const { fetch } = mockFetch(json(SYSTEM_ONE_BODY, 200, { 'x-xiangxin-model-ms': '53' }))
    const c = client(fetch)
    const p = c.systemOne({ state: 'x', questions })
    expect(p).toBeInstanceOf(APIPromise)
    expect(p).toBeInstanceOf(Promise)
    const { data, response, requestId } = await p.withResponse()
    expect(requestId).toBe('req_123')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-xiangxin-model-ms')).toBe('53')
    expect(data.answers.department.confidence).toBe(0.81)
    expect(await p).toBe(data) // single parse, shared

    const raw = await c.systemOne({ state: 'x', questions }).asResponse()
    expect(await raw.json()).toEqual(SYSTEM_ONE_BODY)

    const choiceOnly = await c.systemOne({ state: 'x', questions }).map((r) => r.answers.department.choice)
    expect(choiceOnly).toBe('billing')
  })

  it('raises APIResponseValidationError for malformed 2xx bodies', async () => {
    const { fetch } = mockFetch(new Response('not json', { status: 200 }))
    await expect(client(fetch).systemOne({ state: 'x', questions })).rejects.toBeInstanceOf(APIResponseValidationError)
  })
})

describe('models.list', () => {
  it('GETs /v1/models and returns the model cards', async () => {
    const { fetch, calls } = mockFetch(json(MODELS_BODY))
    const c = client(fetch)
    const models = await c.models.list()
    expect(calls[0]!.init.method).toBe('GET')
    expect(calls[0]!.init.body).toBeUndefined()
    expect(calls[0]!.headers['content-type']).toBeUndefined()
    expect(models.map((m) => m.name)).toEqual(['xiangxin-latest', 'xiangxin-preview'])
    const { data, requestId } = await c.models.list().withResponse()
    expect(data[0]!.release_date).toBe('2026-10-01')
    expect(requestId).toBe('req_123')
  })
})

describe('errors', () => {
  const cases: [number, unknown, new (...a: any[]) => APIError][] = [
    [400, { detail: 'bad' }, BadRequestError],
    [401, { detail: 'invalid_api_key' }, AuthenticationError],
    [402, { detail: 'insufficient_balance' }, InsufficientBalanceError],
    [403, { detail: 'forbidden' }, PermissionDeniedError],
    [404, { detail: 'model_not_found' }, NotFoundError],
    [422, { detail: [{ loc: ['body', 'questions'], msg: 'Field required' }] }, UnprocessableEntityError],
    [429, { detail: 'rate_limited' }, RateLimitError],
    [500, { detail: 'boom' }, InternalServerError],
    [503, 'Service Unavailable', InternalServerError],
    [529, { detail: 'overloaded' }, OverloadedError],
    [418, { detail: 'teapot' }, APIError],
  ]

  it.each(cases)('maps %i to the right error class', async (status, body, Cls) => {
    const res =
      typeof body === 'string'
        ? new Response(body, { status, headers: { 'x-request-id': 'req_err' } })
        : json(body, status, { 'x-request-id': 'req_err' })
    const { fetch } = mockFetch(res)
    const err = await client(fetch, { retry: { maxRetries: 0 } })
      .systemOne({ state: 'x', questions })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Cls)
    expect(err).toBeInstanceOf(APIError)
    expect(err).toBeInstanceOf(XiangxinError)
    const e = err as APIError
    expect(e.status).toBe(status)
    expect(e.requestId).toBe('req_err')
    expect(e.name).toBe(Cls.name)
    if (typeof body === 'string') {
      expect(e.body).toBe(body)
      expect(e.detail).toBeUndefined()
    } else {
      expect(e.detail).toEqual((body as { detail: unknown }).detail)
    }
    expect(e.message).toContain(String(status))
    expect(e.message).not.toContain(KEY)
  })

  it('exposes retryAfter on RateLimitError', async () => {
    const { fetch } = mockFetch(json({ detail: 'rate_limited' }, 429, { 'retry-after': '3' }))
    const err = (await client(fetch, { retry: { maxRetries: 0 } })
      .systemOne({ state: 'x', questions })
      .catch((e) => e)) as RateLimitError
    expect(err.retryAfter).toBe(3)
    expect(err.retryAfterMs).toBe(3000)
  })
})

describe('retries', () => {
  it('retries 429 after waiting for retry-after', async () => {
    // 只伪造定时器与时钟：Node 18 的 Response.text() 要等一次真实 I/O 才完成，
    // 先把它冲刷掉，等待才会从 0 开始计时（否则测试依赖 Node 版本的内部调度）。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { fetch } = mockFetch(json({ detail: 'rate_limited' }, 429, { 'retry-after': '2' }), json(SYSTEM_ONE_BODY))
    const p = client(fetch).systemOne({ state: 'x', questions })
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
    await vi.advanceTimersByTimeAsync(1_900)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await p).model).toBe('xiangxin-1.0.0')
  })

  it('prefers retry-after-ms and caps server delays at maxRetryAfterMs', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch(
      json({ detail: 'rate_limited' }, 429, { 'retry-after-ms': '150', 'retry-after': '100' }),
      json({ detail: 'rate_limited' }, 429, { 'retry-after': '3600' }),
      json(SYSTEM_ONE_BODY),
    )
    const p = client(fetch).systemOne({ state: 'x', questions })
    await vi.advanceTimersByTimeAsync(160)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(fetch).toHaveBeenCalledTimes(3)
    await p
  })

  it('retries 529 and succeeds', async () => {
    const { fetch } = mockFetch(json({ detail: 'overloaded' }, 529), json({ detail: 'overloaded' }, 529), json(SYSTEM_ONE_BODY))
    const r = await client(fetch).systemOne({ state: 'x', questions })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(r.answers.is_urgent.noul).toBe(0.95)
  })

  it('gives up after maxRetries and throws the last error', async () => {
    const { fetch } = mockFetch(json({ detail: 'overloaded' }, 529))
    await expect(client(fetch).systemOne({ state: 'x', questions })).rejects.toBeInstanceOf(OverloadedError)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry 422, 401 or 402', async () => {
    for (const status of [422, 401, 402]) {
      const { fetch } = mockFetch(json({ detail: 'x' }, status), json(SYSTEM_ONE_BODY))
      await expect(client(fetch).systemOne({ state: 'x', questions })).rejects.toBeInstanceOf(APIError)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })

  it('retries connection errors, then raises APIConnectionError', async () => {
    const { fetch } = mockFetch(new TypeError('fetch failed'))
    const err = await client(fetch).systemOne({ state: 'x', questions }).catch((e) => e)
    expect(err).toBeInstanceOf(APIConnectionError)
    expect(err).not.toBeInstanceOf(APITimeoutError)
    expect((err as Error).cause).toBeInstanceOf(TypeError)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('per-call retry overrides inherit the client policy', async () => {
    const { fetch } = mockFetch(json({ detail: 'overloaded' }, 529))
    await expect(client(fetch).systemOne({ state: 'x', questions }, { retry: { maxRetries: 0 } })).rejects.toBeInstanceOf(
      OverloadedError,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('computes exponential backoff with jitter', () => {
    const p = resolveRetryPolicy(DEFAULT_RETRY_POLICY)
    const err = new OverloadedError(529, undefined, new Headers())
    expect(retryDelayMs(p, err, 0, () => 0)).toBe(500)
    expect(retryDelayMs(p, err, 1, () => 0)).toBe(1000)
    expect(retryDelayMs(p, err, 10, () => 0)).toBe(8000)
    expect(retryDelayMs(p, err, 0, () => 1)).toBe(375)
    const limited = new RateLimitError(429, undefined, new Headers({ 'retry-after': '120' }))
    expect(retryDelayMs(p, limited, 0)).toBe(60_000)
    expect(retryDelayMs({ ...p, respectRetryAfter: false }, limited, 0, () => 0)).toBe(500)
    expect(() => resolveRetryPolicy(p, { backoffJitter: 2 })).toThrow()
  })
})

describe('timeouts and cancellation', () => {
  it('raises APITimeoutError when an attempt exceeds the timeout', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch('hang')
    const p = client(fetch, { timeout: 1_000, retry: { maxRetries: 0 } })
      .systemOne({ state: 'x', questions })
      .catch((e) => e)
    await vi.advanceTimersByTimeAsync(1_001)
    const err = await p
    expect(err).toBeInstanceOf(APITimeoutError)
    expect(err).toBeInstanceOf(APIConnectionError)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((fetch.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(true)
  })

  it('retries timeouts (per-call timeout override)', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch('hang', json(SYSTEM_ONE_BODY))
    const p = client(fetch).systemOne({ state: 'x', questions }, { timeout: 50 })
    await vi.advanceTimersByTimeAsync(100)
    expect((await p).model).toBe('xiangxin-1.0.0')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('raises APIUserAbortError when the caller aborts mid-request, without retrying', async () => {
    const { fetch } = mockFetch('hang')
    const controller = new AbortController()
    const p = client(fetch).systemOne({ state: 'x', questions }, { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    await expect(p).rejects.toBeInstanceOf(APIUserAbortError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('aborts while waiting between retries', async () => {
    const { fetch } = mockFetch(json({ detail: 'rate_limited' }, 429, { 'retry-after': '30' }))
    const controller = new AbortController()
    const p = client(fetch).systemOne({ state: 'x', questions }, { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    await expect(p).rejects.toBeInstanceOf(APIUserAbortError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately with an already-aborted signal', async () => {
    const { fetch } = mockFetch(json(SYSTEM_ONE_BODY))
    await expect(client(fetch).models.list({ signal: AbortSignal.abort() })).rejects.toBeInstanceOf(APIUserAbortError)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('logging', () => {
  function capture(): { logger: Logger; lines: string[] } {
    const lines: string[] = []
    const push = (m: string, ...a: unknown[]) => lines.push(m + ' ' + JSON.stringify(a))
    return { logger: { debug: push, info: push, warn: push, error: push }, lines }
  }

  it('redacts the API key at debug level', async () => {
    const { logger, lines } = capture()
    const { fetch } = mockFetch(json({ detail: 'overloaded' }, 529), json(SYSTEM_ONE_BODY))
    await client(fetch, { logger, logLevel: 'debug' }).systemOne({ state: 'x', questions })
    expect(lines.some((l) => l.includes('<redacted>'))).toBe(true)
    expect(lines.some((l) => l.includes('Retrying POST /v1/systemone'))).toBe(true)
    expect(lines.join('\n')).not.toContain(KEY)
  })

  it('filters by level and reads XIANGXIN_LOG', async () => {
    vi.stubEnv('XIANGXIN_LOG', 'info')
    const { logger, lines } = capture()
    const { fetch } = mockFetch(json(MODELS_BODY))
    const c = new XiangxinClient({ apiKey: KEY, fetch, logger })
    expect(c.logLevel).toBe('info')
    await c.models.list()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/GET \/v1\/models -> 200 in \d+ms \(request_id=req_123\)/)
  })
})
