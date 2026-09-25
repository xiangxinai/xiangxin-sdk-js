# 更新日志

## 0.1.1 — 2026-09-26

- 默认超时从 30 秒调整为 **120 秒**（`DEFAULT_TIMEOUT_MS = 120_000`）。服务端现在支持 32k token 的 `state`（单请求 64k），长文档加多个问题的请求可能需要数十秒；原来的 30 秒会让这类请求超时并被自动重试。
- 发布改为 GitHub Actions + npm Trusted Publishing 自动完成，并附带 provenance。

## 0.1.0 — 2026-09-25

- 首个版本：`XiangxinClient`、`choice()` / `score()` / `noul()` 类型推断、`APIPromise.withResponse()`、自动重试、`models.list()`。
