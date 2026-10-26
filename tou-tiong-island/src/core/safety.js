/**
 * 安全訊號偵測。
 *
 * 只在這台裝置上執行：掃到關鍵字就直接在本機顯示求助資源，不會因此多送出任何
 * 資料，也不會替玩家貼上任何標籤。這不是風險評估，只是把電話放在看得到的地方。
 */
export function scanForRisk(text, safetyConfig) {
  if (!text) return { flagged: false };
  const normalized = String(text).replace(/\s/g, '');
  const hit = (safetyConfig.trigger_keywords ?? []).find((k) => normalized.includes(k));
  return hit ? { flagged: true, keyword: hit } : { flagged: false };
}

export function safetyPayload(safetyConfig) {
  return {
    message: `${safetyConfig.intro}${safetyConfig.body}`,
    resources: safetyConfig.resources,
    closing: safetyConfig.closing,
  };
}
