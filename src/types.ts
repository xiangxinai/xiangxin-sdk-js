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
