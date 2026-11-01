"use strict";

const { loadPayload } = require("../../utils/api");
const { findOnsiteQuote } = require("../../utils/onsite");

Page({
  data: { loading: true, error: "", quote: null, observedAt: "" },

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
      const quote = findOnsiteQuote(payload, this.code);
      if (!quote) throw new Error("未找到这个场内基金");
      wx.setNavigationBarTitle({ title: quote.code + " 场内详情" });
      this.setData({ loading: false, quote });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "详情加载失败" });
    }
  },

  copySource(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: "来源链接已复制", icon: "success" }) });
  },

  openOtc() {
    const code = this.data.quote && this.data.quote.linksOtcCode;
    if (!code) return;
    wx.navigateTo({ url: "/pages/detail/detail?code=" + encodeURIComponent(code) });
  },

  onShareAppMessage() {
    return {
      title: this.data.quote ? this.data.quote.name + " 场内折溢价" : "场内 QDII 折溢价",
      path: "/pages/onsite-detail/onsite-detail?code=" + encodeURIComponent(this.code || "")
    };
  }
});
