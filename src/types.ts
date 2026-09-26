/** 任意 JSON 值。 / A JSON-compatible value. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** JSON 对象。 / A JSON object. */
export type JsonObject = { readonly [key: string]: JsonValue }

/**
 * 文本、JSON 对象或数组，或 `null`；用于 instructions 与各项描述。
 *
 * Text, a JSON object or array, or `null`; used for instructions and descriptions.
 */
export type EntryType = string | JsonObject | readonly JsonValue[] | null

/** 选项或档位的描述；`null` 表示不加描述。 / A criterion description; `null` leaves it undescribed. */
export type Description = EntryType

/** 要判断的内容：文本、JSON 对象或数组。 / The content to evaluate: text, a JSON object, or an array. */
export type State = string | JsonObject | readonly JsonValue[]

// ---------------------------------------------------------------------------
// 问题 / Questions
// ---------------------------------------------------------------------------

/** Noul 问题中“是 / 否”两种结果的可选描述。 / Optional descriptions of the yes / no outcomes. */
export interface NoulCriteria {
  /** “是 / 成立”的含义。 / What a yes outcome means. */
  true?: EntryType
  /** “否 / 不成立”的含义。 / What a no outcome means. */
  false?: EntryType
}

/** 选项名 → 描述（`null` 表示不加描述）。最多 255 个选项。 / Labels mapped to descriptions; at most 255. */
export type ChoiceCriteria = { readonly [label: string]: EntryType }

/**
 * 从 0 分起、由低到高的各档描述，至少两档（API 接受 2–10 档）。
 *
 * Level descriptions from score 0 upward; at least two (the API accepts 2–10).
 */
export type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]]

/** 是非题：答案是“成立”的概率。 / A yes/no question; the answer is the probability of yes. */
export interface NoulQuestion {
  type: 'noul'
  /** 要问的问题。 / The question. */
  instructions?: EntryType
  /** “是 / 否”的可选描述。 / Optional descriptions of the outcomes. */
  criteria?: NoulCriteria | null
}

/** 单选题：在若干命名选项中选出最可能的一个。 / Selects between named alternatives. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: 'choice'
  /** 要问的问题。 / The question. */
  instructions?: EntryType
  /** 选项名 → 描述。 / Labels mapped to descriptions. */
  criteria: T
}

/** 打分题：按有序量表给出期望分数。 / Scores the state on an ordered rubric. */
export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: 'score'
  /** 要问的问题。 / The question. */
  instructions?: EntryType
  /** 由低到高的各档描述。 / Level descriptions, lowest first. */
  criteria: T
}

/** 以 `type` 区分的问题。 / A question discriminated by `type`. */
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion

/** 问题名 → 问题；答案用同样的名字返回。 / Questions keyed by the names used for their answers. */
export interface Questions {
  readonly [name: string]: Question
}

// ---------------------------------------------------------------------------
// 答案 / Answers
// ---------------------------------------------------------------------------

/**
 * 量表的档位键：定长元组得到各下标的字符串字面量（`"0" | "1" | …`），否则为 `number`。
 *
 * Score keys inferred from the rubric: indices of a fixed-length tuple, otherwise `number`.
 */
export type ScoreOf<T extends ScoreCriteria> = number extends T['length']
  ? number
  : Extract<keyof T, `${number}`>

/** 档位 → 该档描述。 / Rubric descriptions keyed by score. */
export type ScoreLegend<T extends ScoreCriteria = ScoreCriteria> = {
  readonly [K in ScoreOf<T>]: K extends keyof T ? T[K] : EntryType
}

/** 是非题答案。 / A yes/no answer. */
export interface NoulAnswer {
  readonly type: 'noul'
  /** “成立”的概率（0–1）。 / Probability of yes, from 0 to 1. */
  readonly noul: number
}

/** 单选题答案。 / A choice answer. */
export interface ChoiceAnswer<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: 'choice'
  /** 概率最高的选项名。 / The most probable label. */
  readonly choice: keyof T & string
  /** 每个选项的概率，总和为 1。 / Probability of each label; sums to 1. */
  readonly probabilities: { readonly [K in keyof T & string]: number }
  /** 对所选选项的置信度（0–1）。 / Confidence in the selected label (0–1). */
  readonly confidence: number
}

/** 打分题答案。 / A score answer. */
export interface ScoreAnswer<T extends ScoreCriteria = ScoreCriteria> {
  readonly type: 'score'
  /** 期望分数 Σ i·pᵢ，可能落在两档之间。 / Expected score; may fall between levels. */
  readonly score: number
  /** 档位 → 描述。 / Level → description. */
  readonly legend: ScoreLegend<T>
  /** 档位 → 概率。 / Level → probability. */
  readonly probabilities: { readonly [K in ScoreOf<T>]: number }
  /** 置信度（0–1），即最高档概率。 / Confidence: the peak level probability. */
  readonly confidence: number
}

/** 任意一种答案。 / Any answer. */
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer

/**
 * 由问题类型推出答案类型，保留 Choice 的选项名与 Score 的档位。
 *
 * The answer type for a question, preserving choice labels and score levels.
 */
export type ResultFor<T> = T extends { type: 'noul' }
  ? NoulAnswer
  : T extends { type: 'choice'; criteria: infer C extends ChoiceCriteria }
    ? ChoiceAnswer<C>
    : T extends { type: 'score'; criteria: infer S extends ScoreCriteria }
      ? ScoreAnswer<S>
      : T extends { type: 'score' }
        ? ScoreAnswer
        : T extends { type: 'choice' }
          ? ChoiceAnswer
          : Answer

/** 本次请求的 token 用量。 / Token usage for a request. */
export interface Usage {
  /** 输入 token 数（计费依据）。 / Input tokens (billed). */
  readonly input_tokens: number
  /** 输出 token 数（免费）。 / Output tokens (free). */
  readonly output_tokens: number
}

/** `systemOne` 的结果。 / Result of `systemOne`. */
export interface SystemOneResult<Q extends Questions = Questions> {
  /** 实际作答的模型版本，如 `xiangxin-1.0.0`。 / Resolved model, e.g. `xiangxin-1.0.0`. */
  readonly model: string
  /** 按问题名索引、带类型的答案。 / Typed answers keyed by question name. */
  readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> }
  /** token 用量。 / Token usage. */
  readonly usage: Usage
}

/** `systemOne` 的请求参数。 / Arguments of `systemOne`. */
export interface SystemOneRequest<Q extends Questions = Questions> {
  /** 要判断的内容。 / The content to evaluate. */
  state: State
  /** 非空的问题映射。 / Non-empty named questions. */
  questions: Q
  /** 覆盖客户端默认模型。 / Overrides the client's default model. */
  model?: string
  /** 其他字段原样合并到请求体顶层。 / Extra fields are forwarded at the body's top level. */
  [extra: string]: unknown
}

/** `POST /v1/systemone` 的请求体（模型已解析）。 / Request body with the model resolved. */
export interface SystemOneRequestPayload {
  state: State
  questions: Questions
  model: string
  [extra: string]: unknown
}

/** 单个可用模型的元数据。 / Metadata of an available model. */
export interface ModelCard {
  /** 模型名或别名，可直接用于 `model`。 / Name or alias accepted by `model`. */
  readonly name: string
  /** 模型说明。 / Description. */
  readonly description: string
  /** 发布日期 `YYYY-MM-DD`。 / Release date `YYYY-MM-DD`. */
  readonly release_date: string
}

// ---------------------------------------------------------------------------
// 条件反射 / Reflexes
// ---------------------------------------------------------------------------

/** 一条标注：Noul 为布尔值，Choice 为选项名，Score 为档位下标（从 0 起）。 / One label. */
export type ReflexLabel = boolean | string | number

/**
 * 由问题类型推出标注类型：Noul → `boolean`，Choice → 选项名，Score → 档位下标。
 *
 * The label type for a question: boolean, a choice label, or a score level index.
 */
export type LabelFor<T> = T extends { type: 'noul' }
  ? boolean
  : T extends { type: 'choice'; criteria: infer C extends ChoiceCriteria }
    ? keyof C & string
    : T extends { type: 'score' }
      ? number
      : ReflexLabel

/**
 * 练反射用的一条样本；`answers` 可以只标部分问题。
 *
 * One training example; `answers` may label only some of the questions.
 */
export interface ReflexExample<Q extends Questions = Questions> {
  /** 样本内容。 / The example's state. */
  state: State
  /** 问题名 → 标注。 / Question name → label. */
  answers: { readonly [K in keyof Q]?: LabelFor<Q[K]> }
}

/** 阻止 TypeScript 从该位置推断泛型。 / Blocks generic inference at this position. */
type NoInfer_<T> = [T][T extends unknown ? 0 : never]

/** `reflexes.create` 的请求参数。 / Arguments of `reflexes.create`. */
export interface ReflexCreateRequest<Q extends Questions = Questions> {
  /** 反射名，满足 `^[a-z0-9][a-z0-9-]{0,62}$`；同名已存在则重练。 / Reflex name; an existing name is retrained. */
  name: string
  /** 问题定义（≤ 32 个），与 `systemOne` 相同。 / Questions (at most 32), as for `systemOne`. */
  questions: Q
  /** 10–50,000 条标注样本。 / 10–50,000 labeled examples. */
  examples: readonly ReflexExample<NoInfer_<Q>>[]
  /** 可选说明（≤ 500 字）。 / Optional description. */
  description?: string
  /** 其他字段原样合并到请求体顶层。 / Extra fields are forwarded at the body's top level. */
  [extra: string]: unknown
}

/** 反射状态。 / Reflex status. */
export type ReflexStatus = 'queued' | 'training' | 'ready' | 'failed' | 'cancelled'

/** 单个问题上的成绩。 / Scores on one question. */
export interface ReflexQuestionMetrics {
  /** 准确率（0–1）。 / Accuracy (0–1). */
  readonly accuracy?: number
  /** 参与评测的标注条数。 / Number of labels evaluated. */
  readonly n?: number
}

/** 一组评测成绩（练之前或练之后）。 / One set of evaluation scores. */
export interface ReflexEvaluation {
  /** 准确率（0–1）。 / Accuracy (0–1). */
  readonly accuracy?: number
  /** 对数损失，越小越好。 / Log loss; lower is better. */
  readonly log_loss?: number
  /** 期望校准误差，越小越好。 / Expected calibration error; lower is better. */
  readonly ece?: number
  /** 问题名 → 该问题的成绩。 / Question name → its scores. */
  readonly per_question?: { readonly [name: string]: ReflexQuestionMetrics }
}

/**
 * 训练结果。样本 ≥ 20 条时按留出的验证集计，否则按训练集计（见 `evaluated_on`）。
 *
 * Training results, measured on a held-out split with ≥ 20 examples, else on the training set.
 */
export interface ReflexMetrics {
  /** 样本总数。 / Total examples. */
  readonly examples?: number
  /** 训练集条数。 / Training examples. */
  readonly train_examples?: number
  /** 验证集条数。 / Validation examples. */
  readonly val_examples?: number
  /** `"val"` 或 `"train"`。 / `"val"` or `"train"`. */
  readonly evaluated_on?: string
  /** 实际训练轮数。 / Epochs trained. */
  readonly epochs?: number
  /** 训练耗时（秒）。 / Training time in seconds. */
  readonly duration_s?: number
  /** 基础条件反射在同一评测集上的成绩（练之前）。 / The base reflex on the same split. */
  readonly before?: ReflexEvaluation | null
  /** 练之后的成绩。 / Scores after training. */
  readonly after?: ReflexEvaluation | null
}

/** 一个练出来的条件反射。推理时把 `model` 传给 `systemOne`。 / A trained reflex; pass `model` to `systemOne`. */
export interface Reflex {
  /** 反射 ID，如 `rf_…`。 / Reflex ID. */
  readonly id: string
  /** 反射名。 / Reflex name. */
  readonly name: string
  /** 推理用模型名 `xiangxin-reflex:<name>`。 / Model name for inference. */
  readonly model: string
  /** 说明。 / Description. */
  readonly description: string
  /** 状态；未来可能出现新的取值。 / Status; new values may appear. */
  readonly status: ReflexStatus | (string & {})
  /** 已有练好的版本可用于推理（重练期间旧版本照常可用）。 / A trained version is live. */
  readonly usable: boolean
  /** 当前训练进度（0–1）。 / Progress of the current training. */
  readonly progress: number
  /** 当前阶段。 / Current stage. */
  readonly stage: string | null
  /** 排队位置（仅 `queued` 时）。 / Queue position while `queued`. */
  readonly queue_position?: number
  /** 问题定义。 / Question definitions. */
  readonly questions: { readonly [name: string]: JsonValue }
  /** 最近一次提交的样本条数。 / Number of examples last submitted. */
  readonly examples: number | null
  /** 最近一次成功训练的成绩。 / Results of the last successful training. */
  readonly metrics: ReflexMetrics | null
  /** 失败原因。 / Failure reason. */
  readonly error: string | null
  /** 创建时间（ISO 8601）。 / Creation time. */
  readonly created_at: string | null
  /** 最近一次状态变化时间。 / Time of the last status change. */
  readonly updated_at: string | null
  /** 最近一次训练完成时间。 / Time the last training finished. */
  readonly trained_at: string | null
}

/** 与全局 `fetch` 兼容的实现。 / A fetch implementation compatible with the global `fetch`. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** 解析后的数据、HTTP 响应与请求 ID。 / Parsed data with its HTTP response and request ID. */
export interface WithResponse<T> {
  /** 解析后的响应体。 / The parsed body. */
  data: T
  /** HTTP 响应（响应体已被读取）。 / The HTTP response; its body has been consumed. */
  response: Response
  /** `x-request-id` 响应头。 / The `x-request-id` header, if present. */
  requestId: string | undefined
}
