"use strict";

const { loadPayload } = require("../../utils/api");
const { buildFunds, formatObservedAt } = require("../../utils/funds");

Page({
  data: { loading: true, error: "", fund: null, observedAt: "" },

  onLoad(options) {
    this.code = options.code;
    this.load();
  },

  async load() {
    try {
      let payload = getApp().globalData.payload;
      if (!payload) {
        const result = await loadPayload(getApp().globalData.dataUrl);
        payload = result.payload;
        getApp().globalData.payload = payload;
      }
      const fund = buildFunds(payload).find((item) => item.code === this.code);
      if (!fund) throw new Error("未找到这个基金份额");
      wx.setNavigationBarTitle({ title: fund.code + " 详情" });
      this.setData({ loading: false, fund, observedAt: formatObservedAt(payload.observedAt) });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "详情加载失败" });
    }
  },

  copySource(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: "来源链接已复制", icon: "success" }) });
  },

  onShareAppMessage() {
    return {
      title: this.data.fund ? this.data.fund.name + "申购额度" : "纳指 QDII 申购额度",
      path: "/pages/detail/detail?code=" + encodeURIComponent(this.code || "")
    };
  }
});
