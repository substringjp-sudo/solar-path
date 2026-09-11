/**
 * **평면에서 구로 언제 넘어가는가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/mapProjection.ts` 머리말에 있습니다.
 *
 * ## 이 자가 지키려는 것
 *
 * 1. **전환점이 위도 함수다** — 상수로 박으면 고위도에서 너무 늦게 넘어갑니다.
 * 2. **왜곡 계산이 적도를 걸치는 구간에서도 맞다** — 처음에 여기를 틀려서
 *    화면 폭 180° 가 "왜곡 없음" 으로 나왔습니다.
 * 3. **경계에서 화면이 안 튄다** — 진행도가 0 에서 1 로 이어집니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-map-projection.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'mapProjection.js'));
  const {
    mercatorStretch, mapModeFor, deltaForStretch, globeProgress, visibleLatSpan,
    GLOBE_STRETCH, SILHOUETTE_STRETCH, DEFAULT_ASPECT,
  } = M;

  // ── [1] 왜곡이 물리와 맞는가 ───────────────────────────────────────
  console.log('\n[1] 메르카토르 늘어남');
  {
    console.log('      중심 37.5°N — 화면 폭별 늘어남');
    for (const d of [10, 20, 30, 40, 60, 90]) {
      const { lo, hi } = visibleLatSpan(37.5, d);
      console.log(`        ${String(d).padStart(3)}°  위도 ${lo.toFixed(0)}~${hi.toFixed(0)}°  → ${mercatorStretch(37.5, d).toFixed(2)}배`);
    }
    ok(mercatorStretch(37.5, 1) < 1.05, `아주 좁으면 늘어남이 없다 (${mercatorStretch(37.5, 1).toFixed(3)})`);
    // 단조 — 넓힐수록 반드시 커져야 합니다(극에 닿아 포화되기 전까지).
    let mono = true, prev = 0;
    for (let d = 1; d <= 80; d += 1) {
      const s = mercatorStretch(37.5, d);
      if (s < prev - 1e-9) mono = false;
      prev = s;
    }
    ok(mono, `넓힐수록 늘어남이 단조로 커진다`);
  }

  // ── [2] ⚠ 적도를 걸치는 구간 ──────────────────────────────────────
  //    처음에 min|위도| 를 min(|lo|,|hi|) 로 써서 여기를 틀렸습니다.
  console.log('\n[2] 적도를 걸치는 구간에서도 맞는가');
  {
    const wide = mercatorStretch(37.5, 180);
    const { lo, hi } = visibleLatSpan(37.5, 180);
    console.log(`      화면 폭 180° → 위도 ${lo.toFixed(0)}~${hi.toFixed(0)}° · 늘어남 ${wide.toFixed(2)}배`);
    ok(wide > 5, `세계 전체를 담으면 크게 늘어난다 (${wide.toFixed(2)}배) — 1.00 이 나오면 적도 처리가 틀린 것`);
    const eq = mercatorStretch(0, 120);
    console.log(`      적도 중심 화면 폭 120° → ${eq.toFixed(2)}배`);
    ok(eq > 2, `적도 중심이라도 넓히면 늘어난다 (${eq.toFixed(2)}배)`);
  }

  // ── [3] ⚠ 전환점이 위도 함수인가 ──────────────────────────────────
  console.log('\n[3] 전환점 — 상수가 아니라 위도 함수인가');
  {
    const rows = [0, 20, 37.5, 50, 60];
    const got = {};
    for (const la of rows) {
      const sil = deltaForStretch(la, SILHOUETTE_STRETCH);
      const glo = deltaForStretch(la, GLOBE_STRETCH);
      got[la] = { sil, glo };
      console.log(`      ${String(la).padStart(4)}°N — 실루엣 ${sil.toFixed(0)}° 부터 · 구 ${glo.toFixed(0)}° 부터`);
    }
    ok(got[60].glo < got[37.5].glo && got[37.5].glo < got[0].glo,
       `고위도일수록 일찍 구로 간다 (60°N ${got[60].glo.toFixed(0)}° < 37.5°N ${got[37.5].glo.toFixed(0)}° < 적도 ${got[0].glo.toFixed(0)}°)`);
    ok(got[0].glo / got[60].glo > 2,
       `위도에 따라 두 배 넘게 갈린다 — 상수로 박으면 한쪽이 크게 틀린다 (${(got[0].glo / got[60].glo).toFixed(1)}배)`);
    for (const la of rows) {
      ok(got[la].sil < got[la].glo, `${la}°N: 실루엣이 구보다 먼저 온다`);
    }
  }

  // ── [4] 모드가 순서대로 오는가 ────────────────────────────────────
  console.log('\n[4] 모드 순서');
  {
    const seq = [];
    let prev = null;
    for (let d = 0.5; d <= 360; d *= 1.05) {
      const m = mapModeFor(37.5, d);
      if (m !== prev) { seq.push(`${m}@${d.toFixed(1)}°`); prev = m; }
    }
    console.log(`      37.5°N: ${seq.join('  →  ')}`);
    ok(seq.length === 3, `모드가 셋이고 한 번씩만 바뀐다 (되돌아가지 않는다)`);
    ok(seq[0].startsWith('tiles') && seq[1].startsWith('silhouette') && seq[2].startsWith('globe'),
       `타일 → 실루엣 → 구 순서다`);
    ok(mapModeFor(37.5, 0.3) === 'tiles', `동네 축척은 타일`);
    ok(mapModeFor(37.5, 300) === 'globe', `세계 축척은 구`);
  }

  // ── [5] ⚠ 경계에서 화면이 튀지 않는가 ─────────────────────────────
  console.log('\n[5] 전환 진행도 — 이어지는가');
  {
    const la = 37.5;
    const silD = deltaForStretch(la, SILHOUETTE_STRETCH);
    const gloD = deltaForStretch(la, GLOBE_STRETCH);
    const at = d => globeProgress(la, d);
    console.log(`      실루엣 시작 ${silD.toFixed(1)}° → 진행도 ${at(silD).toFixed(3)}`);
    console.log(`      중간        ${((silD + gloD) / 2).toFixed(1)}° → 진행도 ${at((silD + gloD) / 2).toFixed(3)}`);
    console.log(`      구 시작     ${gloD.toFixed(1)}° → 진행도 ${at(gloD).toFixed(3)}`);
    ok(at(silD * 0.9) === 0, `실루엣 전에는 0`);
    ok(Math.abs(at(silD)) < 1e-6, `실루엣 시작에서 0 — 여기서 튀면 화면이 점프한다`);
    ok(Math.abs(at(gloD) - 1) < 1e-6, `구 시작에서 1`);
    ok(at(gloD * 1.5) === 1, `구 안쪽은 계속 1`);
    // 중간에서 단조로 올라야 합니다.
    let mono = true, prev = -1;
    for (let d = silD; d <= gloD; d += (gloD - silD) / 50) {
      const p = at(d);
      if (p < prev - 1e-9) mono = false;
      prev = p;
    }
    ok(mono, `띠 안에서 진행도가 단조로 오른다`);
    // 최대 걸음 — 한 단계에서 확 튀면 눈에 보입니다.
    let maxStep = 0, last = at(silD);
    for (let d = silD; d <= gloD; d += (gloD - silD) / 100) {
      const p = at(d); maxStep = Math.max(maxStep, Math.abs(p - last)); last = p;
    }
    console.log(`      100단계로 나눌 때 한 걸음 최대 ${maxStep.toFixed(3)}`);
    ok(maxStep < 0.05, `한 걸음이 작다 — 부드럽게 이어진다`);
  }

  // ── [6] 종횡비를 실제로 쓰는가 ────────────────────────────────────
  console.log('\n[6] 화면 종횡비');
  {
    const tall = mercatorStretch(37.5, 30, 2.2);
    const wide = mercatorStretch(37.5, 30, 1.0);
    console.log(`      같은 30° — 세로가 긴 화면 ${tall.toFixed(2)}배 · 정사각 ${wide.toFixed(2)}배`);
    ok(tall > wide, `세로로 긴 화면이 더 많이 늘어난다 (위도를 더 담으므로)`);
    ok(DEFAULT_ASPECT > 1, `기본 종횡비가 세로로 길다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
