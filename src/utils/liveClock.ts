/**
 * 화면의 시각(`currentTime`)이 **시계를 따라가는가** — 언제 지금으로 맞추고 언제 그대로 두는지.
 *
 * ## 고치는 결함
 *
 * 1분 타이머가 `activeTab !== 'sky'` 일 때만 시각을 맞췄습니다. 원래 조건은 `'sim'` — 시뮬레이션
 * 탭에서 슬라이더로 옮긴 시각을 1분마다 덮지 않으려는 장치였는데, 2026-08-03 화면 개편(1454393)
 * 에서 기계적으로 `'sky'` 로 바뀌었고 `'sky'` 는 기본 탭입니다. 그래서 **메인 화면에 있는 동안
 * 시각이 전혀 흐르지 않았고**, 백그라운드에서 돌아와도 그대로였습니다.
 *
 * 실제 기록 — 후쿠이(36.0209 N, 136.2894 E), 2026-10-02 21:02 JST 의 카메라 기록: QR 시각은
 * 12:02:25Z(해 고도 −40.5°)인데 함께 담긴 시뮬레이션은 17시대 노을이었습니다. QR 은 셔터 순간의
 * 실제 시각을 쓰고, 카메라 3D 는 스토어의 `currentTime` 으로 해·달·하늘을 그립니다(SunCamera.tsx).
 *
 * ## 탭이 아니라 "사용자가 골랐는가" 로 가릅니다
 *
 * 그 표시가 `isTimeMachineEnabled` 입니다 — 켜짐이면 사용자가 붙든 시각(시계를 안 따라감), 기본은
 * 꺼짐(따라감). 화면의 SIM/LIVE 표지와 "지금" 단추가 이미 이것을 봅니다.
 *
 *  - 사용자가 직접 고른 시각(슬라이더·이벤트 칩·날짜·텔레포트)은 `pinTime` 으로 넣어 **시각과
 *    표시를 한 번에** 바꿉니다.
 *  - "지금" 은 `setTimeMachineEnabled(false)` — 지금으로 돌아가 다시 따라갑니다.
 *  - `updateTime` 은 따라가는 중일 때만 지금으로 맞춥니다. 1분마다, 앱이 다시 활성화될 때(`followClock`),
 *    카메라를 열 때 부릅니다(hooks/useCelestialApp.ts).
 *
 * ⚠ 탭 조건만 지우면 안 됐습니다. 슬라이더는 잡는 순간 표시를 켰지만, 이벤트 칩과 하늘 탭에 들어올 때
 *   일출·일몰로 옮기던 것은 **시각만** 바꿨습니다. 그래서 화면은 LIVE 인데 시각은 멈춰 있었고("지금"
 *   단추도 안 떴습니다), 타이머가 돌면 1분 안에 지금으로 튕겨 돌아갑니다. 사용자가 고른 시각은 전부
 *   `pinTime` 하나로 지나게 했습니다.
 *
 * 화면·RN 과 떨어진 순수 논리라 가짜 타이머로 판정합니다(tools/shader-preview/verify-live-clock.js).
 */

/** 시계를 따라가는 중일 때 시각을 맞추는 주기 */
export const CLOCK_TICK_MS = 60_000;

export interface ClockState {
  currentTime: Date;
  /** 켜짐 = 사용자가 고른 시각을 붙든 것(시계를 안 따라감). 기본은 꺼짐 — 시계를 따라갑니다. */
  isTimeMachineEnabled: boolean;
  /** 시각**만** 바꿉니다("지금" 애니메이션의 프레임). 사용자가 고른 시각은 `pinTime` 으로 넣으세요. */
  setCurrentTime: (time: Date) => void;
  /** 켜면 지금 보이는 시각을 붙들고, 끄면 지금으로 돌아가 다시 따라갑니다("지금"). */
  setTimeMachineEnabled: (enabled: boolean) => void;
  /** 사용자가 직접 고른 시각 — 그 시각으로 옮기고 시계에서 뗍니다. */
  pinTime: (time: Date) => void;
  /** 시계를 따라가는 중이면 지금으로 맞춥니다. 붙든 시각은 건드리지 않습니다. */
  updateTime: () => void;
}

/** zustand `set` 중 이 조각이 쓰는 꼴 */
type ClockSet = (partial: Partial<ClockState> | ((state: ClockState) => Partial<ClockState>)) => void;

/**
 * 스토어의 시각 조각. `useCelestialStore` 가 펼쳐 넣고, 판정은 같은 것을 맨 zustand 스토어에 얹습니다.
 * @param now 지금 시각 — 판정이 가짜 시계를 넣습니다.
 */
export const createClockSlice = (set: ClockSet, now: () => Date = () => new Date()): ClockState => ({
  currentTime: now(),
  isTimeMachineEnabled: false,
  setCurrentTime: (time) => set({ currentTime: time }),
  setTimeMachineEnabled: (enabled) => set((state) => ({
    isTimeMachineEnabled: enabled,
    currentTime: enabled ? state.currentTime : now(),
  })),
  pinTime: (time) => set({ currentTime: time, isTimeMachineEnabled: true }),
  // 같은 상태를 돌려주면 zustand 가 구독자를 안 깨웁니다 — 붙든 동안에는 1분마다 다시 그리지 않습니다.
  updateTime: () => set((state) => (state.isTimeMachineEnabled ? state : { currentTime: now() })),
});

export interface ClockTimers {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: any) => void;
}

// ⚠ 전역 타이머를 객체에 담아 메서드로 부르면 웹(react-native-web)에서 "Illegal invocation" 이 납니다.
const SYSTEM_TIMERS: ClockTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

/**
 * `sync`(보통 `updateTime`)를 **1분마다**, 그리고 **앱이 다시 활성화될 때** 부릅니다. 돌려받은 함수로 멈춥니다.
 *
 * ⚠ 어느 탭인지 묻지 않습니다. 붙든 시각을 지키는 것은 `updateTime` 이 보는 `isTimeMachineEnabled`
 *   하나입니다 — 탭으로 가르면 그 탭이 기본 탭이 되는 순간 시계가 멈춥니다(위 결함).
 * ⚠ 백그라운드에서는 OS 가 JS 타이머를 재웁니다. 1분 타이머만 있으면 돌아온 뒤 다음 틱까지 옛 시각이고,
 *   그 사이에 연 카메라는 옛 하늘을 찍습니다. 그래서 활성화되는 순간 따로 맞춥니다.
 *
 * @param onActive 앱이 다시 활성화될 때 부를 함수를 걸고, 떼는 함수를 돌려줍니다(RN `AppState`).
 */
export function followClock(
  sync: () => void,
  onActive: (fn: () => void) => () => void,
  timers: ClockTimers = SYSTEM_TIMERS,
): () => void {
  const id = timers.setInterval(sync, CLOCK_TICK_MS);
  const off = onActive(sync);
  return () => {
    timers.clearInterval(id);
    off();
  };
}
