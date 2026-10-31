# QDII Direct Monitor

[公开看板](https://tanghuaizhe.github.io/qdii-direct-monitor/) · [更新状态](https://github.com/TangHuaiZhe/qdii-direct-monitor/actions/workflows/pages.yml)

监控国内纳斯达克 100 及相关指数 QDII 基金的申购状态、每日额度和费率。项目优先采集基金公司直销信息，以天天基金等代销渠道补充，并为每条结果保留明确的基金份额、销售入口、证据来源和可靠性等级。

> 公开网页和公告不等于登录后的真实下单结果。无法安全解析时，系统返回 `unknown/D`，不会猜测为开放申购。本项目仅提供信息监控，不构成投资建议。

## 核心能力

- 18 家基金公司的独立 adapter，均通过官方域名白名单限制抓取范围。
- 按“官方产品/交易页 → 官方公告 → `unknown`”回退，支持 HTML 和 PDF。
- 分开记录直销 Web、APP、柜台及各类代销入口，不合并不同渠道的额度。
- 采集管理费、托管费和销售服务费，并计算年综合费率。
- 对 ETF 联接基金进行底层持仓穿透，对主动基金展示公开持仓。
- 保存渠道快照，检测状态、额度及渠道变化；抓取降级不会覆盖上一条可信比较基线。
- 生成静态看板、基金详情页和 JSON 数据，并支持邮件、飞书或通用 webhook 通知。
- 提供原生微信小程序，读取与公开看板相同的 `latest.json`。

默认基金池见 [`config/funds.example.json`](config/funds.example.json)，它是基金范围、份额类别、数据源和持仓映射的唯一准确信息源。

## 数据模型

每条 observation 只描述一个基金份额和一个销售入口。渠道不会跨入口合并或相加：

| 销售关系 | 入口 | 含义 |
|---|---|---|
| `direct` | `web` / `app` / `counter` | 基金公司网上直销、APP 或柜台 |
| `direct` | `all` | 官方材料只写“直销机构”，无法继续细分 |
| `agency` | `eastmoney` | 天天基金公开销售页 |
| `agency` | `alipay` / `bank` / `broker` | 需登录的代销渠道，通常依赖短期人工核验 |
| `agency` | `all` | 材料只写“代销机构”，无法继续细分 |

可靠性等级：

| 等级 | 证据 | 使用边界 |
|---|---|---|
| A | 当前官方产品或交易展示页明确给出渠道及状态/额度 | 强证据，但仍非真实下单 |
| B | 官方公告明确给出渠道，或当前代销公开销售页 | 可用于监控，交易前建议复核 |
| C | 官方材料渠道不明确，或有效期内的人工核验 | 仅作提示 |
| D | 入口失败、页面变形或无法安全解析 | 状态固定为 `unknown` |

公告描述公开规则，产品页描述当前展示状态，两者可能暂时不同。系统保留各自证据，D 级临时结果不会覆盖已有的 A-C 级比较基线。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm test
npm start
npm run build:site
```

`npm start` 使用默认基金池执行一次抓取，结果写入 `data/`；`npm run build:site` 根据结果生成 `site/`。持续运行可使用 `npm run watch`，默认间隔 30 分钟且最低为 5 分钟。生产环境建议由 cron、launchd 或 CI 定时执行单次抓取，而不是依赖常驻进程。

自定义基金池时使用不会提交到仓库的本地配置：

```bash
cp config/funds.example.json config/funds.local.json
npm exec tsx src/cli.ts run --config config/funds.local.json
```

联网检查但不保存结果：

```bash
npm exec tsx src/cli.ts run --config config/funds.local.json --no-save
```

## 配置

每只基金至少配置：

- `code`、`name`、`manager` 和 `adapter`
- `strategy`：`active` 或 `passive`，不根据名称推断
- `currency` 和 `shareClass`
- `officialSources`：官方产品页、当前状态页或公告
- `agency.eastmoney`：是否采集天天基金公开页
- `portfolioMappings`：持仓来源及 `direct` / `look-through` 口径

示例官方数据源：

```json
{
  "url": "https://基金公司官方域名/产品或公告页",
  "kind": "product",
  "followLinks": true,
  "channel": { "kind": "direct", "access": "web" }
}
```

`kind` 支持 `product`、`current-status`、`notice` 和 `notice-index`。只有来源明确指出入口时，才应填写具体 `channel`；公告未区分 Web、APP 或柜台时不得自行推断。

支付宝、银行和券商通常依赖登录态，只能通过 `manualChannels` 添加带 `verifiedAt` 和 `expiresAt` 的短期人工记录，格式见 [`config/manual-channel.example.json`](config/manual-channel.example.json)。过期记录会自动失效。

## 通知

默认配置使用邮件并仅在检测到变化时发送。SMTP 凭据通过环境变量提供：

```bash
export QDII_SMTP_HOST='smtp.example.com'
export QDII_SMTP_PORT='587'
export QDII_SMTP_USER='sender@example.com'
export QDII_SMTP_PASSWORD='app-password'
export QDII_EMAIL_FROM='sender@example.com'
npm start
```

也可在 `notifications` 中使用 `feishu` 或 `generic` webhook，并通过 `QDII_WEBHOOK_URL` 注入地址。`mode` 可设为 `changes`（默认）或 `always`。第一次运行没有比较基线，不会把全部现状当成变化通知。

## 输出

| 路径 | 用途 |
|---|---|
| `data/latest.json` | 最新结果、费率、持仓、变化、告警和健康度 |
| `data/latest.html` | 可直接打开的自包含看板 |
| `data/state.json` | 下一次变化检测使用的可信快照 |
| `data/history/*.json` | 按次保存的审计记录 |
| `site/` | 可部署的静态网站 |

`data/`、`site/`、凭据和本地配置均不会提交。公开站点只从 `site/` 部署，不发布比较状态与历史记录。

年综合费率的口径为“管理费率 + 托管费率 + 销售服务费率”。申购费和赎回费受渠道折扣、金额及持有期影响，不计入该值。

## 自动更新

GitHub Actions 在工作日北京时间 09:10、14:30、20:30 自动执行，也可在 Actions 页面手动触发：

1. 安装依赖并运行测试。
2. 抓取数据并恢复上一份可信状态用于变化比较。
3. 构建 `site/` 并部署到 GitHub Pages。
4. 缓存 `data/`，但不将状态和历史发布到网站。

单个数据源失败时会降级并显示告警；测试失败时不会部署。

## 微信小程序

[`miniapp/`](miniapp/) 是无第三方运行时依赖的原生微信小程序，只读取公开站点的 `latest.json`，不直接抓取基金公司，也不访问登录接口。

使用微信开发者工具导入 `miniapp/` 即可预览。真机发布前需将 `https://tanghuaizhe.github.io` 配置为 request 合法域名，并验证联网加载、下拉刷新、离线缓存、详情页和证据链接。

```bash
npm run check:miniapp
npm test
```

## 维护

基金公司页面改版时：

1. 更新对应的 `src/adapters/*.ts` 官方入口或域名白名单。
2. 只在必要时为 `src/parser.ts` 增加最小解析规则。
3. 使用真实结构的脱敏 fixture 补充测试，同时验证页面变形会返回 `unknown`。
4. 运行 `npm test`、`npm start` 和 `npm run build:site`。

不要抓取登录接口、绕过验证码，或保存 Cookie、账户和其他凭据。

## 许可证

项目采用 MIT 许可证。设计复用了 [`aiten2/qdii-purchase-limits`](https://github.com/aiten2/qdii-purchase-limits) 的渠道快照、变化检测、历史与 webhook 思路，具体声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
