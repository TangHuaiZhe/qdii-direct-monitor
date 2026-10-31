# AGENTS.md

## 项目定位

本项目监控国内纳斯达克 100 及相关指数 QDII 基金的申购状态、每日额度、费率和持仓。直销优先，代销用于补充；所有结果必须绑定明确的基金份额、销售入口、证据来源和可靠性等级。

基金范围、份额类别、数据源及持仓映射以 `config/funds.example.json` 为准，不在文档或代码中维护重复清单。

## 不可破坏的规则

- 每条 observation 只表示一个基金份额和一个销售入口。
- 严格区分 `direct/web/app/counter/all` 与 `agency/eastmoney/alipay/bank/broker/all`。
- 不同渠道额度不得合并或相加；购买便利度只取每只基金最高的可信可用渠道。
- 无法安全解析时返回 `unknown/D`，不得推断为 `open` 或 `limited`。
- 当次 D 级结果可以展示，但不得覆盖上一条 A-C 级比较基线。
- 公告表示公开规则，不等于登录后的真实下单验证；页面文案必须保留该边界。
- 费率、持仓和额度都必须保留来源及可靠性；抓取失败时同样遵循失败关闭原则。
- 不访问登录接口，不绕过验证码，不保存 Cookie、账户信息或其他凭据。

## 代码入口

- `src/cli.ts`：`run` / `watch` 命令及运行摘要。
- `src/collector.ts`：聚合直销、代销、费率和持仓，维护可信比较快照。
- `src/adapters/*.ts`：各基金公司的官方来源和解析流程。
- `src/parser.ts`：通用 HTML/PDF 状态与额度解析。
- `src/agency.ts`：天天基金及短期人工渠道记录。
- `src/fees.ts`、`src/holdings.ts`：费率和持仓采集。
- `src/model.ts`：标准化、快照键和变化检测。
- `src/report.ts`、`src/site.ts`：看板、详情页和静态站点。
- `src/notify.ts`：邮件、飞书和通用 webhook。
- `miniapp/`：只消费公开 `latest.json` 的原生微信小程序。

## 数据源与解析

- 每家基金公司的逻辑放在独立的 `src/adapters/*.ts` 中，并维护最小官方域名白名单。
- 优先使用当前官方产品/交易展示页，其次使用官方公告 HTML/PDF，最后回退到 `unknown`。
- 默认使用 HTTPS；只有官方入口确实仅提供 HTTP 且主机已加入白名单时才允许例外。
- 跳转后的最终主机也必须通过白名单校验，不添加第三方短链。
- 公告未明确销售范围时，不得擅自标记为 `web`、`app` 或 `counter`。
- 修改解析规则时只增加覆盖真实页面结构的最小规则，并补充 fixture 测试。
- 测试必须覆盖页面变形、字段缺失和错误基金代码，确认它们不会产生虚假的开放或限额结果。
- 支付宝、银行和券商只能使用带 `verifiedAt`、`expiresAt` 的人工记录；过期后必须自动失效。

## 修改约束

- 优先小而可验证的改动，不为单一站点问题重构无关模块。
- 新增基金时同步配置 `strategy`、币种、份额类别、官方来源、adapter 和 `portfolioMappings`。
- 不根据基金名称推断主动/被动、币种、份额类别、渠道或额度口径。
- 保持 `data/latest.json` 的既有字段兼容；修改 schema 时同步更新网站、小程序和测试。
- 网站与小程序必须继续明确区分直销、代销和证据链接。
- 不手工修改生成目录 `data/` 或 `site/`。

## 验证

Node.js 版本要求为 22 或更高。代码修改至少运行：

```bash
npm ci
npm test
npm run typecheck
npm start
npm run build:site
```

只修改文档时可跳过联网抓取和构建，但至少核对命令、路径和配置与实现一致。修改 `miniapp/` 时额外运行 `npm run check:miniapp`。

检查 `npm start` 摘要包含 `observedAt`、`rows`、`warnings`、`health` 和输出路径。上游网络失败可以产生告警，但不得静默降级或用推测值替代当前结果。

## 数据与安全

- 不提交 `data/`、`site/`、`node_modules/`、`.env` 或 `config/funds.local.json`。
- SMTP、webhook 等密钥只通过环境变量或 GitHub Actions Secrets 提供。
- Pages 发布内容由 `src/site.ts` 决定，包括看板、`latest.json`、SEO 文件、社交图片和基金详情页。
- `state.json`、`history/` 和事件缓存只用于变化检测与审计，不得公开。

## 发布

- `.github/workflows/pages.yml` 在 `main` push、手动触发及工作日北京时间 09:10、14:30、20:30 运行。
- 未经用户明确要求，不创建提交或推送远端。
- 提交时只包含本任务相关改动，不混入其他工作区内容。
- 修改工作流后，应检查一次完整云端运行，确认测试、抓取、缓存、上传和 Pages 部署成功。
- 云端来源受限时必须显示告警并可靠降级，不得把旧值或推测值冒充当前抓取结果。
