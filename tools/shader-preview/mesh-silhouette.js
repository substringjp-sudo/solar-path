/**
 * **그려진 지형 격자의 능선**을 CPU 로 따로 냅니다 (§94, 판정 전용).
 *
 * 앱의 TerrainField 는 고리 × 살 **꼭짓점**에서만 높이를 읽고 그 사이를 곧게 잇습니다.
 * 구름 셰이더는 이제 이 능선(굽기의 B·A)보다 위에서는 구름을 자르지 않으므로, 판정의
 * 참조도 연속 DEM 이 아니라 이 능선이어야 합니다.
 *
 * ⚠ 배치는 앱과 **같아야** 합니다 — SkyScene3D 858행:
 *   rings = FIELD_RINGS(152) + FAR_FIELD_RINGS(96), farM = FAR_FIELD_FAR_M(55000),
 *   살 FIELD_SPOKES(256), 고리 거리는 groundProjection.ringDistanceM 의 두 구간 로그
 *   (발밑 FIELD_FOOT_M 0.6m → 경첩 FIELD_HINGE_M 12m 에 FIELD_INNER_RINGS 24개, 나머지 55km 까지).
 *   셰이더 쪽(CloudSlab 의 HORIZON_BAKE_FRAG)은 같은 상수를 모듈에서 가져옵니다.
 */
const RINGS = 152 + 96, SPOKES = 256, FOOT = 0.6, HINGE = 12, INNER = 24, FAR_M = 55000;
const R_M = 6371000;

const ringM = (k) => (k < INNER
  ? FOOT * Math.pow(HINGE / FOOT, k / INNER)
  : HINGE * Math.pow(FAR_M / HINGE, (k - INNER) / (RINGS - INNER - 1)));

/**
 * @param terrM (동 m, 남 m) → 고도 m (모르면 null). 앱 fieldElev 와 같은 넘기기여야 합니다.
 * @param eyeM  눈 고도(발밑 + 눈높이) m
 * @param azDeg 방위 (북 0, 동 90)
 * @returns 그 방위의 그려진 능선 고도각(°)
 */
function meshSilhouetteDeg(terrM, eyeM, azDeg) {
  const jf = (((azDeg % 360) + 360) % 360) / 360 * SPOKES;
  const j0 = Math.floor(jf), t = jf - j0;
  const a0 = (j0 / SPOKES) * 2 * Math.PI, a1 = ((j0 + 1) / SPOKES) * 2 * Math.PI;
  let best = -90;
  for (let k = 0; k < RINGS; k++) {
    const d = ringM(k);
    const h0 = terrM(Math.sin(a0) * d, -Math.cos(a0) * d);
    const h1 = terrM(Math.sin(a1) * d, -Math.cos(a1) * d);
    if (h0 == null || h1 == null) continue;
    const drop = (d * d) / (2 * R_M);
    const e0 = Math.atan2(h0 - eyeM - drop, d), e1 = Math.atan2(h1 - eyeM - drop, d);
    best = Math.max(best, ((e0 + (e1 - e0) * t) * 180) / Math.PI);
  }
  return best;
}

module.exports = { meshSilhouetteDeg, MESH: { RINGS, SPOKES, FOOT, HINGE, INNER, FAR_M } };
