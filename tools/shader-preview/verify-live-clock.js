/**
 * **화면의 시각이 시계를 따라가는가** (2026-10-02) — 판정. 브라우저가 필요 없습니다.
 *
 * 사용자 보고: 후쿠이(36.0209 N, 136.2894 E) 21:02 JST 카메라 기록의 QR 시각은 12:02:25Z(해 −40.5°)
 * 인데 함께 담긴 시뮬레이션은 17시대 노을이었습니다. 1분 타이머가 기본 탭(하늘)에서 꺼져 있어
 * `currentTime` 이 멈춰 있었습니다(src/utils/liveClock.ts).
 *
 * 스토어의 시각 조각(`createClockSlice`)을 **진짜 zustand 스토어**에 얹고, 1분 타이머와 앱 상태는
 * 가짜로 돌립니다(`followClock` 에 가짜 타이머·가짜 AppState). 부르는 것은 화면과 같습니다 — 사용자가
 * 고른 시각은 `pinTime`, "지금" 은 `setTimeMachineEnabled(false)`, 카메라 열기는 `updateTime` 뒤
 * `currentTime` 을 읽습니다(useCelestialApp 의 `setSunCameraVisible`).
 *
 *  1. 하늘 탭에 그대로 있으면 1분 뒤 시각이 흐른다 — 기본은 따라감이고, 타이머는 탭을 묻지 않는다.
 *  2. 슬라이더·이벤트 칩으로 고른 시각(`pinTime`)은 몇 분이 지나도, 앱이 다시 활성화돼도 그대로다.
 *     붙든 동안 1분 틱은 구독자를 깨우지 않는다(화면을 다시 그리지 않음).
 *  3. "지금" 을 누르면 지금으로 돌아가고, 다시 1분마다 흐른다.
 *  4. 백그라운드에서 한 시간 뒤 돌아오면(그동안 타이머는 잠듦) 활성화되는 순간 지금 시각이다.
 *  5. 같은 상황에서 카메라를 열면 시뮬레이션 시각의 해 고도가 QR(셔터 순간)과 같다 — 후쿠이 수치로.
 *     활성화 알림 없이 카메라부터 열려도(바로가기 딥링크) 지금 시각이고, 붙든 시각은 카메라도 그대로 쓴다.
 *  6. 함정 — 시각**만** 바꾸는 `setCurrentTime` 은 표시를 안 켜서 1분 안에 튕겨 돌아간다. 그래서 사용자가
 *     고른 시각은 `pinTime` 으로 넣는다(예전 이벤트 칩이 이랬습니다).
 *  7. 멈추면 타이머와 앱 상태 구독이 풀린다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-live-clock.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

const MIN = 60_000, HOUR = 3_600_000;

/**
 * 가짜 세계 — 시계, setInterval, AppState.
 *  - `advance(ms)`: 앱이 앞에 있음. 그 사이 다가온 틱을 차례로 쏩니다.
 *  - `sleep(ms)`: 백그라운드. 시간만 흐르고 타이머는 잠들었다가 **멈춘 자리에서** 이어 갑니다 —
 *    돌아온 뒤 다음 틱까지 옛 시각이 남는 가장 나쁜 경우입니다.
 *  - `becomeActive()`: AppState 'active'.
 */
function makeWorld(startIso) {
  let now = new Date(startIso).getTime();
  const intervals = new Map();
  let nextId = 1;
  const activeListeners = new Set();
  const timers = {
    setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms, due: now + ms }); return id; },
    clearInterval: (id) => { intervals.delete(id); },
  };
  const onActive = (fn) => { activeListeners.add(fn); return () => { activeListeners.delete(fn); }; };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const t of intervals.values()) if (t.due <= end && (!next || t.due < next.due)) next = t;
      if (!next) break;
      now = next.due;
      next.due += next.ms;
      next.fn();
    }
    now = end;
  };
  const sleep = (ms) => {
    now += ms;
    for (const t of intervals.values()) t.due += ms;
  };
  const becomeActive = () => { for (const fn of [...activeListeners]) fn(); };
  return { now: () => new Date(now), timers, onActive, advance, sleep, becomeActive, intervals, activeListeners };
}

(async () => {
  const C = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'liveClock.js'));
  const { createStore } = require(path.join(__dirname, '..', '..', 'node_modules', 'zustand', 'vanilla'));
  const SunCalc = require(path.join(__dirname, '..', '..', 'node_modules', 'suncalc'));
  const D = 180 / Math.PI;

  /** 스토어 + 1분 타이머·앱 복귀를 켠 앱 하나. 화면처럼 `followClock(updateTime, …)` 으로 겁니다. */
  const boot = (startIso) => {
    const world = makeWorld(startIso);
    const store = createStore((set) => C.createClockSlice(set, world.now));
    const stop = C.followClock(() => store.getState().updateTime(), world.onActive, world.timers);
    let notified = 0;
    store.subscribe(() => { notified++; });
    const t = () => store.getState().currentTime.getTime();
    return { world, store, stop, t, notified: () => notified };
  };
  const hhmm = (ms) => new Date(ms + 9 * HOUR).toISOString().slice(11, 19) + ' JST';

  console.log('\n[1] 하늘 탭에 그대로 — 1분 뒤 시각이 흐른다');
  {
    const { world, store, t } = boot('2026-10-02T08:00:00Z'); // 17:00 JST
    ok(C.CLOCK_TICK_MS === MIN, '틱은 1분');
    ok(store.getState().isTimeMachineEnabled === false, '기본은 시계를 따라감(LIVE)');
    const t0 = t();
    world.advance(MIN);
    console.log(`      ${hhmm(t0)} → 1분 뒤 ${hhmm(t())}`);
    ok(t() - t0 === MIN && t() === world.now().getTime(), '1분 뒤 currentTime 이 지금으로 1분 진행 — followClock 은 탭을 받지 않습니다');
    world.advance(10 * MIN);
    ok(t() === world.now().getTime(), '10분 뒤에도 지금');
  }

  console.log('\n[2] 슬라이더·이벤트 칩으로 고른 시각은 그대로');
  {
    const { world, store, t, notified } = boot('2026-10-02T08:00:00Z');
    const picked = new Date('2026-10-02T08:40:00Z'); // 17:40 JST — 일몰 칩
    store.getState().pinTime(picked);
    ok(store.getState().isTimeMachineEnabled === true, '고르면 표시가 켜진다(SIM — "지금" 단추가 뜸)');
    const before = notified();
    world.advance(5 * MIN);
    console.log(`      골라 둔 ${hhmm(picked.getTime())} · 5분 뒤 ${hhmm(t())} · 지금 ${hhmm(world.now().getTime())}`);
    ok(t() === picked.getTime(), '5분이 지나도 고른 시각 그대로');
    ok(notified() === before, '붙든 동안 1분 틱은 구독자를 깨우지 않는다');
    world.becomeActive();
    ok(t() === picked.getTime(), '앱이 다시 활성화돼도 그대로');
    const later = new Date('2026-10-03T21:00:00Z');
    store.getState().pinTime(later);
    world.advance(3 * MIN);
    ok(t() === later.getTime(), '다시 고른 시각도 그대로');
  }

  console.log('\n[3] "지금" 을 누르면 다시 따라간다');
  {
    const { world, store, t } = boot('2026-10-02T08:00:00Z');
    store.getState().pinTime(new Date('2026-10-02T08:40:00Z'));
    world.advance(3 * MIN);
    store.getState().setTimeMachineEnabled(false);
    ok(store.getState().isTimeMachineEnabled === false && t() === world.now().getTime(), '"지금" — 지금 시각, LIVE');
    const t0 = t();
    world.advance(MIN);
    ok(t() - t0 === MIN, '그 뒤 1분마다 흐른다');
    store.getState().setTimeMachineEnabled(true);
    const held = t();
    world.advance(2 * MIN);
    ok(t() === held, '슬라이더를 잡으면(onGrant → setTimeMachineEnabled(true)) 그 자리에서 붙든다');
  }

  console.log('\n[4] 백그라운드에서 한 시간 뒤 돌아오면 지금 시각');
  {
    const { world, t } = boot('2026-10-02T08:00:00Z');
    world.advance(30 * 1000); // 다음 틱까지 30초 남은 때 백그라운드로
    const left = t();
    world.sleep(HOUR);
    ok(world.now().getTime() - t() === HOUR + 30 * 1000, `돌아온 순간 타이머만으로는 아직 옛 시각(${hhmm(left)}) — 다음 틱까지 30초`);
    world.becomeActive();
    console.log(`      백그라운드 ${hhmm(left)} → 활성화 ${hhmm(t())}`);
    ok(t() === world.now().getTime(), '활성화되는 순간 지금 시각');
  }

  console.log('\n[5] 같은 상황에서 카메라 기록의 시뮬레이션이 지금 하늘을 그린다 — 후쿠이');
  {
    const LAT = 36.0209, LON = 136.2894;
    const alt = (ms) => SunCalc.getPosition(new Date(ms), LAT, LON).altitude * D;
    const SHUTTER = Date.parse('2026-10-02T12:02:25Z'); // QR 의 t (21:02:25 JST)

    // 17:20 JST 에 앱을 보다 백그라운드로 — 21:02 에 돌아와 바로 카메라를 엽니다.
    const a = boot('2026-10-02T08:20:00Z');
    const stale = a.t();
    a.world.sleep(SHUTTER - a.world.now().getTime());
    a.world.becomeActive();
    a.store.getState().updateTime(); // 카메라 열기 (setSunCameraVisible(true))
    const camTime = a.t();
    console.log(`      멈췄던 시각 ${hhmm(stale)} → 해 ${alt(stale).toFixed(2)}° (예전에 그리던 노을)`);
    console.log(`      카메라 시각 ${hhmm(camTime)} → 해 ${alt(camTime).toFixed(2)}° · QR(셔터) ${hhmm(SHUTTER)} → 해 ${alt(SHUTTER).toFixed(2)}°`);
    ok(Math.abs(alt(SHUTTER) - (-40.5)) < 0.05, 'QR 시각의 해 고도 −40.5° (보고와 같음)');
    ok(camTime === SHUTTER && Math.abs(alt(camTime) - alt(SHUTTER)) < 1e-9, '카메라 3D 의 시각·해 고도가 QR 과 같다');

    // 바로가기(beforeglow://camera)로 열려 활성화 알림보다 카메라가 먼저일 때 — 카메라 열기가 맞춥니다.
    const b = boot('2026-10-02T08:20:00Z');
    b.world.sleep(SHUTTER - b.world.now().getTime());
    b.store.getState().updateTime();
    ok(b.t() === SHUTTER, '활성화 알림 없이 카메라부터 열려도 지금 시각');

    // 사용자가 내일 일몰을 골라 둔 채 카메라를 열면 그 시각을 그대로 씁니다.
    const c = boot('2026-10-02T08:20:00Z');
    const picked = Date.parse('2026-10-03T08:38:00Z');
    c.store.getState().pinTime(new Date(picked));
    c.world.sleep(HOUR);
    c.world.becomeActive();
    c.store.getState().updateTime();
    ok(c.t() === picked, '붙든 시각은 카메라도 그대로');
  }

  console.log('\n[6] 함정 — 시각만 바꾸는 길은 튕겨 돌아간다');
  {
    const { world, store, t } = boot('2026-10-02T08:00:00Z');
    store.getState().setCurrentTime(new Date('2026-10-02T08:40:00Z'));
    ok(store.getState().isTimeMachineEnabled === false, 'setCurrentTime 은 표시를 안 켠다(LIVE 로 남음)');
    world.advance(MIN);
    ok(t() === world.now().getTime(), '1분 안에 지금으로 튕겨 돌아간다 — 사용자가 고른 시각은 pinTime 으로');
  }

  console.log('\n[7] 멈추면 구독이 풀린다');
  {
    const { world, stop, t } = boot('2026-10-02T08:00:00Z');
    ok(world.intervals.size === 1 && world.activeListeners.size === 1, '켜면 타이머 1개 · 앱 상태 구독 1개');
    stop();
    ok(world.intervals.size === 0 && world.activeListeners.size === 0, '멈추면 둘 다 풀림');
    const t0 = t();
    world.advance(5 * MIN);
    world.becomeActive();
    ok(t() === t0, '멈춘 뒤에는 시각을 안 건드린다');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
