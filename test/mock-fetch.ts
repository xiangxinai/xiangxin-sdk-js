import { vi } from 'vitest'
import type { Fetch } from '../src/index.js'

export interface Call {
  url: string
  init: RequestInit
  headers: Record<string, string>
  body: any
}

export type Reply = Response | Error | (() => Response | Promise<Response>) | 'hang'

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_123', ...headers },
  })
}

/** 按顺序返回预设响应的 fetch mock；最后一个响应会被重复使用。 */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = []
  let i = 0
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = { ...(init.headers as Record<string, string>) }
    calls.push({ url, init, headers, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const reply = replies[Math.min(i++, replies.length - 1)]
    if (reply === 'hang') return new Promise<Response>(() => {})
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply()
    return (reply as Response).clone()
  })
  return { fetch: fn as unknown as Fetch & typeof fn, calls }
}

export const SYSTEM_ONE_BODY = {
  model: 'xiangxin-1.0.0',
  answers: {
    is_urgent: { type: 'noul', noul: 0.95 },
    department: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.88, technical: 0.12, sales: 0.0 },
      confidence: 0.81,
    },
    frustration: {
      type: 'score',
      score: 1.05,
      legend: { '0': '平静', '1': '不满', '2': '非常愤怒' },
      probabilities: { '0': 0.0, '1': 0.95, '2': 0.05 },
      confidence: 0.92,
    },
  },
  usage: { input_tokens: 296, output_tokens: 20 },
}

export const MODELS_BODY = {
  models: [
    { name: 'xiangxin-latest', description: '最新正式版象信一号系统一模型', release_date: '2026-10-01' },
    { name: 'xiangxin-preview', description: '最新版本（含预览）', release_date: '2026-10-01' },
  ],
}

/** 根据请求里的问题生成形状正确的答案（第一个选项 / 最高档）。 / A fake server echoing well-formed answers. */
export async function fakeServer(url: string, init: RequestInit = {}): Promise<Response> {
  if (url.endsWith('/v1/models')) return json(MODELS_BODY)
  const { questions } = JSON.parse(String(init.body))
  const answers: Record<string, unknown> = {}
  for (const [name, q] of Object.entries<any>(questions)) {
    if (q.type === 'noul') answers[name] = { type: 'noul', noul: 0.9 }
    if (q.type === 'choice') {
      const labels = Object.keys(q.criteria)
      const probabilities = Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 1 : 0]))
      answers[name] = { type: 'choice', choice: labels[0], probabilities, confidence: 1 }
    }
    if (q.type === 'score') {
      const legend = Object.fromEntries(q.criteria.map((d: unknown, i: number) => [String(i), d]))
      const top = q.criteria.length - 1
      const probabilities = Object.fromEntries(q.criteria.map((_: unknown, i: number) => [String(i), i === top ? 1 : 0]))
      answers[name] = { type: 'score', score: top, legend, probabilities, confidence: 1 }
    }
  }
  return json({ model: 'xiangxin-1.0.0', answers, usage: { input_tokens: 10, output_tokens: 1 } })
}
