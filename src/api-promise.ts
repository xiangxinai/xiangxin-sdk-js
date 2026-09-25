import { REQUEST_ID_HEADER } from './constants.js'
import type { WithResponse } from './types.js'

/** 一次成功请求的原始结果：响应与已缓冲的响应体文本。 / A buffered successful response. */
export interface RawResponse {
  response: Response
  body: string
}

/**
 * 解析结果的 Promise，同时可以拿到 HTTP 响应。直接 `await` 得到解析后的数据；
 * 调用 `.withResponse()` 额外得到 `Response` 与请求 ID。非 2xx 响应会以 `APIError` 拒绝。
 *
 * A promise for the parsed result that also exposes the HTTP response. Await it
 * for the data, or call `.withResponse()` for the `Response` and request ID too.
 * Non-2xx responses reject with an `APIError`.
 */
export class APIPromise<T> extends Promise<T> {
  #parsed: Promise<T> | undefined
  readonly #raw: Promise<RawResponse>
  readonly #parse: (raw: RawResponse) => T | Promise<T>

  static override get [Symbol.species]() {
    return Promise
  }

  constructor(raw: Promise<RawResponse>, parse: (raw: RawResponse) => T | Promise<T>) {
    super((resolve) => resolve(null as T))
    this.#raw = raw
    this.#parse = parse
  }

  #data(): Promise<T> {
    if (!this.#parsed) this.#parsed = this.#raw.then((raw) => this.#parse(raw))
    return this.#parsed
  }

  /**
   * 返回原始 `Response`，不解析响应体。SDK 已在超时时间内把响应体读入内存，
   * 这里返回的是它的一个新副本，可自由读取。
   *
   * Resolve to the raw `Response` without parsing. The SDK has already buffered
   * the body within the timeout; this is a fresh copy you may read freely.
   */
  asResponse(): Promise<Response> {
    return this.#raw.then(({ response, body }) => {
      const nullBody = [101, 204, 205, 304].includes(response.status)
      return new Response(nullBody ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    })
  }

  /**
   * 同时返回解析后的数据、HTTP 响应与 `x-request-id`。
   *
   * Resolve to the parsed data, the HTTP response, and the `x-request-id`.
   */
  async withResponse(): Promise<WithResponse<T>> {
    const [{ response }, data] = await Promise.all([this.#raw, this.#data()])
    return { data, response, requestId: response.headers.get(REQUEST_ID_HEADER) ?? undefined }
  }

  /**
   * 变换解析结果，共享同一个 HTTP 响应与同一次解析。
   *
   * Transform the parsed result, sharing the HTTP response and a single parse.
   */
  map<U>(fn: (data: T) => U | Promise<U>): APIPromise<U> {
    return new APIPromise<U>(this.#raw, () => this.#data().then(fn))
  }

  override then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#data().then(onfulfilled, onrejected)
  }

  override catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.#data().catch(onrejected)
  }

  override finally(onfinally?: (() => void) | null): Promise<T> {
    return this.#data().finally(onfinally)
  }
}
