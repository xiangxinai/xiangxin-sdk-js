import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  XiangxinClient,
  choice,
  noul,
  score,
  type APIPromise,
  type ChoiceAnswer,
  type NoulAnswer,
  type ResultFor,
  type ScoreAnswer,
  type SystemOneResult,
  type WithResponse,
  type ModelCard,
} from '../src/index.js'

import { fakeServer } from './mock-fetch.js'

// 类型断言由 `pnpm typecheck`（tsc）验证；运行时使用 mock fetch，不访问网络。
const client = new XiangxinClient({
  apiKey: 'sk-xx-test',
  logLevel: 'off',
  fetch: fakeServer,
})

describe('type inference', () => {
  it('infers literal choice labels and score legend keys from helpers', async () => {
    const p = client.systemOne({
      state: '我被重复扣费了两次',
      questions: {
        urgent: noul('是否紧急？'),
        dept: choice('哪个部门？', { billing: '扣费', technical: null }),
        anger: score('多生气？', ['平静', '不满', '愤怒']),
      },
    })
    expectTypeOf(p).toMatchTypeOf<APIPromise<SystemOneResult<any>>>()
    const r = await p
    expectTypeOf(r.answers.urgent).toEqualTypeOf<NoulAnswer>()
    expectTypeOf(r.answers.dept.choice).toEqualTypeOf<'billing' | 'technical'>()
    expectTypeOf(r.answers.dept.probabilities).toEqualTypeOf<{ readonly billing: number; readonly technical: number }>()
    expectTypeOf<keyof typeof r.answers.anger.legend>().toEqualTypeOf<'0' | '1' | '2'>()
    expectTypeOf(r.answers.anger.legend['2']).toEqualTypeOf<'愤怒'>()
    expectTypeOf(r.answers.anger.score).toBeNumber()
    expect(r.answers.dept.choice).toBe('billing')
    expect(r.answers.anger.legend['2']).toBe('愤怒')
    // @ts-expect-error 'sales' 不是该问题的选项
    if (r.answers.dept.choice === 'sales') return
    // @ts-expect-error 不存在的问题名
    void r.answers.missing
    // @ts-expect-error 量表只有 0–2 档
    void r.answers.anger.legend['3']
  })

  it('infers from plain question objects too', async () => {
    const r = await client.systemOne({
      state: { 工单: '...' },
      questions: {
        team: { type: 'choice', criteria: { a: null, b: '描述' } },
        level: { type: 'score', criteria: ['低', '高'] },
        yes: { type: 'noul' },
      },
    })
    expectTypeOf(r.answers.team.choice).toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<keyof typeof r.answers.level.legend>().toEqualTypeOf<'0' | '1'>()
    expectTypeOf(r.answers.yes.noul).toBeNumber()
  })

  it('falls back to wide types for dynamic criteria', () => {
    const labels: Record<string, string | null> = {}
    const rubric: [string, string, ...string[]] = ['a', 'b']
    type C = ResultFor<ReturnType<typeof choice<typeof labels>>>
    type S = ResultFor<ReturnType<typeof score<typeof rubric>>>
    expectTypeOf<C>().toMatchTypeOf<ChoiceAnswer>()
    expectTypeOf<C['choice']>().toEqualTypeOf<string>()
    expectTypeOf<S>().toMatchTypeOf<ScoreAnswer>()
  })

  it('types withResponse() and models.list()', async () => {
    const w = await client.models.list().withResponse()
    expectTypeOf(w).toEqualTypeOf<WithResponse<ModelCard[]>>()
    expectTypeOf(w.requestId).toEqualTypeOf<string | undefined>()
  })

  it('rejects malformed questions at compile time', () => {
    // @ts-expect-error score 至少需要两档
    void score('x', ['only one'])
    // @ts-expect-error 未知的问题类型
    void client.systemOne({ state: 'x', questions: { q: { type: 'rank' } } }).catch(() => {})
  })
})
