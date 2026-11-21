# QDII Direct Monitor

[公开看板](https://tanghuaizhe.github.io/qdii-direct-monitor/) · [更新状态](https://github.com/TangHuaiZhe/qdii-direct-monitor/actions/workflows/pages.yml)

监控国内纳斯达克 100、标普 500 及相关 QDII 基金的场外申购状态、额度、费率与持仓，同时监控场内 ETF/LOF 的折溢价。直销信息优先，代销信息用于补充；每条结果均保留对应基金份额、销售入口、证据来源和可靠性等级。

> 公开页面和公告不等于登录后的真实下单结果。无法安全解析时返回 `unknown/D`，不会猜测为开放申购。本项目仅提供信息监控，不构成投资建议。

## 核心能力

- 独立采集基金公司官方页面和公告，并以官方域名白名单限制访问范围。
- 严格区分直销与代销入口，不合并不同渠道的额度。
- 采集管理费、托管费、销售服务费和公开持仓。
- 检测申购状态、额度及渠道变化；抓取失败不会覆盖上一条可信比较基线。
- 分别展示场外基金和场内基金；场内基金提供校准折溢价与实时折溢价两种口径。
- 生成静态网站和 JSON 数据，并支持邮件、飞书及通用 webhook 通知。

基金范围、份额类别、数据源和持仓映射以 [`config/funds.example.json`](config/funds.example.json) 为准。

## 数据口径

每条场外 observation 只描述一个基金份额和一个销售入口。`direct` 与 `agency` 以及 `web`、`app`、`counter`、`eastmoney` 等入口互不合并。

可靠性等级：

| 等级 | 含义 |
|---|---|
| A | 当前官方产品或交易页面明确给出状态或额度 |
| B | 官方公告明确给出渠道，或当前代销公开页面 |
| C | 渠道不够明确，或有效期内的人工核验 |
| D | 抓取或解析失败，状态固定为 `unknown` |

场内报价使用独立的 `quotes` 数组，不与场外额度混用：

| 口径 | 定义 |
|---|---|
| 校准折溢价 | 同一估值日收盘价 ÷ 当日单位净值 − 1 |
| 实时折溢价 | 现价 ÷ 最新参考净值 − 1，仅作盘中参考，不代表套利空间 |

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm test
npm run typecheck
npm start
npm run build:site
```

`npm start` 使用默认基金池执行一次抓取并写入 `data/`；`npm run build:site` 根据结果生成 `site/`。

使用本地配置：

```bash
cp config/funds.example.json config/funds.local.json
npm exec tsx src/cli.ts run --config config/funds.local.json
```

联网检查但不保存结果：

```bash
npm exec tsx src/cli.ts run --config config/funds.local.json --no-save
```

## 配置

每只基金需明确配置代码、名称、管理人、adapter、策略、指数或投资主题、币种、份额类别、官方来源和持仓映射。场内基金还需配置交易所、ETF/LOF 类型、官方行情来源及可选的场外关联份额。

官方来源应优先指向当前产品或交易页面，其次是动态发现的最新公告。不能长期使用一份旧公告固定每日额度，也不能根据基金名称推断策略、币种、渠道或额度口径。

支付宝、银行和券商等需登录渠道，只能通过 `manualChannels` 添加带 `verifiedAt` 和 `expiresAt` 的短期人工记录，格式见 [`config/manual-channel.example.json`](config/manual-channel.example.json)。

## 输出与发布


最新结果写入 `data/latest.json`，静态网站生成到 `site/`。`data/`、`site/`、凭据和本地配置不会提交。

GitHub Actions 在工作日北京时间 09:10、14:30、15:05、20:30 自动抓取并部署 GitHub Pages；单个来源失败时显示告警，测试失败时不部署。

## 许可证

项目采用 MIT 许可证。设计复用了 [`aiten2/qdii-purchase-limits`](https://github.com/aiten2/qdii-purchase-limits) 的渠道快照、变化检测、历史与 webhook 思路，具体声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
