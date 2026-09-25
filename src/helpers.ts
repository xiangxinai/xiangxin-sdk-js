import type {
  ChoiceCriteria,
  ChoiceQuestion,
  EntryType,
  NoulCriteria,
  NoulQuestion,
  ScoreCriteria,
  ScoreQuestion,
} from './types.js'

/**
 * 创建是非题（noul = “no or yes”），答案是“成立”的概率。
 *
 * Create a yes/no question; its answer is the probability of yes.
 *
 * @param instructions 要问的问题。 / The question.
 * @param criteria “是 / 否”的可选描述。 / Optional descriptions of both outcomes.
 *
 * @example
 * noul('用户是否要求退款？')
 * noul('评论是否含人身攻击？', { true: '辱骂、贬低他人', false: '正常批评' })
 */
export function noul(instructions: EntryType = null, criteria: NoulCriteria | null = null): NoulQuestion {
  const q: NoulQuestion = { type: 'noul', instructions }
  if (criteria != null) q.criteria = criteria
  return q
}

/**
 * 创建单选题。选项名会被推断为字面量，答案的 `choice` 因此带有精确类型。
 *
 * Create a single-choice question. Labels are inferred as literals, so the
 * answer's `choice` is typed as their union.
 *
 * @param instructions 要问的问题。 / The question.
 * @param criteria 选项名 → 描述（`null` 表示不加描述）。 / Labels mapped to descriptions.
 *
 * @example
 * choice('工单应分派到哪个部门？', { billing: '扣费、退款', technical: '报错与故障', sales: null })
 */
export function choice<const T extends ChoiceCriteria>(instructions: EntryType, criteria: T): ChoiceQuestion<T> {
  return { type: 'choice', instructions, criteria }
}

/**
 * 创建打分题。`criteria` 由低到高排列，第 i 项是 i 分的描述；至少两档。
 *
 * Create a score question. `criteria` lists one description per level,
 * lowest first; at least two levels.
 *
 * @example
 * score('用户的情绪有多激动？', ['平静', '不满', '非常愤怒'])
 */
export function score<const T extends ScoreCriteria>(instructions: EntryType, criteria: T): ScoreQuestion<T> {
  return { type: 'score', instructions, criteria }
}
