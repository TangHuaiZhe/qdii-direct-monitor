# QDII Direct Monitor

[公开看板](https://tanghuaizhe.github.io/qdii-direct-monitor/) · [更新状态](https://github.com/TangHuaiZhe/qdii-direct-monitor/actions/workflows/pages.yml)

监控国内纳斯达克 100、标普 500 及相关 QDII 基金场外份额的申购状态、每日额度、费率和持仓。项目优先采集基金公司直销信息，以天天基金等代销渠道补充，并为每条结果保留明确的基金份额、销售入口、证据来源和可靠性等级。同时监控场内纳指 100 / 标普 500 ETF 与 LOF 的折溢价，使用交易所官方行情与公开净值计算双口径溢价率。

> 公开网页和公告不等于登录后的真实下单结果。无法安全解析时，系统返回 `unknown/D`，不会猜测为开放申购。本项目仅提供信息监控，不构成投资建议。

## 核心能力

- 18 家基金公司的独立 adapter，均通过官方域名白名单限制抓取范围。
- 按“当前官方产品/交易页 → 动态发现的最新官方公告 → `unknown`”回退，支持 HTML 和 PDF；固定公告仅作经过时效检查的最后回退。
- 分开记录直销 Web、APP、柜台及各类代销入口，不合并不同渠道的额度。
- 采集管理费、托管费和销售服务费，并计算年综合费率。
- 对 ETF 联接基金进行底层持仓穿透，对主动基金展示公开持仓。
- 保存渠道快照，检测状态、额度及渠道变化；抓取降级不会覆盖上一条可信比较基线。
- 采集场内 ETF/LOF 的收盘价与参考净值，按“校准溢价（同一估值日）+ 实时溢价”双口径展示，失败关闭且保留来源。
- 生成静态看板、基金详情页和 JSON 数据，并支持邮件、飞书或通用 webhook 通知。
- 提供原生微信小程序，读取与公开看板相同的 `latest.json`。

默认基金池见 [`config/funds.example.json`](config/funds.example.json)，它是基金范围、份额类别、数据源和持仓映射的唯一准确信息源。

### 网页分类

当前配置同时覆盖纳斯达克 100、标普 500、纳斯达克科技及主动管理的场外份额。网页看板的“分类”筛选按配置中的 `index` 展示被动基金，按 `strategy: active` 将主动基金统一归入“主动”；基金详情仍保留各自的具体投资主题。“策略”筛选则独立显示主动或被动。场内列表与场外列表分开筛选。此处描述的是网页界面，小程序只消费公开数据，没有同步实现这组网页筛选控件。

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

场内报价使用独立的 `quotes` 数组，不复用销售入口的 observation：一条 quote 描述一个场内代码的价格、参考净值与折溢价，不包含渠道额度。折溢价分两个口径，页面始终并列展示：

| 口径 | 定义 | 用途 |
|---|---|---|
| `premiumCalibratedPct` | 同一估值日收盘价 ÷ 该日单位净值 − 1 | 主指标，剔除美股时差错配，净值公布后才可计算 |
| `premiumLivePct` | 现价 ÷ 最新公布参考净值（IOPV/参考净值优先）− 1 | 盘中辅助读数，含美股时差，不代表套利空间 |

参考净值优先使用交易所发布的参考净值/IOPV，其次使用公开净值；两源偏差超过阈值、无成交、净值滞后或无法安全解析时降级或返回 `null`，不猜测。交易所行情不可达时（例如海外 CI 访问深交所接口超时），价格降级为第三方公开行情并标为 B 级，页面明确标注“交易所官方行情不可用”；此时用于校准口径的收盘价也继承该等级。若本次报价失败但留有上一条可信报价，页面会标出“沿用上次可信值”和原始抓取时间，该数值不代表当前行情。场内溢价与场外申购额度是两套指标，不合并、不相加、不互相推断。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm test
npm run typecheck
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
- `index`：适用时显式标记跟踪指数或主动基金的投资主题；网页用 `strategy` 统一筛选主动基金
- `currency` 和 `shareClass`
- `officialSources`：官方产品页、当前状态页或公告
- `agency.eastmoney`：是否采集天天基金公开页
- `portfolioMappings`：持仓来源及 `direct` / `look-through` 口径
- `onsite`：场内溢价采集开关与阈值（`highPremiumPct`、`minTurnoverCny`、`navMismatchPct`、`maxNavLagTradingDays`）
- `onsiteFunds`：场内基金清单，逐只配置 `exchange`（`SSE`/`SZSE`）、`vehicle`（`ETF`/`LOF`）、`index`、官方行情 URL 与可选 `linkFundCode`（关联场外份额）；不根据名称推断

示例官方数据源：

```json
{
  "url": "https://基金公司官方域名/产品或公告页",
  "kind": "product",
  "followLinks": true,
  "channel": { "kind": "direct", "access": "web" }
}
```

`kind` 支持 `product`、`current-status`、`notice` 和 `notice-index`。`notice-index` 指向当前公告列表或搜索入口，运行时发现最新适用公告；不能用一份旧公告长期固定每日额度。只有来源明确指出入口时，才应填写具体 `channel`；公告未区分 Web、APP 或柜台时不得自行推断。

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
| `data/latest.json` | 最新结果、费率、持仓、场内报价（`quotes`）、溢价汇总（`premiumSummary`）、变化、告警和健康度 |
| `data/latest.html` | 可直接打开的自包含看板 |
| `data/state.json` | 下一次变化检测使用的可信快照 |
| `data/history/*.json` | 按次保存的审计记录 |
| `site/` | 可部署的静态网站 |

`data/`、`site/`、凭据和本地配置均不会提交。公开站点只从 `site/` 部署，不发布比较状态与历史记录。

年综合费率的口径为“管理费率 + 托管费率 + 销售服务费率”。申购费和赎回费受渠道折扣、金额及持有期影响，不计入该值。

## 自动更新

GitHub Actions 在工作日北京时间 09:10、14:30、15:05、20:30 自动执行，也可在 Actions 页面手动触发。15:05 用于抓取收盘快照，供收盘溢价与校准口径使用：

1. 安装依赖并运行测试。
2. 抓取数据并恢复上一份可信状态用于变化比较。
3. 构建 `site/` 并部署到 GitHub Pages。
4. 缓存 `data/`，但不将状态和历史发布到网站。

单个数据源失败时会降级并显示告警；测试失败时不会部署。

网页顶部的“抓取提示”列出当次采集告警，“公告发现异常”列出公告索引不可用或发现更新公告但未安全解析的基金；“直销数据未抓取到的基金”列出缺少可信直销观察的份额。排查时先看对应基金详情页的来源、证据等级和抓取时间；页面抓取成功但解析失败，与来源本身抓取失败是不同问题。`data/latest.json` 中的 `warnings`、`noticeHealth` 和 `health` 保留机器可读的诊断信息。

### 访问统计

站点使用 [Umami](https://umami.is/) 统计公开页面访问量，不跟踪登录态或账户信息。构建时通过仓库变量注入，未配置则不输出任何统计脚本：

- `UMAMI_WEBSITE_ID`：Umami 站点 ID，配置后所有看板和详情页自动注入 `https://cloud.umami.is/script.js`。
- `UMAMI_SCRIPT_URL`：可选，自托管 Umami 时填写脚本地址（必须是 HTTPS）。

本地预览统计效果时可直接 `export UMAMI_WEBSITE_ID=...` 后再执行 `npm start`。

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
4. 运行 `npm test`、`npm run typecheck`、`npm start` 和 `npm run build:site`。

不要抓取登录接口、绕过验证码，或保存 Cookie、账户和其他凭据。

## 许可证

项目采用 MIT 许可证。设计复用了 [`aiten2/qdii-purchase-limits`](https://github.com/aiten2/qdii-purchase-limits) 的渠道快照、变化检测、历史与 webhook 思路，具体声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
