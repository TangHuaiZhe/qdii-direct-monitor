"use strict";

const PINYIN = {
  嘉: "jia", 实: "shi", 纳: "na", 斯: "si", 达: "da", 克: "ke", 发: "fa", 起: "qi",
  联: "lian", 接: "jie", 人: "ren", 民: "min", 币: "bi", 基: "ji", 金: "jin",
  易: "yi", 方: "fang", 汇: "hui", 添: "tian", 富: "fu", 式: "shi", 博: "bo",
  时: "shi", 招: "zhao", 商: "shang", 广: "guang", 华: "hua", 安: "an", 大: "da",
  成: "cheng", 南: "nan", 指: "zhi", 数: "shu", 国: "guo", 泰: "tai", 宝: "bao",
  盈: "ying", 柏: "bai", 瑞: "rui", 建: "jian", 信: "xin", 摩: "mo", 根: "gen",
  万: "wan", 家: "jia", 天: "tian", 弘: "hong", 美: "mei", 元: "yuan"
};

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function pinyinForms(value) {
  let full = "";
  let initials = "";
  for (const character of compact(value)) {
    const syllable = PINYIN[character];
    full += syllable || character;
    initials += syllable ? syllable[0] : character;
  }
  return [full, initials];
}

function buildSearchText(...values) {
  const source = values.map((value) => String(value || "").toLowerCase()).join(" ");
  const aliases = values.flatMap(pinyinForms);
  return [source, compact(source), ...aliases].join(" ");
}

function normalizeSearchQuery(value) {
  return compact(value);
}

module.exports = { buildSearchText, normalizeSearchQuery, pinyinForms };
