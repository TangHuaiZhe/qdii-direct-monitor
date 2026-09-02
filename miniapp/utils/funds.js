"use strict";

const { buildSearchText, normalizeSearchQuery } = require("./pinyin");

const STATUS_LABELS = {
  open: "开放申购",
  limited: "限额申购",
  suspended: "暂停申购",
  unavailable: "不可申购",
  unknown: "状态未知"
};

const ACCESS_LABELS = {
  web: "网上直销",
  app: "基金公司 APP",
  counter: "直销柜台",
  eastmoney: "天天基金",
  alipay: "支付宝",
  bank: "银行代销",
  broker: "券商代销"
};

const GRADE_SCORE = { A: 4, B: 3, C: 2, D: 1 };
const STATE_SCORE = { open: 5, limited: 4, suspended: 3, unavailable: 2, unknown: 1 };
const CHANNEL_PRIORITY = { web: 6, app: 5, counter: 4, all: 3, eastmoney: 2, alipay: 2, bank: 2, broker: 2 };

function formatNumber(value) {
  const parts = String(Number(value)).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function amountLabel(row) {
  if (!row) return "暂无数据";
  if (row.status === "open") return "不限额";
  if (row.status !== "limited" || !Number.isFinite(Number(row.limitAmount))) return "—";
  return formatNumber(row.limitAmount) + (row.currency === "USD" ? " 美元" : " 元");
}

function channelLabel(channel = {}) {
  const fallback = channel.kind === "direct" ? "直销机构" : "代销机构";
  const access = channel.access === "all" ? fallback : (ACCESS_LABELS[channel.access] || channel.access || fallback);
  return channel.name && channel.name !== access ? access + " · " + channel.name : access;
}

function isPurchasable(row) {
  return Boolean(row && ["open", "limited"].includes(row.status) && row.reliability?.grade !== "D");
}

function amountScore(row) {
  return row?.status === "open" ? Number.MAX_SAFE_INTEGER : Number(row?.limitAmount || 0);
}

function pickBestChannel(rows, kind) {
  return rows.filter((row) => row.channel?.kind === kind).sort((left, right) =>
    (GRADE_SCORE[right.reliability?.grade] || 0) - (GRADE_SCORE[left.reliability?.grade] || 0)
    || (STATE_SCORE[right.status] || 0) - (STATE_SCORE[left.status] || 0)
    || amountScore(right) - amountScore(left)
  )[0] || null;
}

function pickBestPurchasable(rows) {
  return rows.filter(isPurchasable).sort((left, right) =>
    amountScore(right) - amountScore(left)
    || (CHANNEL_PRIORITY[right.channel?.access] || 0) - (CHANNEL_PRIORITY[left.channel?.access] || 0)
  )[0] || null;
}

function aggregateStatus(rows) {
  const statuses = rows.filter((row) => row.reliability?.grade !== "D").map((row) => row.status);
  return ["open", "limited", "suspended", "unavailable"].find((status) => statuses.includes(status)) || "unknown";
}

function sourceHost(url) {
  const match = String(url || "").match(/^https:\/\/([^/]+)/i);
  return match ? match[1] : "来源链接";
}

function reliabilityReasonLabel(reason) {
  const value = String(reason || "");
  if (value.includes("current official product page")) return "当前官方产品页明确标注渠道";
  if (value.includes("official notice/page explicitly")) return "官方公告明确标注渠道，未验证实际下单";
  if (value.includes("current public agency sales page")) return "当前代销公开页面，未验证登录后下单";
  if (value.includes("current public fee page")) return "当前公开费率页，重要决策前请核对最新招募说明书";
  if (value.includes("channel scope is not explicit")) return "官方文本含状态信息，但渠道范围不够明确";
  if (value.includes("page fetched but")) return "页面已抓取，但无法安全解析当前渠道额度";
  if (value.includes("source unavailable")) return "公开数据源当前不可用";
  if (value.includes("manually verified")) return "人工核验记录，超过有效期后自动失效";
  return value || "未提供可靠性说明";
}

function decorateObservation(row) {
  const grade = row.reliability?.grade || "D";
  return {
    ...row,
    relationLabel: row.channel?.kind === "direct" ? "直销" : "代销",
    channelLabel: channelLabel(row.channel),
    statusLabel: STATUS_LABELS[row.status] || row.status || "状态未知",
    amountLabel: amountLabel(row),
    grade,
    gradeClass: "grade-" + grade,
    statusClass: "status-" + (row.status || "unknown"),
    sourceHost: sourceHost(row.source?.url),
    reliabilityReason: reliabilityReasonLabel(row.reliability?.reason),
    notesText: Array.isArray(row.notes) ? row.notes.join("；") : ""
  };
}

function feeView(fee) {
  if (!fee || !Number.isFinite(Number(fee.annualRate))) return null;
  const annualRate = Number(fee.annualRate);
  const band = annualRate <= 0.8 ? "low" : annualRate <= 1 ? "normal" : "high";
  return {
    ...fee,
    annualLabel: annualRate.toFixed(2) + "%",
    managementLabel: Number(fee.managementRate || 0).toFixed(2) + "%",
    custodyLabel: Number(fee.custodyRate || 0).toFixed(2) + "%",
    salesServiceLabel: Number(fee.salesServiceRate || 0).toFixed(2) + "%",
    band,
    bandLabel: { low: "低费率", normal: "正常", high: "高费率" }[band],
    grade: fee.reliability?.grade || "D",
    sourceHost: sourceHost(fee.source?.url)
  };
}

function buildFunds(payload) {
  const grouped = new Map();
  for (const row of payload.rows || []) {
    if (!grouped.has(row.fundCode)) grouped.set(row.fundCode, []);
    grouped.get(row.fundCode).push(row);
  }
  const fees = new Map((payload.fees || []).map((fee) => [fee.fundCode, fee]));
  return [...grouped.entries()].map(([code, rows]) => {
    const first = rows[0];
    const direct = pickBestChannel(rows, "direct");
    const agency = pickBestChannel(rows, "agency");
    const best = pickBestPurchasable(rows);
    const status = aggregateStatus(rows);
    const fee = feeView(fees.get(code));
    return {
      code,
      name: first.fundName,
      manager: first.manager,
      shareClass: first.shareClass || "其他",
      currency: first.currency || "CNY",
      status,
      statusLabel: STATUS_LABELS[status],
      statusClass: "status-" + status,
      purchasable: Boolean(best),
      amountScore: amountScore(best),
      bestAmountLabel: amountLabel(best),
      bestChannelLabel: best ? channelLabel(best.channel) : "暂无可信可用渠道",
      directAmountLabel: amountLabel(direct),
      directGrade: direct?.reliability?.grade || "—",
      agencyAmountLabel: amountLabel(agency),
      agencyGrade: agency?.reliability?.grade || "—",
      fee,
      feeScore: fee ? Number(fee.annualRate) : Number.MAX_SAFE_INTEGER,
      searchText: buildSearchText(first.fundName, first.manager, code),
      observations: rows.map(decorateObservation),
      rawRows: rows
    };
  });
}

function filterAndSortFunds(funds, filters = {}) {
  const query = normalizeSearchQuery(filters.query);
  const shareClass = filters.shareClass || "全部";
  const visible = funds.filter((fund) =>
    (!query || fund.searchText.includes(query))
    && (shareClass === "全部" || fund.shareClass === shareClass)
    && (!filters.purchasableOnly || fund.purchasable)
  );
  const sort = filters.sort || "amount";
  return visible.sort((left, right) => {
    if (sort === "fee") return left.feeScore - right.feeScore || left.name.localeCompare(right.name, "zh-CN");
    if (sort === "name") return left.name.localeCompare(right.name, "zh-CN");
    return right.amountScore - left.amountScore || left.feeScore - right.feeScore;
  });
}

function formatObservedAt(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
    + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

module.exports = {
  aggregateStatus,
  amountLabel,
  buildFunds,
  channelLabel,
  filterAndSortFunds,
  formatObservedAt,
  isPurchasable,
  pickBestChannel,
  pickBestPurchasable,
  reliabilityReasonLabel
};
