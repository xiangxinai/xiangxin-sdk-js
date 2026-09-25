# 象信 AI JavaScript / TypeScript SDK

`@xiangxinai/sdk` 是 [象信 AI](https://xiangxinai.cn) 的官方 JavaScript / TypeScript SDK，用于调用**象信一号**系统一模型。

象信一号不生成文本：你给它一段**状态（state）**和一组**带类型的问题**，它一次前向就返回带校准概率的结构化答案。

| 原语 | 辅助函数 | 答案字段 |
|---|---|---|
| Noul 是非题 | `noul(instructions, criteria?)` | `.noul`：成立的概率 0–1 |
| Choice 单选题（≤ 255 个选项） | `choice(instructions, criteria)` | `.choice`、`.probabilities`、`.confidence` |
| Score 打分题（2–10 档） | `score(instructions, criteria)` | `.score`、`.legend`、`.probabilities`、`.confidence` |

- 答案类型从问题自动推断：`answers.dept.choice` 的类型就是你写的选项名联合，例如 `'billing' | 'technical'`。
- 零运行时依赖，基于全局 `fetch`：Node.js ≥ 18、Deno、Bun、Cloudflare Workers 等均可使用，也可以传入自定义 `fetch`。
- 同时提供 ESM、CommonJS 与类型声明。
- 自动重试（429 / 529 / 5xx / 连接错误，指数退避加抖动，遵守 `retry-after`）、超时与 `AbortSignal` 取消。

完整文档：<https://docs.xiangxinai.cn/sdk/javascript>

## 安装

```bash
npm install @xiangxinai/sdk
# 或
pnpm add @xiangxinai/sdk
# 或
yarn add @xiangxinai/sdk
```

## 快速开始

在 [控制台 → API 密钥](https://console.xiangxinai.cn/keys) 创建密钥，并设置环境变量：

```bash
export XIANGXIN_API_KEY="sk-xx-..."
```

```ts
import { XiangxinClient, choice, noul, score } from '@xiangxinai/sdk'

const client = new XiangxinClient() // 自动读取 XIANGXIN_API_KEY

const { answers, usage, model } = await client.systemOne({
  state: '我这个月被重复扣费了两次，客服三天都没回复，请尽快处理！',
  questions: {
    is_urgent: noul('这张工单是否需要当天处理？'),
    department: choice('应分派到哪个部门？', {
      billing: '扣费、发票、退款',
      technical: '报错、故障、无法登录',
      sales: '购买咨询、套餐升级',
    }),
    frustration: score('用户的情绪有多激动？', ['平静', '不满', '非常愤怒']),
  },
})

answers.is_urgent.noul          // 0.95
answers.department.choice       // 'billing'，类型为 'billing' | 'technical' | 'sales'
answers.department.confidence   // 0.81
answers.frustration.score       // 1.05
answers.frustration.legend['2'] // '非常愤怒'
console.log(model, usage.input_tokens) // xiangxin-1.0.0 296
```

CommonJS 同样可用：

```js
const { XiangxinClient, noul } = require('@xiangxinai/sdk')
```

问题也可以直接写成对象，与辅助函数完全等价：

```ts
await client.systemOne({
  state: { 标题: '无法登录', 正文: '输入验证码后一直转圈' },
  questions: {
    is_bug: { type: 'noul', instructions: '这是产品缺陷吗？' },
    severity: { type: 'score', instructions: '严重程度', criteria: ['轻微', '一般', '严重'] },
  },
})
```

## 模型

```ts
const models = await client.models.list()
for (const m of models) console.log(m.name, m.release_date, m.description)
```

默认模型为 `xiangxin-latest`。可以用 `new XiangxinClient({ defaultModel })` 或单次调用的 `model` 覆盖。

## 读取响应头

```ts
const { data, response, requestId } = await client.systemOne({ state, questions }).withResponse()
response.headers.get('x-xiangxin-model-ms') // 模型耗时（毫秒）
```

## 错误处理

所有错误都继承自 `XiangxinError`：

| 错误类 | 状态码 | 场景 |
|---|---|---|
| `AuthenticationError` | 401 | API 密钥缺失、无效或已禁用 |
| `InsufficientBalanceError` | 402 | 余额不足，请到控制台充值 |
| `PermissionDeniedError` | 403 | 无权访问 |
| `NotFoundError` | 404 | 模型不存在 |
| `UnprocessableEntityError` | 422 | 请求校验失败（选项过多、超出 token 上限等） |
| `RateLimitError` | 429 | 超出速率限制（`.retryAfter` 为建议等待秒数） |
| `OverloadedError` | 529 | 服务过载，稍后重试 |
| `InternalServerError` | 其他 5xx | 服务端错误 |
| `APIConnectionError` / `APITimeoutError` | — | 网络错误 / 超时 |
| `APIUserAbortError` | — | 调用方通过 `AbortSignal` 取消 |

```ts
import { APIError, InsufficientBalanceError } from '@xiangxinai/sdk'

try {
  await client.systemOne({ state, questions })
} catch (err) {
  if (err instanceof InsufficientBalanceError) console.log('余额不足，请充值')
  else if (err instanceof APIError) console.log(err.status, err.detail, err.requestId)
  else throw err
}
```

## 重试、超时与取消

默认对 429、500、502、503、504、529 以及连接错误 / 超时重试 2 次，指数退避加抖动；服务端返回 `retry-after` / `retry-after-ms` 时按其等待（最长 60 秒）。422 等客户端错误不会重试。

```ts
const client = new XiangxinClient({
  timeout: 10_000,                              // 每次尝试的超时（毫秒），默认 30000
  retry: { maxRetries: 4, backoffMaxMs: 4_000 },
})

const controller = new AbortController()
await client.systemOne({ state, questions }, { timeout: 5_000, retry: { maxRetries: 0 }, signal: controller.signal })
```

## 日志

`logLevel` 或环境变量 `XIANGXIN_LOG` 设为 `debug` / `info` / `warn`（默认）/ `error` / `off`。`info` 每个请求输出一行摘要，`debug` 额外输出请求头与正文。`Authorization` 等鉴权头会被隐去，SDK 任何情况下都不会记录 API 密钥。

```ts
const client = new XiangxinClient({ logLevel: 'info', logger: myLogger }) // logger 兼容 console
```

## 环境变量

| 变量 | 作用 | 默认值 |
|---|---|---|
| `XIANGXIN_API_KEY` | API 密钥（必填） | — |
| `XIANGXIN_BASE_URL` | API 根地址 | `https://api.xiangxinai.cn` |
| `XIANGXIN_DEFAULT_MODEL` | 默认模型 | `xiangxin-latest` |
| `XIANGXIN_LOG` | 日志级别 | `warn` |

显式传入的参数优先于环境变量。

> [!WARNING]
> **不要把 API 密钥下发到浏览器。** 密钥属于组织，任何拿到它的人都能以你的组织身份调用并产生费用。请在你自己的服务端（Node.js、边缘函数等）调用象信，再由前端请求你的服务端代理。SDK 检测到浏览器环境时默认拒绝创建客户端；`dangerouslyAllowBrowser: true` 仅适用于内部工具等密钥不会外泄的场景。

## 开发

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
```

## 许可证

Apache-2.0，见 [LICENSE](./LICENSE)。
