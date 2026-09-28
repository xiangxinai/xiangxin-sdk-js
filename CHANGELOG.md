# 更新日志

## 0.2.1 — 2026-09-28

重试策略与 TypeSafe 官方 SDK 对齐：
- 默认重试的状态码从 `429 / 500 / 502 / 503 / 504 / 529` 扩大为 `408`、`429` 与**所有 5xx**。
- 指数退避单次上限从 8 秒改为 **5 秒**（0.5 秒起翻倍，随机扣减最多 25%）。
- 服务端建议的等待（`retry-after-ms` / `retry-after`）超过 `maxRetryAfterMs`（默认 60 秒）时，不再直接放弃，而是改按指数退避重试。
- 重试请求带 `x-xiangxin-retry-count: n`，首发请求不带；服务端据此区分首发与重试。

## 0.2.0 — 2026-09-27

- 默认模型为 `xiangxin-s1-latest`（条件反射对应 `xiangxin-reflex-latest`），响应里的版本号为 `xiangxin-s1-1.0.0` / `xiangxin-reflex-1.0.0`。
- 新增**条件反射**（`xiangxin-reflex`）支持：`client.reflexes.create / list / get / cancel / delete / wait`，类型 `Reflex`、`ReflexMetrics`（`before` / `after` 的 `accuracy`、`log_loss`、`ece`、`per_question`）、`ReflexExample`（标注类型由问题推断）。
- 新增模型常量 `S1_MODEL`（`xiangxin-s1`）、`REFLEX_MODEL`（`xiangxin-reflex`）、`REFLEX_CREATE_TIMEOUT_MS` 与 `reflexModel(name)`（`xiangxin-reflex:<name>`）。
- 新增错误类 `ConflictError`（409：`reflex_not_ready` / `reflex_busy` / `too_many_reflexes`）、`RequestTooLargeError`（413）与 `WaitTimeoutError`。
- `reflexes.create` 默认超时不短于 300 秒，且默认不重试超时（409 / 422 从不重试）。

## 0.1.1 — 2026-09-26

- 默认超时从 30 秒调整为 **120 秒**（`DEFAULT_TIMEOUT_MS = 120_000`）。服务端现在支持 32k token 的 `state`（单请求 64k），长文档加多个问题的请求可能需要数十秒；原来的 30 秒会让这类请求超时并被自动重试。
- 发布改为 GitHub Actions + npm Trusted Publishing 自动完成，并附带 provenance。

## 0.1.0 — 2026-09-25

- 首个版本：`XiangxinClient`、`choice()` / `score()` / `noul()` 类型推断、`APIPromise.withResponse()`、自动重试、`models.list()`。
