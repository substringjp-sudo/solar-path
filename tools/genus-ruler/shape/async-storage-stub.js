// 하네스(node) 전용 — 앱의 AsyncStorage 자리에 메모리 저장소를 둡니다.
const m = new Map();
module.exports = { default: { getItem: async k => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); }, removeItem: async k => { m.delete(k); }, getAllKeys: async () => [...m.keys()], multiRemove: async ks => ks.forEach(k => m.delete(k)) } };
