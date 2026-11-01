"use strict";

const { loadPayload } = require("../../utils/api");
const { onsiteSummary, filterOnsiteQuotes, onsiteIndexOptions, buildOnsiteQuotes, lowestPremiumQuotes, formatObservedAt } = require("../../utils/onsite");

Page({
  data: {
    loading: true,
    error: "",
    originMessage: "",
    observedAt: "",
    summary: null,
    hasData: false,
    quotes: [],
    visibleQuotes: [],
    topQuotes: [],
    showAll: false,
    indexOptions: ["全部"],
    indexFilter: "全部",
    query: ""
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
      const quotes = buildOnsiteQuotes(payload);
      const summary = onsiteSummary(payload);
      const topQuotes = lowestPremiumQuotes(quotes, 3);
      this.setData({
        loading: false,
        quotes,
        topQuotes,
        summary,
        hasData: quotes.some((quote) => quote.trusted),
        observedAt: formatObservedAt(payload.observedAt),
        originMessage: result.origin === "stale-cache" ? "网络不可用，当前显示上次缓存" : "数据来自公开监控服务",
        indexOptions: onsiteIndexOptions(quotes),
        // If no row is eligible for the collapsed top-3 (all D or carried forward),
        // show the full list instead of an empty screen.
        showAll: topQuotes.length ? this.data.showAll : true
      });
      this.applyFilters();
    } catch (error) {
      this.setData({ loading: false, error: error.message || "暂时无法读取数据" });
    }
  },

  applyFilters() {
    const visibleQuotes = filterOnsiteQuotes(this.data.quotes, {
      query: this.data.query,
      index: this.data.indexFilter
    });
    this.setData({ visibleQuotes });
  },

  toggleAll() {
    this.setData({ showAll: !this.data.showAll });
  },

  onSearch(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilters());
  },

  onIndex(event) {
    this.setData({ indexFilter: event.currentTarget.dataset.value }, () => this.applyFilters());
  },

  openDetail(event) {
    wx.navigateTo({ url: "/pages/onsite-detail/onsite-detail?code=" + encodeURIComponent(event.currentTarget.dataset.code) });
  },

  retry() {
    this.refresh(true);
  },

  onShareAppMessage() {
    return { title: "场内 QDII 折溢价监控", path: "/pages/onsite/onsite" };
  }
});
