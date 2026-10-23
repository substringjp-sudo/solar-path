/**
 * 메르카토르 ↔ 정사영 구 사이를 잇는 투영(§153).
 *
 * d3 는 `rotate([-λ₀, -φ₀])` 로 한가운데를 (0, 0) 에 옮긴 뒤 raw 투영을 부릅니다. 정사영은 그 돌린 좌표를
 * 그대로 쓰면 되지만, 메르카토르(구글 타일)는 **돌리기 전의 위도**로 그려야 위도선이 가로로 곧습니다.
 * 그래서 raw 안에서 φ₀ 기울임을 되돌려 원래 위도·경도차를 얻고 메르카토르를 셉니다.
 *
 * 두 투영의 한가운데 축척을 맞춥니다. 메르카토르는 φ₀ 에서 1 라디안(경도) = 1/cos φ₀ 이라 cos φ₀ 를 곱해
 * 1 로 맞춥니다. 그러면 반지름 R 의 구와 폭 W 의 타일 지도가 `globeRadiusForDelta` 하나로 같은 축척입니다.
 *
 * t = 0 이면 타일과 똑같은 메르카토르, t = 1 이면 정사영 구. 그 사이는 점마다 두 화면 자리를 섞습니다.
 */

const MAX_MERC_LAT = 85 * Math.PI / 180;

/**
 * 형태가 메르카토르를 조금이라도 품은 동안의 보이는 테두리(한가운데에서의 각, 도).
 *
 * 메르카토르는 극 너머를 그릴 수 없습니다 — 극 너머 점은 경도차가 ±180° 에서 끊겨, 극을 품은 다각형(밤 그늘·
 * 북극해 땅)과 구의 테두리가 화면을 가로지르는 곧은 띠로 칠해졌습니다. 그래서 형태 < 1 이면 테두리를 극 바로 앞
 * (90° − |φ₀|)에서 자릅니다. `MORPH_HI_DEG` 를 극이 화면 밖에 있는 폭 아래로 두어 이 테두리가 화면에 안 보입니다.
 */
export const morphClipAngle = (morph: number, phi0Deg: number) =>
  morph >= 1 ? 90 : Math.max(1, Math.min(90, 89.5 - Math.abs(phi0Deg)));

export type RawProjection = ((lambda: number, phi: number) => [number, number]) & {
  invert?: (x: number, y: number) => [number, number];
};

export const morphRaw = (t: number, phi0Deg: number): RawProjection => {
  const p0 = phi0Deg * Math.PI / 180;
  const c0 = Math.cos(p0);
  const s0 = Math.sin(p0);
  const m0 = Math.log(Math.tan(Math.PI / 4 + Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, p0)) / 2));
  const k = Math.max(0.1, c0);

  const forward = ((lp: number, pp: number): [number, number] => {
    const cp = Math.cos(pp);
    const X = cp * Math.cos(lp);
    const Y = cp * Math.sin(lp);
    const Z = Math.sin(pp);
    // 정사영(돌린 좌표 그대로)
    const xo = Y;
    const yo = Z;
    if (t >= 1) return [xo, yo];
    // 기울임을 되돌린 원래 좌표
    const x = X * c0 - Z * s0;
    const z = X * s0 + Z * c0;
    const phi = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, Math.asin(Math.max(-1, Math.min(1, z)))));
    const dl = Math.atan2(Y, x);
    const xm = k * dl;
    const ym = k * (Math.log(Math.tan(Math.PI / 4 + phi / 2)) - m0);
    if (t <= 0) return [xm, ym];
    return [(1 - t) * xm + t * xo, (1 - t) * ym + t * yo];
  }) as RawProjection;

  /** 메르카토르 화면 자리 → 돌린 좌표(λ', φ'). */
  const mercInverse = (xm: number, ym: number): [number, number] => {
    const dl = xm / k;
    const phi = 2 * Math.atan(Math.exp(ym / k + m0)) - Math.PI / 2;
    const x = Math.cos(phi) * Math.cos(dl);
    const Y = Math.cos(phi) * Math.sin(dl);
    const z = Math.sin(phi);
    const X = x * c0 + z * s0;
    const Z = -x * s0 + z * c0;
    return [Math.atan2(Y, X), Math.asin(Math.max(-1, Math.min(1, Z)))];
  };
  const orthoInverse = (x: number, y: number): [number, number] => {
    const r = Math.hypot(x, y);
    if (r > 1) { x /= r; y /= r; }
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    return [Math.atan2(x, z), Math.asin(Math.max(-1, Math.min(1, y)))];
  };

  /** 섞인 투영의 역 — 가까운 쪽 역으로 시작해 뉴턴법으로 다듬습니다(길게 눌러 고르기용). */
  forward.invert = (x: number, y: number): [number, number] => {
    if (t >= 1) return orthoInverse(x, y);
    if (t <= 0) return mercInverse(x, y);
    let [l, p] = t < 0.5 ? mercInverse(x, y) : orthoInverse(x, y);
    const h = 1e-6;
    for (let i = 0; i < 12; i++) {
      const [fx, fy] = forward(l, p);
      const ex = fx - x, ey = fy - y;
      if (ex * ex + ey * ey < 1e-14) break;
      const [ax, ay] = forward(l + h, p);
      const [bx, by] = forward(l, p + h);
      const j11 = (ax - fx) / h, j21 = (ay - fy) / h, j12 = (bx - fx) / h, j22 = (by - fy) / h;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-12) break;
      l -= (j22 * ex - j12 * ey) / det;
      p -= (-j21 * ex + j11 * ey) / det;
      p = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p));
    }
    return [l, p];
  };
  return forward;
};
