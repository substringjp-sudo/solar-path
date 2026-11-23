/**
 * debouncedPersist.ts — zustand `persist` 의 **저장소 어댑터**. `createJSONStorage` 대신 씁니다(2026-11-23, 앱 켜기 줄이기).
 *
 * ## 왜
 * zustand persist 는 스토어의 `set()` 이 불릴 때마다 저장을 다시 합니다 — 저장 대상 필드가 하나도 안 바뀌어도 그렇습니다
 * (나침반 센서 콜백 · 켜는 동안의 로딩 상태 4 번 · 위치 · 캐시 목록 …). 그때마다 위치 · 저장한 곳 · 내 사진 목록 · 장면 전체를 JSON 으로 만들고,
 * 글자마다 XOR 암호화해 16진수로 바꾼 뒤 AsyncStorage 에 썼습니다. 켜는 동안 JS 스레드를 가장 많이 붙잡는 일 가운데 하나였습니다.
 *
 * ## 무엇을 하나
 *  1. 저장 대상(`state`)이 앞과 **필드마다 같은 참조**면 아무것도 안 합니다(직렬화도 안 함). `partialize` 가 새 객체를 만들어도 필드가 같으면 같은 것으로 봅니다.
 *  2. 바뀌었으면 `delayMs` 동안 모아 두었다가 **마지막 값 하나만** 씁니다.
 *  3. 쓰기 직전에 직렬화한 글이 마지막에 쓴 것과 같으면 쓰지 않습니다.
 *  4. `flush()` 는 모아 둔 것을 바로 씁니다 — 앱이 뒤로 갈 때 부릅니다(그 사이에 앱이 죽어도 잃는 것은 `delayMs` 안의 변경뿐).
 *
 * 암호화(`encode`/`decode`)와 저장소(`raw`)는 밖에서 넣습니다 — `security.ts` 가 `expo-constants` 를 끌어와 Node 판정 하네스에서 못 불러오기 때문입니다.
 * 판정: `tools/shader-preview/verify-startup-trim.js`.
 */
export interface RawStore {
  getItem: (name: string) => Promise<string | null>;
  setItem: (name: string, value: string) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
}

export interface PersistValue<S> { state: S; version?: number }

export interface DebouncedPersistOptions {
  raw: RawStore;
  delayMs: number;
  encode: (text: string) => string;
  decode: (text: string) => string;
  /** 시험에서 시계를 바꿔 끼우기 위한 자리. 기본은 setTimeout / clearTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const shallowSame = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if ((a as any)[k] !== (b as any)[k]) return false;
  return true;
};

export function createDebouncedPersistStorage<S = unknown>(opts: DebouncedPersistOptions) {
  const { raw, delayMs, encode, decode } = opts;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as any));

  const lastSeen = new Map<string, PersistValue<S>>();
  const pending = new Map<string, PersistValue<S>>();
  const timers = new Map<string, unknown>();
  const lastWritten = new Map<string, string>();

  const write = async (name: string): Promise<void> => {
    const t = timers.get(name);
    if (t !== undefined) { cancel(t); timers.delete(name); }
    const v = pending.get(name);
    if (!v) return;
    pending.delete(name);
    const json = JSON.stringify(v);
    if (lastWritten.get(name) === json) return;
    let out = json;
    try { out = encode(json); } catch { out = json; }   // 암호화에 실패하면 평문으로 — 옛 동작과 같음
    try {
      await raw.setItem(name, out);
      lastWritten.set(name, json);
    } catch (e) {
      console.warn('[persist] 저장 실패:', e);
    }
  };

  return {
    getItem: async (name: string): Promise<PersistValue<S> | null> => {
      const stored = await raw.getItem(name);
      if (!stored) return null;
      let text: string;
      try { text = decode(stored); } catch { text = stored; }   // 암호화 전에 저장한 옛 값
      try {
        const parsed = JSON.parse(text) as PersistValue<S>;
        lastWritten.set(name, text);
        return parsed;
      } catch (e) {
        console.warn('[persist] 저장된 값을 읽지 못했습니다:', e);
        return null;
      }
    },
    setItem: async (name: string, value: PersistValue<S>): Promise<void> => {
      const prev = lastSeen.get(name);
      if (prev && prev.version === value.version && shallowSame(prev.state, value.state)) return;
      lastSeen.set(name, value);
      pending.set(name, value);
      if (!timers.has(name)) timers.set(name, schedule(() => { void write(name); }, delayMs));
    },
    removeItem: async (name: string): Promise<void> => {
      const t = timers.get(name);
      if (t !== undefined) { cancel(t); timers.delete(name); }
      pending.delete(name); lastSeen.delete(name); lastWritten.delete(name);
      await raw.removeItem(name);
    },
    /** 모아 둔 것을 바로 씁니다(앱이 뒤로 갈 때). */
    flush: async (): Promise<void> => {
      for (const name of [...pending.keys()]) await write(name);
    },
  };
}
