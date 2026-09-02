"use strict";

const { loadPayload } = require("../../utils/api");
const { buildFunds, filterAndSortFunds, formatObservedAt } = require("../../utils/funds");

const SORT_LABELS = ["额度从高到低", "综合费率从低到高", "基金名称"];
const SORT_VALUES = ["amount", "fee", "name"];

Page({
  data: {
    loading: true,
    error: "",
    originMessage: "",
    observedAt: "",
    healthWarning: "",
    warningCount: 0,
    warnings: [],
    funds: [],
    visibleFunds: [],
    totalCount: 0,
    purchasableCount: 0,
    query: "",
    shareClass: "全部",
    purchasableOnly: false,
    sortLabels: SORT_LABELS,
    sortIndex: 0
  },

  onLoad() {
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    this.refresh(false);
  },

  onPullDownRefresh() {
    this.refresh(true).finally(() => wx.stopPullDownRefresh());
  },

  async refresh(force) {
    this.setData({ loading: true, error: "" });
    try {
      const result = await loadPayload(getApp().globalData.dataUrl, { force });
      const payload = result.payload;
      getApp().globalData.payload = payload;
      const funds = buildFunds(payload);
      const stale = result.origin === "stale-cache";
      this.setData({
        loading: false,
        funds,
        observedAt: formatObservedAt(payload.observedAt),
        originMessage: stale ? "网络不可用，当前显示上次缓存" : "数据来自公开监控服务",
        healthWarning: payload.health?.status === "ok" ? "" : "本次采集存在异常，请结合可靠性等级判断",
        warningCount: (payload.warnings || []).length,
        warnings: (payload.warnings || []).slice(0, 3),
        totalCount: funds.length,
        purchasableCount: funds.filter((fund) => fund.purchasable).length
      });
      this.applyFilters();
    } catch (error) {
      this.setData({ loading: false, error: error.message || "暂时无法读取数据" });
    }
  },

  applyFilters() {
    const sort = SORT_VALUES[this.data.sortIndex] || "amount";
    const visibleFunds = filterAndSortFunds(this.data.funds, {
      query: this.data.query,
      shareClass: this.data.shareClass,
      purchasableOnly: this.data.purchasableOnly,
      sort
    });
    this.setData({ visibleFunds });
  },

  onSearch(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilters());
  },

  onShareClass(event) {
    this.setData({ shareClass: event.currentTarget.dataset.value }, () => this.applyFilters());
  },

  onPurchasableChange(event) {
    this.setData({ purchasableOnly: event.detail.value }, () => this.applyFilters());
  },

  onSortChange(event) {
    this.setData({ sortIndex: Number(event.detail.value) }, () => this.applyFilters());
  },

  openFund(event) {
    wx.navigateTo({ url: "/pages/detail/detail?code=" + encodeURIComponent(event.currentTarget.dataset.code) });
  },

  openAbout() {
    wx.navigateTo({ url: "/pages/about/about" });
  },

  retry() {
    this.refresh(true);
  },

  onShareAppMessage() {
    return { title: "纳指 QDII 申购额度监控", path: "/pages/index/index" };
  }
});
