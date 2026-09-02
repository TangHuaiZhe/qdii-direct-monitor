# QDII Direct Monitor

[公开监控网站](https://tanghuaizhe.github.io/qdii-direct-monitor/) · [自动更新状态](https://github.com/TangHuaiZhe/qdii-direct-monitor/actions/workflows/pages.yml)

一个“直销优先、代销补充”的国内纳斯达克 100 QDII 申购限额与费率监控器。项目默认覆盖嘉实、易方达、汇添富、博时、招商、广发、华安、大成、南方、国泰、宝盈、华泰柏瑞、建信、摩根、万家和天弘，共 29 个基金份额，并把每一条额度和费率绑定到明确的证据与可靠性等级。

> 重要：基金公司 APP 和登录后的网上交易通常没有稳定公开接口。本项目不会把网页抓取等同于真实下单验证；解析失败时输出 `unknown`，不会猜测为开放申购。

## 已实现能力

- 十六个独立的基金公司 adapter，分别维护域名白名单和默认公开入口。
- 回退链：官方产品页 → 官方公告列表/HTML/PDF 公告 → 明确标记为未知。
- 代销侧默认读取天天基金公开销售页；支付宝、银行、券商支持短期人工核验记录。
- 自动读取管理费率、托管费率和销售服务费率，计算可横向比较的年综合费率。
- 网站支持基金名称/代码/公司搜索（含全拼与拼音首字母）、份额类别筛选、仅看可购买和额度/费率排序。
- 可配置基金池、并发抓取、运行间隔、历史保留数量。
- 按渠道生成快照，检测状态变化、额度上调/下调、渠道新增/移除。
- 飞书或通用 JSON webhook；默认只在第二次及以后发现变化时通知。
- 原子写入 `latest.json`、可直接打开的 `latest.html`、`state.json` 和按次历史记录。
- 临时抓取失败的 D 级记录会保留在当次 `rows` 中，但不会覆盖上一条可信比较基线，避免网络抖动制造假变化。

## 目前支持的基金

默认配置目前覆盖 16 家基金公司、29 个纳斯达克 100 QDII 基金份额：

| 基金公司 | 基金份额（代码与名称） |
|---|---|
| 嘉实基金 | `016532` 嘉实纳斯达克100ETF发起联接（QDII）A人民币 |
| 易方达基金 | `161130` 易方达纳斯达克100ETF联接（QDII-LOF）A人民币 |
| 汇添富基金 | `018966` 汇添富纳斯达克100ETF发起式联接（QDII）人民币A<br>`018967` 汇添富纳斯达克100ETF发起式联接（QDII）人民币C<br>`021773` 汇添富纳斯达克100ETF发起式联接（QDII）人民币E |
| 博时基金 | `016055` 博时纳斯达克100ETF发起式联接（QDII）A人民币 |
| 招商基金 | `019547` 招商纳斯达克100ETF发起式联接（QDII）A<br>`019548` 招商纳斯达克100ETF发起式联接（QDII）C |
| 广发基金 | `270042` 广发纳斯达克100ETF联接（QDII）人民币A<br>`006479` 广发纳斯达克100ETF联接（QDII）人民币C |
| 华安基金 | `040046` 华安纳斯达克100ETF联接（QDII）A<br>`014978` 华安纳斯达克100ETF联接（QDII）C |
| 大成基金 | `000834` 大成纳斯达克100ETF联接（QDII）A<br>`008971` 大成纳斯达克100ETF联接（QDII）C |
| 南方基金 | `016452` 南方纳斯达克100指数发起（QDII）A<br>`016453` 南方纳斯达克100指数发起（QDII）C |
| 国泰基金 | `160213` 国泰纳斯达克100指数（QDII） |
| 宝盈基金 | `019736` 宝盈纳斯达克100指数发起（QDII）A人民币<br>`019737` 宝盈纳斯达克100指数发起（QDII）C人民币 |
| 华泰柏瑞基金 | `019524` 华泰柏瑞纳斯达克100ETF发起式联接（QDII）A<br>`019525` 华泰柏瑞纳斯达克100ETF发起式联接（QDII）C |
| 建信基金 | `539001` 建信纳斯达克100指数（QDII）A人民币<br>`012752` 建信纳斯达克100指数（QDII）C人民币 |
| 摩根基金 | `019172` 摩根纳斯达克100指数（QDII）人民币A<br>`019173` 摩根纳斯达克100指数（QDII）人民币C |
| 万家基金 | `019441` 万家纳斯达克100指数发起式（QDII）A<br>`019442` 万家纳斯达克100指数发起式（QDII）C |
| 天弘基金 | `018043` 天弘纳斯达克100指数发起（QDII）A<br>`018044` 天弘纳斯达克100指数发起（QDII）C |

清单以 [`config/funds.example.json`](config/funds.example.json) 为准；自定义本地配置可以增减监控范围。这里列的是基金份额，不代表当前一定可申购，实际状态和额度以监控结果及对应证据为准。

## 渠道模型

每条 observation 只描述一个基金份额、一个销售入口：

```json
{
  "fundCode": "040046",
  "currency": "CNY",
  "shareClass": "A",
  "channel": {
    "kind": "direct",
    "access": "web"
  },
  "status": "limited",
  "limitAmount": 100,
  "accountBasis": "single-fund-account-daily-cumulative",
  "reliability": {
    "grade": "A",
    "reason": "current official product page explicitly identifies the channel"
  },
  "source": {
    "url": "https://www.huaan.com.cn/funds/040046/index.shtml",
    "kind": "product",
    "adapter": "huaan"
  }
}
```

允许的渠道如下：

| 销售关系 `kind` | 入口 `access` | 含义 |
|---|---|---|
| `direct` | `web` | 基金公司网上直销 |
| `direct` | `app` | 基金公司 APP 直销 |
| `direct` | `counter` | 基金公司直销柜台/直销中心 |
| `direct` | `all` | 官方材料只写“直销机构”，无法再细分 |
| `agency` | `eastmoney` | 天天基金/东方财富公开销售页 |
| `agency` | `alipay` | 支付宝渠道（通常需人工短期核验） |
| `agency` | `bank` | 银行代销；用 `name` 区分银行 |
| `agency` | `broker` | 券商代销；用 `name` 区分券商 |
| `agency` | `all` | 公告只写“其他销售渠道/代销机构” |

`direct/all` 与 `direct/web` 不会合并；未知的入口不会冒充已确认入口。

## 可靠性等级

| 等级 | 含义 | 可否直接视为可买 |
|---|---|---|
| A | 当前官方产品/交易展示页明确给出渠道和状态/额度 | 较强证据，仍非真实下单 |
| B | 官方公告明确给出渠道，或当前代销公开销售页 | 可用于监控，建议大额操作前复核 |
| C | 官方文字渠道范围不明确，或仍在有效期内的人工核验 | 仅作提示 |
| D | 入口失败、页面变形、金额或渠道无法安全解析 | 不可；状态固定为 `unknown` |

公告描述的是规则，APP 页面展示的是入口状态，两者也可能暂时不同。系统保留各自证据，不把低等级证据覆盖高等级证据。

## 安装与运行

要求 Node.js 22 或更高版本：

```bash
npm install
npm test
npm start
```

生成适合静态托管的网站目录：

```bash
npm run build:site
```

它只把 `latest.html` 和 `latest.json` 发布到 `site/`，不会公开比较状态、历史记录或通知密钥。

默认配置在 `config/funds.example.json`，结果写入项目的 `data/`。建议复制为本地配置后运行：

```bash
cp config/funds.example.json config/funds.local.json
node src/cli.js run --config config/funds.local.json
```

持续运行（默认每 30 分钟，最低 5 分钟）：

```bash
npm run watch
```

生产环境更建议使用系统 cron、launchd 或 CI 每次执行一次 `run`，避免一个常驻进程失效后无人发现。示例 cron（工作日 09:10、14:30、20:30）：

```cron
10 9 * * 1-5 cd /absolute/path/qdii-direct-monitor && /absolute/path/node src/cli.js run --config config/funds.local.json
30 14 * * 1-5 cd /absolute/path/qdii-direct-monitor && /absolute/path/node src/cli.js run --config config/funds.local.json
30 20 * * 1-5 cd /absolute/path/qdii-direct-monitor && /absolute/path/node src/cli.js run --config config/funds.local.json
```

## 通知

配置默认从环境变量读取 webhook，避免把密钥写进仓库：

```bash
export QDII_WEBHOOK_URL='https://...'
npm start
```

飞书使用 `"type": "feishu"`；其他接收 JSON 的端点使用 `"type": "generic"`。`mode` 可设为 `changes`（默认）或 `always`。第一次运行没有比较基线，因此不会把全部现状当作变化发送。

### 邮件通知

示例配置已使用邮件通知，收件人为 `tanghuaizhe@me.com`。只有检测到额度或状态变化时才发送邮件。GitHub Actions 需要在仓库 Settings → Secrets and variables → Actions 中配置以下 Secrets：

| Secret | 用途 | iCloud 邮箱示例 |
|---|---|---|
| `QDII_SMTP_HOST` | SMTP 服务器 | `smtp.mail.me.com` |
| `QDII_SMTP_PORT` | SMTP 端口 | `587` |
| `QDII_SMTP_USER` | 发件邮箱 | 你的 iCloud 邮箱 |
| `QDII_SMTP_PASSWORD` | SMTP 密码 | iCloud 专用 App 密码 |
| `QDII_EMAIL_FROM` | 发件人地址 | 与 SMTP 用户一致 |

iCloud 邮箱必须使用“App 专用密码”，不要使用 Apple ID 主密码。未配置完整时，网站仍会正常更新，但运行结果会标记 `missing-email-config`，不会发送邮件。

## 公共网站与自动更新

项目使用 GitHub Actions 抓取并部署 GitHub Pages：

- 工作日北京时间 09:10、14:30、20:30 自动更新。
- 也可以在仓库的 Actions 页面手动运行 `Update and deploy dashboard`。
- 网站发布 `index.html`、`latest.html`、`latest.json`、`robots.txt`、`sitemap.xml` 和 `funds/<code>/index.html`；运行状态与历史通过 GitHub Actions 缓存保留，不进入公开仓库或网页。
- 如果配置仓库密钥 `QDII_WEBHOOK_URL`，线上任务也会按现有规则发送通知；没有配置时照常更新网站。

定时任务可能因 GitHub 平台负载延迟。基金公司或代销页面拒绝云端访问时，页面会显示抓取提示并按可靠性规则降级，不会把未知状态猜成开放申购。

## 微信小程序

`miniapp/` 是一个无第三方依赖的原生微信小程序，直接读取 GitHub Pages 发布的 `latest.json`，与公开网站共用同一份数据。它支持中文、代码、全拼及拼音首字母搜索、A/C 份额筛选、仅看可购买、额度/费率排序、渠道证据详情、下拉刷新和离线缓存。小程序不执行基金公司抓取，也不接触任何登录态接口。

本地预览：

1. 打开微信开发者工具，选择“导入项目”，目录选为仓库下的 `miniapp/`。
2. 项目已经配置现有小程序 AppID；请使用该小程序的开发者微信账号登录开发者工具。AppSecret 不属于客户端配置，不得写入仓库或小程序代码。
3. 在微信公众平台的“开发管理 → 开发设置 → 服务器域名”中，把 `https://tanghuaizhe.github.io` 加入 **request 合法域名**。开发者工具里的 `urlCheck: false` 只方便本地预览，不能替代真机合法域名配置。
4. 用真机分别验证首次联网加载、下拉刷新、断网缓存、基金详情和证据链接复制。模拟器成功不能替代真机网络验证。

代码提交前可运行：

```bash
npm run check:miniapp
npm test
```

正式提交审核前，还应在小程序后台补齐名称、图标、隐私保护指引和服务类目；页面已经明确标注“公开规则不等于真实下单验证”及“不构成投资建议”。

### 自动化工作原理

每次定时任务或手动运行都会在 GitHub 提供的临时运行环境中执行，不依赖你的 Mac 开机：

```text
触发 GitHub Actions
  → 安装依赖并运行 npm test
  → npm start 抓取各适配器的数据
  → 生成 data/latest.json、data/latest.html 和历史记录
  → npm run build:site 生成公开网站文件
  → 上传 site/ 并部署到 GitHub Pages
```

其中：

- `src/cli.js` 负责一次完整运行，包括抓取、变化检测、通知和输出路径。
- `src/collector.js` 负责调用基金公司直销适配器及天天基金等代销数据源。
- `src/site.js` 把最新结果转换成首页、基金详情页、站点地图和 `robots.txt`。
- GitHub Actions 缓存 `data/` 中的可信快照和历史，使下一次运行能够比较额度变化。
- 测试失败时不会继续部署；单个数据源失败时会保留上一份可信值，并在页面告警中说明。
- 运行完成后，GitHub Pages 会发布新的站点版本，通常比抓取结束晚几分钟。

## 配置基金与数据源

每只基金至少需要 `code`、`name`、`manager`、`adapter`。适配器名称为：

`jiashi`、`efunds`、`huitianfu`、`bosera`、`cmf`、`gf`、`huaan`、`dacheng`、`southern`、`guotai`、`baoying`、`huataipb`、`ccb`、`jpmorgan`、`wanjia`、`tianhong`。

南方默认监控场外基金 `016452`（南方纳斯达克100指数发起 QDII A）。场内 ETF `159659` 主要通过证券交易所买卖，其一级市场申购赎回单位与场外基金每日人民币购买限额不是同一种指标，因此不混入本看板。

宝盈官网产品入口在部分网络环境下会中断连接；建信官网当前公开页能确认直销限制，但没有稳定可解析的具体金额。这两家的直销结果会保守显示为 `unknown/D`，同时保留天天基金代销结果，不用代销额度冒充直销额度。

适配器有默认官方入口，也可以为基金显式设置：

```json
{
  "officialSources": [
    {
      "url": "https://基金公司官方域名/产品或公告页",
      "kind": "product",
      "followLinks": true,
      "channel": { "kind": "direct", "access": "web" }
    }
  ]
}
```

- `kind`: `product`、`notice` 或 `notice-index`；产品页的可靠性通常更高。
- `followLinks`: 从公告列表继续读取最多 3 个包含基金代码/纳指关键词和申购关键词的链接。
- `channel`: 页面自身不写清入口时可由维护者明确标注；不要在没有依据时标注为 `web` 或 `app`。
- HTML 和 PDF 均可读取，PDF 最多读取前 12 页，避免无边界下载/解析。
- 每个 adapter 只允许访问该基金公司的 HTTPS 域名，跳转也会在读取内容前受最终请求机制限制；不要添加第三方短链。

### 支付宝、银行、券商

这些入口通常依赖登录态，没有统一公开接口。可以把 `config/manual-channel.example.json` 中的对象加入基金的 `manualChannels`。人工记录必须有 `verifiedAt` 和 `expiresAt`，过期后自动忽略，防止旧截图永久污染结果。

## 输出与变化规则

### 搜索引擎收录

- 首页和每只基金详情页都包含 canonical 地址与 JSON-LD 结构化数据。
- robots.txt 允许抓取并指向 sitemap.xml；站点地图包含首页及当前基金池中的详情页。
- 部署完成后，可将公开站点和 https://tanghuaizhe.github.io/qdii-direct-monitor/sitemap.xml 提交到 Google Search Console、Bing Webmaster Tools 和百度搜索资源平台。
- 搜索引擎是否收录、何时展示由各平台自行决定；新增基金或页面后，Actions 每次发布会自动刷新站点地图。

### 综合费率口径

页面中的“年综合费率”是 `管理费率 + 托管费率 + 销售服务费率`。这三项通常从基金资产中按日计提，基金净值已经扣除。申购费和赎回费会随销售渠道折扣、申购金额和持有期变化，因此不与年度运作费用相加；页面同时展示三项拆分值和费率证据链接。

页面按数值显示费率颜色和文字标签：小于等于 `0.80%` 为低费率，超过 `0.80%` 且小于等于 `1.00%` 为正常，超过 `1.00%` 为高费率。

### 输出文件

- `data/latest.json`：最新完整结果、告警、变化和健康度。
- `data/latest.html`：自包含可视化页面，双击即可打开，不需要启动 Web 服务。
- `data/state.json`：下一次比较使用的渠道快照。
- `data/history/*.json`：每次运行的审计记录。

快照键为：

```text
基金代码 | 币种 | 份额类别 | 渠道关系/入口/名称 | 账户额度口径
```

这延续了上游 `qdii-purchase-limits` 的按渠道快照与变化通知思路，但不会把“基金级公告额度”和“某代销入口额度”压成同一个数值。复用来源见 `THIRD_PARTY_NOTICES.md`。

## 维护 adapter

基金公司改版时通常只需：

1. 更新对应 `src/adapters/*.js` 的默认入口或域名白名单。
2. 如果页面措辞变化，在 `src/parser.js` 增加一个最小、带 fixture 的解析规则。
3. 用真实页面保存的脱敏 fixture 写测试，确认页面变形时仍返回 `unknown`。
4. 先运行 `npm test`，再用 `--no-save` 做一次联网烟雾检查。

不要抓登录接口、绕过验证码或在配置中保存 Cookie。APP 的真实可购买状态无法公开验证时，应维持 `unknown/D`，让用户在交易前自行确认。

## 已知边界

- 公告列表的链接顺序和网页结构可能改变；监控会降级而不是猜值。
- “单日单账户”“单笔”“单份额”“全基金共享额度”并非同一口径；当前默认口径是单基金账户单日累计，其他口径应新增独立 `accountBasis`。
- 暂停申购与暂停大额申购不同；只有能解析出正额度时才会输出 `limited`。
- 天天基金页面只是一个代销公开页面，不能代表支付宝、银行或券商。
- 这是一项信息监控工具，不构成投资建议，也不保证申购申请最终成功。

## 上游与许可证

设计复用了 MIT 项目 [`aiten2/qdii-purchase-limits`](https://github.com/aiten2/qdii-purchase-limits) 的渠道快照、变化检测、历史与 webhook 思路。具体版本及声明见 `THIRD_PARTY_NOTICES.md`。
