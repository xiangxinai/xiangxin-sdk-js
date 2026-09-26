import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  APITimeoutError,
  APIUserAbortError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  REFLEX_MODEL,
  RequestTooLargeError,
  S1_MODEL,
  UnprocessableEntityError,
  WaitTimeoutError,
  XiangxinClient,
  XiangxinError,
  choice,
  noul,
  reflexModel,
  score,
  type APIPromise,
  type Reflex,
  type ReflexExample,
} from '../src/index.js'
import { SYSTEM_ONE_BODY, json, mockFetch } from './mock-fetch.js'

const KEY = 'sk-xx-0123456789abcdef0123456789abcdef01234567'
const BASE = 'https://api.xiangxinai.cn/v1/reflexes'
const fast = { backoffInitialMs: 1, backoffMaxMs: 2 }

const questions = {
  department: choice('分派部门', { billing: '扣费、退款', technical: null }),
  is_urgent: noul('是否紧急？'),
  anger: score('多生气？', ['平静', '不满', '愤怒']),
}
const examples = Array.from({ length: 10 }, (_, i) => ({
  state: `第 ${i} 张工单：我被重复扣费了`,
  answers: { department: 'billing' as const, is_urgent: i % 2 === 0, anger: 1 },
}))

const METRICS = {
  examples: 1200,
  train_examples: 960,
  val_examples: 240,
  evaluated_on: 'val',
  epochs: 6.0,
  duration_s: 95.2,
  before: { accuracy: 0.61, log_loss: 0.93, ece: 0.12, per_question: { department: { accuracy: 0.58, n: 240 } } },
  after: { accuracy: 0.97, log_loss: 0.09, ece: 0.02, per_question: { department: { accuracy: 0.97, n: 240 } } },
}

function reflex(status = 'queued', overrides: Record<string, unknown> = {}) {
  return {
    id: 'rf_abc123',
    name: 'ticket-router',
    model: 'xiangxin-reflex:ticket-router',
    description: '',
    status,
    usable: status === 'ready',
    progress: status === 'ready' ? 1 : 0,
    stage: status,
    questions: { department: { type: 'choice', criteria: { billing: null, technical: null } } },
    examples: 1200,
    metrics: status === 'ready' ? METRICS : null,
    error: null,
    created_at: '2026-09-25T10:00:00Z',
    updated_at: '2026-09-25T10:00:00Z',
    trained_at: status === 'ready' ? '2026-09-25T10:02:00Z' : null,
    ...overrides,
  }
}

function client(fetch: any, extra: Record<string, unknown> = {}) {
  return new XiangxinClient({ apiKey: KEY, fetch, retry: fast, logLevel: 'off', ...extra })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('model constants', () => {
  it('exposes model names and reflexModel()', () => {
    expect(S1_MODEL).toBe('xiangxin-s1')
    expect(REFLEX_MODEL).toBe('xiangxin-reflex')
    const m = reflexModel('ticket-router')
    expectTypeOf(m).toEqualTypeOf<'xiangxin-reflex:ticket-router'>()
    expect(m).toBe('xiangxin-reflex:ticket-router')
    for (const bad of ['', 'Ticket', '-x', 'a_b', 'a'.repeat(64), '中文']) {
      expect(() => reflexModel(bad)).toThrow(TypeError)
    }
  })

  it('runs systemOne against a trained reflex; reflex_not_ready is a ConflictError and not retried', async () => {
    const { fetch, calls } = mockFetch(
      json({ ...SYSTEM_ONE_BODY, model: 'xiangxin-reflex:ticket-router' }),
      json({ detail: 'reflex_not_ready' }, 409),
    )
    const c = client(fetch)
    const r = await c.systemOne({ state: 'x', questions, model: reflexModel('ticket-router') })
    expect(calls[0]!.body.model).toBe('xiangxin-reflex:ticket-router')
    expect(r.model).toBe('xiangxin-reflex:ticket-router')
    const err = await c.systemOne({ state: 'x', questions, model: reflexModel('ticket-router') }).catch((e: any) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.detail).toBe('reflex_not_ready')
    expect(calls).toHaveLength(2)
  })
})

describe('reflexes.create', () => {
  it('POSTs the documented body and parses the reflex', async () => {
    const { fetch, calls } = mockFetch(json(reflex('queued', { queue_position: 2 })))
    const p = client(fetch).reflexes.create({ name: 'ticket-router', questions, examples, description: '工单分流' })
    expectTypeOf(p).toEqualTypeOf<APIPromise<Reflex>>()
    const { data: r, requestId } = await p.withResponse()
    expect(calls[0]!.url).toBe(BASE)
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.headers['content-type']).toBe('application/json')
    expect(calls[0]!.body).toEqual({
      name: 'ticket-router',
      description: '工单分流',
      questions: {
        department: { type: 'choice', instructions: '分派部门', criteria: { billing: '扣费、退款', technical: null } },
        is_urgent: { type: 'noul', instructions: '是否紧急？' },
        anger: { type: 'score', instructions: '多生气？', criteria: ['平静', '不满', '愤怒'] },
      },
      examples,
    })
    expect(r.status).toBe('queued')
    expect(r.queue_position).toBe(2)
    expect(r.usable).toBe(false)
    expect(r.metrics).toBeNull()
    expect(requestId).toBe('req_123')
  })

  it('types labels from the questions', () => {
    const c = client(mockFetch(json(reflex())).fetch)
    type Ex = ReflexExample<typeof questions>
    expectTypeOf<Ex['answers']['department']>().toEqualTypeOf<'billing' | 'technical' | undefined>()
    expectTypeOf<Ex['answers']['is_urgent']>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<Ex['answers']['anger']>().toEqualTypeOf<number | undefined>()
    void c.reflexes.create({
      name: 'r',
      questions,
      // @ts-expect-error 'sales' 不是选项 / not an option
      examples: [{ state: 's', answers: { department: 'sales' } }],
    })
    void c.reflexes.create({
      name: 'r',
      questions,
      // @ts-expect-error noul 的标注必须是布尔值 / noul labels are booleans
      examples: [{ state: 's', answers: { is_urgent: 'yes' } }],
    })
  })

  it('rejects invalid requests without calling fetch', async () => {
    const { fetch } = mockFetch(json(reflex()))
    const c = client(fetch)
    const bad: any[] = [
      { name: '', questions, examples },
      { name: 'r', questions: {}, examples },
      { name: 'r', questions, examples: [] },
      { name: 'r', questions, examples: [{ state: 's' }] },
      { name: 'r', questions: { a: { type: 'choice', criteria: {} } }, examples },
      { name: 'r', questions, examples, description: 1 },
    ]
    for (const req of bad) {
      await expect(c.reflexes.create(req)).rejects.toBeInstanceOf(XiangxinError)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [409, 'reflex_busy', ConflictError],
    [409, 'too_many_reflexes: at most 20', ConflictError],
    [422, 'too_few_examples: at least 10', UnprocessableEntityError],
    [422, 'invalid_reflex_name', UnprocessableEntityError],
    [413, 'request_too_large', RequestTooLargeError],
  ] as const)('does not retry %i %s', async (status, detail, Cls) => {
    const { fetch } = mockFetch(json({ detail }, status))
    const err = await client(fetch).reflexes.create({ name: 'ticket-router', questions, examples }).catch((e: any) => e)
    expect(err).toBeInstanceOf(Cls)
    expect(err.detail).toBe(detail)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries 503 trainer_unavailable', async () => {
    const { fetch } = mockFetch(json({ detail: 'trainer_unavailable' }, 503), json(reflex()))
    const r = await client(fetch).reflexes.create({ name: 'ticket-router', questions, examples })
    expect(r.status).toBe('queued')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses at least 300s and does not retry timeouts by default', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch('hang')
    let settled = false
    const p = client(fetch)
      .reflexes.create({ name: 'ticket-router', questions, examples })
      .catch((e: any) => e)
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(120_001)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(await p).toBeInstanceOf(APITimeoutError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('honours explicit timeout and retry overrides', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch('hang', json(reflex()))
    const p = client(fetch).reflexes.create(
      { name: 'ticket-router', questions, examples },
      { timeout: 50, retry: { apiTimeoutError: true } },
    )
    await vi.advanceTimersByTimeAsync(100)
    expect((await p).status).toBe('queued')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps a longer client timeout', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch('hang')
    let settled = false
    const p = client(fetch, { timeout: 600_000 })
      .reflexes.create({ name: 'ticket-router', questions, examples })
      .catch((e: any) => e)
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(300_001)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await p).toBeInstanceOf(APITimeoutError)
  })
})

describe('reflexes list / get / cancel / delete', () => {
  it('calls the documented endpoints', async () => {
    const { fetch, calls } = mockFetch(
      json({ reflexes: [reflex('ready'), reflex('training', { name: 'spam', id: 'rf_2' })] }),
      json(reflex('ready')),
      json(reflex('cancelled')),
      json({ ok: true }),
    )
    const c = client(fetch)
    const items = await c.reflexes.list()
    expect(items.map((r) => r.name)).toEqual(['ticket-router', 'spam'])
    const r = await c.reflexes.get('ticket-router')
    expect(r.usable).toBe(true)
    expect(r.metrics?.after?.accuracy).toBe(0.97)
    expect(r.metrics?.before?.log_loss).toBe(0.93)
    expect(r.metrics?.after?.per_question?.department?.n).toBe(240)
    expect(r.metrics?.evaluated_on).toBe('val')
    expect((await c.reflexes.cancel('ticket-router')).status).toBe('cancelled')
    expect(await c.reflexes.delete('ticket-router')).toBeUndefined()
    expect(calls.map((x) => `${x.init.method} ${x.url}`)).toEqual([
      `GET ${BASE}`,
      `GET ${BASE}/ticket-router`,
      `POST ${BASE}/ticket-router/cancel`,
      `DELETE ${BASE}/ticket-router`,
    ])
  })

  it('escapes names and maps 404', async () => {
    const { fetch, calls } = mockFetch(json({ detail: 'reflex_not_found' }, 404))
    const err = await client(fetch).reflexes.get('a/b').catch((e: any) => e)
    expect(calls[0]!.url).toBe(`${BASE}/a%2Fb`)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.detail).toBe('reflex_not_found')
  })

  it('parses tolerantly', async () => {
    const { fetch } = mockFetch(
      json({ id: 'rf_1', name: 'x', status: 'weird', new_field: 1 }),
      json(reflex('ready', { metrics: { after: { accuracy: 0.9, future: true }, something: 'new' } })),
      json({ nope: true }),
    )
    const c = client(fetch)
    const minimal = await c.reflexes.get('x')
    expect(minimal).toMatchObject({ usable: false, metrics: null, questions: {}, model: 'xiangxin-reflex:x', progress: 0 })
    expect(minimal).not.toHaveProperty('new_field')
    const partial = await c.reflexes.get('x')
    expect(partial.metrics?.after?.accuracy).toBe(0.9)
    expect(partial.metrics?.before).toBeUndefined()
    await expect(c.reflexes.get('x')).rejects.toThrow(/reflex/)
  })
})

describe('reflexes.wait', () => {
  it('polls until a final status', async () => {
    const { fetch } = mockFetch(json(reflex('queued')), json(reflex('training', { progress: 0.5 })), json(reflex('ready')))
    const r = await client(fetch).reflexes.wait('ticket-router', { pollIntervalMs: 1 })
    expect(r.status).toBe('ready')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('waits pollIntervalMs between polls', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch(json(reflex('training')), json(reflex('ready')))
    const p = client(fetch).reflexes.wait('ticket-router')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await p).status).toBe('ready')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('resolves failed trainings without throwing', async () => {
    const { fetch } = mockFetch(json(reflex('failed', { error: 'job_lost' })))
    const r = await client(fetch).reflexes.wait('ticket-router')
    expect(r.status).toBe('failed')
    expect(r.error).toBe('job_lost')
  })

  it('rejects with WaitTimeoutError after waitTimeoutMs', async () => {
    const { fetch } = mockFetch(json(reflex('training')))
    const err = await client(fetch).reflexes.wait('ticket-router', { waitTimeoutMs: 0 }).catch((e: any) => e)
    expect(err).toBeInstanceOf(WaitTimeoutError)
    expect(err.reflex.status).toBe('training')
    await expect(client(fetch).reflexes.wait('ticket-router', { pollIntervalMs: 0 })).rejects.toBeInstanceOf(XiangxinError)
  })

  it('propagates request errors and honours the abort signal', async () => {
    const { fetch } = mockFetch(json({ detail: 'boom' }, 500))
    await expect(client(fetch).reflexes.wait('ticket-router')).rejects.toBeInstanceOf(InternalServerError)
    expect(fetch).toHaveBeenCalledTimes(3)

    const controller = new AbortController()
    const { fetch: f2 } = mockFetch(json(reflex('training')))
    const p = client(f2).reflexes.wait('ticket-router', { pollIntervalMs: 60_000, signal: controller.signal })
    await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    await expect(p).rejects.toBeInstanceOf(APIUserAbortError)
  })
})
