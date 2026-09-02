"use strict";

const CACHE_KEY = "qdii-monitor-latest-v1";

function requestJson(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      timeout: 15000,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300 || !response.data) {
          reject(new Error("数据服务返回异常（" + response.statusCode + "）"));
          return;
        }
        const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
        if (!Array.isArray(payload.rows) || !payload.observedAt) {
          reject(new Error("数据格式不完整"));
          return;
        }
        resolve(payload);
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      }
    });
  });
}

async function loadPayload(url, options = {}) {
  const force = Boolean(options.force);
  const cached = wx.getStorageSync(CACHE_KEY);
  if (!force && cached && cached.payload) {
    return { payload: cached.payload, origin: "cache", cachedAt: cached.cachedAt };
  }
  try {
    const payload = await requestJson(url);
    const cachedAt = new Date().toISOString();
    wx.setStorageSync(CACHE_KEY, { payload, cachedAt });
    return { payload, origin: "network", cachedAt };
  } catch (error) {
    if (cached && cached.payload) {
      return { payload: cached.payload, origin: "stale-cache", cachedAt: cached.cachedAt, error };
    }
    throw error;
  }
}

module.exports = { CACHE_KEY, loadPayload, requestJson };
