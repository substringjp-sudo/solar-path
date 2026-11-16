/**
 * 시간 슬라이더 해제 이후 단일 수렴 · 드리프트 시계 분리 · 24시간 예열 검증 (2026-11-17).
 *
 * 사용:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/verify-slider-settle.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass++;
    console.log('  PASS: ' + label);
  } else {
    fail++;
    console.log('  FAIL: ' + label);
  }
};

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app/utils/sliderSettle.js'));

  console.log('\n[1] 슬라이더 해제 후 wallElapsedMs(+16ms/프레임)가 수렴을 재리셋하지 않는지 확인');
  {
    const targetMs = Date.UTC(2026, 10, 17, 9, 30, 0);
    const w0 = 1_794_820_000_000;
    let lastSync = { targetMs: null, wallMs: 0 };
    let driftAnchor = null;
    let volSettleRemaining = 18;
    let resetCount = 0;
    let setDateCountDuringSettle = 0;

    // 1~18프레임 수렴 + 이후 12프레임 유휴: 매 프레임 renderedMs 가 16ms 씩 증가
    for (let f = 0; f < 30; f++) {
      const nowWall = w0 + f * 16;
      const d = S.evaluateVolDateSync({
        targetMs,
        overrideActive: false,
        renderedMs: targetMs + f * 16,
        nowWall,
        lastSync,
        driftAnchor,
        volPending: false,
        isInteracting: false,
        volSettleRemaining,
        isLiveClock: false,
      });
      driftAnchor = d.nextAnchor;
      lastSync = d.nextLastSync;
      if (d.shouldResetSettle) {
        resetCount++;
        volSettleRemaining = Math.max(volSettleRemaining, 18);
      }
      if (f > 0 && volSettleRemaining > 0 && d.shouldCallSetDate) {
        setDateCountDuringSettle++;
      }
      if (volSettleRemaining > 0) volSettleRemaining--;
    }

    ok(resetCount === 1, `고정 선택 시각에서 30프레임 동안 수렴 리셋은 최초 1회만 (${resetCount}회)`);
    ok(volSettleRemaining === 0, `18프레임 수렴이 0으로 정상 완료됨 (${volSettleRemaining})`);
    ok(setDateCountDuringSettle === 0, `수렴 구간 중 250ms 드리프트 흔들림 억제 (${setDateCountDuringSettle}회)`);

    // 수렴 완료 뒤 2초 드리프트 타이머 틱: setDate 는 1회 돌되 수렴 리셋(18)은 재발동하지 않음
    const driftTick = S.evaluateVolDateSync({
      targetMs,
      overrideActive: false,
      renderedMs: targetMs + 2300,
      nowWall: w0 + 2300,
      lastSync,
      driftAnchor,
      volPending: false,
      isInteracting: false,
      volSettleRemaining: 0,
      isLiveClock: false,
    });
    ok(driftTick.shouldCallSetDate === true, '수렴 후 2초 드리프트 타이머 틱에서는 vol.setDate 호출');
    ok(driftTick.shouldResetSettle === false, '2초 드리프트 틱은 volSettleRef=18 재수렴을 일으키지 않음');
    ok(Math.abs(driftTick.driftSec - (targetMs + 2300) / 1000) < 1e-3, '바람 드리프트 시계는 앵커 기준 +2.3초 유지');
  }

  console.log('\n[2] 미캐시 씬 비동기 빌드 대기(volPending=true) 중 헛수렴 방지 → 완료 후 1회 수렴');
  {
    const targetMs = Date.UTC(2026, 10, 17, 13, 0, 0);
    const w0 = 1_794_830_000_000;
    const whilePending = S.evaluateVolDateSync({
      targetMs,
      overrideActive: false,
      renderedMs: targetMs,
      nowWall: w0,
      lastSync: { targetMs: targetMs - 3600_000, wallMs: w0 - 500 },
      driftAnchor: { sceneMs: targetMs - 3600_000, wallMs: w0 - 500 },
      volPending: true,
      isInteracting: false,
      volSettleRemaining: 0,
      isLiveClock: false,
    });
    ok(whilePending.shouldCallSetDate === true, '비동기 빌드 중에도 첫 프레임 해 조명용 setDate 는 즉시 반영');
    ok(whilePending.shouldResetSettle === false, '비동기 빌드 대기 중(volPending=true)에는 옛 구름 18프레임 수렴을 시작하지 않음');

    // setSceneAsync 완료 콜백 후 lastSync.targetMs=null, volPending=false
    const afterApply = S.evaluateVolDateSync({
      targetMs,
      overrideActive: false,
      renderedMs: targetMs + 420,
      nowWall: w0 + 420,
      lastSync: { targetMs: null, wallMs: w0 },
      driftAnchor: whilePending.nextAnchor,
      volPending: false,
      isInteracting: false,
      volSettleRemaining: 0,
      isLiveClock: false,
    });
    ok(afterApply.shouldResetSettle === true, 'setSceneAsync 완료 직후 새 구름에 대해 딱 1회 수렴 시작');
  }

  console.log('\n[3] 지금(Live) 모드 1분 연속 경과 vs 타임머신 +1분 버튼 · 1940년대(음수 epoch)');
  {
    const t0 = Date.UTC(2026, 10, 17, 3, 0, 0);
    const w0 = 1_794_840_000_000;
    const anchor = { sceneMs: t0, wallMs: w0 };

    // 3분 연속 1분마다 live clock 갱신 (누적 +180s) -> 끊김 없이 유지되어야 함
    let sync = { targetMs: t0, wallMs: w0 };
    let resets = 0;
    for (let m = 1; m <= 3; m++) {
      const dm = m * 60_000;
      const res = S.evaluateVolDateSync({
        targetMs: t0 + dm,
        overrideActive: false,
        renderedMs: t0 + dm,
        nowWall: w0 + dm,
        lastSync: sync,
        driftAnchor: anchor,
        volPending: false,
        isInteracting: false,
        volSettleRemaining: 0,
        isLiveClock: true,
      });
      sync = res.nextLastSync;
      if (res.shouldResetSettle) resets++;
    }
    ok(resets === 0, `'지금' 모드 1분 주기 경과 3회 연속에서 재수렴 0회 (${resets}회)`);

    // 타임머신 고정 상태에서 60초 지난 뒤 +1분 버튼 클릭 -> 사용자 시각 이동이므로 수렴 1회
    const pinnedStep = S.evaluateVolDateSync({
      targetMs: t0 + 60_000,
      overrideActive: false,
      renderedMs: t0 + 60_000,
      nowWall: w0 + 60_000,
      lastSync: { targetMs: t0, wallMs: w0 },
      driftAnchor: anchor,
      volPending: false,
      isInteracting: false,
      volSettleRemaining: 0,
      isLiveClock: false,
    });
    ok(pinnedStep.shouldResetSettle === true, '타임머신 고정 상태의 +1분 조작은 수렴을 1회 실행');

    // 백그라운드 10분 슬립 후 복귀 -> 시각 도약 > 120s 이므로 재수렴
    const longSleep = S.evaluateVolDateSync({
      targetMs: t0 + 600_000,
      overrideActive: false,
      renderedMs: t0 + 600_000,
      nowWall: w0 + 600_000,
      lastSync: { targetMs: t0, wallMs: w0 },
      driftAnchor: anchor,
      volPending: false,
      isInteracting: false,
      volSettleRemaining: 0,
      isLiveClock: true,
    });
    ok(longSleep.shouldResetSettle === true, '백그라운드 10분 복귀처럼 2분 초과 도약은 재정렬 수렴');

    // 1950년(음수 epoch) 날짜 처리: targetMs=1950년 vs sentinel=null 구분
    const t1950 = Date.UTC(1950, 5, 1, 9, 30, 0);
    const first1950 = S.evaluateVolDateSync({
      targetMs: t1950,
      overrideActive: false,
      renderedMs: t1950,
      nowWall: w0,
      lastSync: { targetMs: null, wallMs: 0 },
      driftAnchor: null,
      volPending: false,
      isInteracting: false,
      volSettleRemaining: 0,
      isLiveClock: false,
    });
    const next1950 = S.evaluateVolDateSync({
      targetMs: t1950,
      overrideActive: false,
      renderedMs: t1950 + 16,
      nowWall: w0 + 16,
      lastSync: first1950.nextLastSync,
      driftAnchor: first1950.nextAnchor,
      volPending: false,
      isInteracting: false,
      volSettleRemaining: 17,
      isLiveClock: false,
    });
    ok(t1950 < 0 && first1950.shouldResetSettle === true && next1950.shouldResetSettle === false,
       '1950년(음수 epoch)도 첫 1회만 수렴하고 다음 프레임에서 재리셋되지 않음');
  }

  console.log('\n[4] 24시간 전시간대 근접 순 예열 버킷 & 캐시 한도(32) 일치 확인');
  {
    const dayStart = Date.UTC(2026, 10, 17, 0, 0, 0);
    const focusNight = dayStart + 22 * 3600000 + 1800000;
    const buckets = S.buildDayPrewarmBuckets(dayStart, focusNight);
    ok(buckets.length === 24 && new Set(buckets).size === 24, `하루 24개 고유 버킷 생성 (${buckets.length}개)`);
    ok(buckets[0] === focusNight, '현재 보고 있는 버킷(야간 22:30 포함)이 최우선 예열 대상');
    ok(Math.abs(buckets[1] - focusNight) === 3600_000 && Math.abs(buckets[2] - focusNight) === 3600_000,
       '인접 ±1시간 버킷이 그다음 우선순위');

    const repoRoot = path.resolve(__dirname, '../..');
    const volSrc = fs.readFileSync(path.join(repoRoot, 'src/components/VolumetricProbe/volumetricScene.ts'), 'utf8');
    const waveSrc = fs.readFileSync(path.join(repoRoot, 'src/components/VolumetricProbe/cloudWave.ts'), 'utf8');
    const weatherSize = volSrc.match(/const WEATHER_CACHE_SIZE\s*=\s*(\d+)/)?.[1];
    const waveSize = volSrc.match(/const WAVE_CACHE_SIZE\s*=\s*(\d+)/)?.[1];
    const rawWaveSize = waveSrc.match(/const RAW_WAVE_CACHE_MAX\s*=\s*(\d+)/)?.[1];
    ok(weatherSize === '32' && waveSize === '32' && rawWaveSize === '32',
       `날씨/파동 3D/원시 파동 캐시 한도가 모두 32로 일치 (weather=${weatherSize}, wave=${waveSize}, raw=${rawWaveSize})`);
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
})();
