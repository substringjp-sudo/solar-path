/*
 * tsunfix.c — §179 WP1 T_sun 빈틈 법칙 고정표(fixture)의 C 핵. 앱 종류 타일(makeGenusWeather 바이트)을 렌더러 밀도식으로
 * 다시 세워(CPU 복제) 수평 직선마다 투과율을 무차별로 적분합니다. 표 꾸리기(fixture-build.mjs)와 단위 시험(fixture-test.mjs)이
 * 같은 칸 함수를 씁니다 — 두 쪽 결과가 같은 코드에서 나와야 U1b 의 "법칙 대 무차별" 비교가 표 보간·표본만 재게 됩니다.
 *
 * 밀도식(렌더러와 같은 순서 — takram shared.js sampleWeather/sampleMedia + cloudGenus.patchGenusShader, quality low = 모양 세부 없음):
 *   lw  = 타일 채널 이중선형(RepeatWrapping, 텍셀 중심 (i+0.5)/S), mip 1 은 2×2 상자 평균(바이트 반올림) 뒤 이중선형 [estimate: GPU 밉 = 상자]
 *   (거시 문턱 보고 행만) lw = clamp((lw − s)/max(1 − s, 1e−3), 0, 1)      — macroShader.ts 와 같은 식
 *   hs  = mode 0: smoothstep(0, max(base,1e−4), hf)·max(1−hf,1e−6)^top · mode 1: 1 − max(|2hf−1|,1e−6)^max(top,1e−3)
 *   gd  = clamp((lw − (1 − hs))·edge, 0, 1)·step(1/512, lw)
 *   d   = remapClamped(gd, (1 − shape)·shapeAmount, 1)                   — shape = takram shape.bin 삼선형(앱의 절차 CloudShape 와 같다고 둠 [estimate])
 *   σ   = min(d·densityScale·(lin·hf + const), 1) [1/m] → ×1000 [1/km]
 * 모양 잡음 좌표 = ECEF 위치 × 3e−4(shapeRepeat 기본) + 오프셋: 관측점(위·경도)의 동·북 단위벡터로 평면 km 를 ECEF m 로 돌리고, 높이·시간 진화
 * (evolution)·shapeOffset 은 선마다 고른 3D 난수 오프셋으로 대신합니다(수평선 위에서 상수).
 *
 * 칸(cell) = (타일, mip, 문턱 s, 종류 단면, hf, 방위 φ, 씨앗). 방위 φ 는 북에서 시계 방향, 선 방향 = (sin φ, cos φ) (동, 북) = 해 쪽.
 * 선 rows 개의 출발점은 타일 위 2D 점 집합 × 타일 길이 — §179 고침: 처음 판은 φ 에 수직인 오프셋 [0, 24 km) 를 층화했는데, 닫힘이 짧은
 * 유리 방향(45° 는 33.9 km 마다 닫혀 수직 주기 17 km)에서 일부 선 묶음을 두 번 세어 45° 와 225° 의 τ(10 km) 가 4.47 대 3.89 로 갈렸음
 * [measured, 행 1024]. 타일(기본 영역) 위 고른 점을 지나는 선은 어느 방향에서나 선 묶음을 고르게 뽑습니다.
 *   LATTICE 2 (기본): R2 수열 (frac(i·a₁ + u), frac(i·a₂ + v)), (u, v) 칸마다 하나 — 방향에 맞물리는 짧은 격자 벡터가 없음.
 *   LATTICE 1: 황금비 계수 1 격자 ((i + u)/rows, frac(i·g + v)) — 행 수에 따라 공명: sc c 0.417 hf 0.37 φ 264.85° L 14 km 의 씨앗 간
 *              ln⟨T⟩ 표준편차가 행 128·160·384 에서 0.09~0.13, 192·256 에서 0.44~0.50 [measured, 씨앗 16]. R2 는 행 256 에서 여섯 칸 모두
 *              ≤ 0.08, 행 1024 에서 ≤ 0.05 [measured, 씨앗 12] → 표·시험 기준 모두 R2.
 *   LATTICE 3: 흔든 2D 격자, 0: 행마다 고른 난수(비교용).
 * 선마다 시작점 startRange km 를 startStep 간격으로 잡아 그 시작에서 L 만큼의 창 투과율 T = exp(−∫σ) 를 평균합니다(접두합 C, 표본 중점
 * 규칙 ds, 소수 위치는 칸 안 선형 = 조각 상수 σ 에 정확). 같은 시작 집합을 모든 L 에 쓰므로 −ln⟨T(L)⟩ 는 L 에 대해 단조입니다.
 * 무조건 창은 방향을 뒤집어도 같은 창 모집단이라 φ 와 φ + 180° 가 같습니다(표는 mod 180).
 * 구름 안 시작(σ ≥ 0.1 /km = takram minExtinction 1e−4 /m): σ 가중 조건부 ⟨T(r, r+L)⟩ — 화면에 그 표본이 기여하는 비중(σ)으로 가중
 * [decision, §179]. 이것은 뒤집기 대칭이 **아님**(sc c 0.417 hf 0.37, 도달 1.1 km·L 10 km: 88.97° 오프셋 0.04~0.09 대 268.97° 0.45~0.53
 * [measured, 행 1024 씨앗 둘]) — 그래서 같은 선에서 앞(φ)과 뒤(φ + 180°) 창을 함께 적분합니다. 시작 표본 칸 [s0, s0 + ds] 를 두 방향이
 * 같이 쓰도록 뒤 창은 칸의 다른 끝 s0 + ds 에서 거꾸로 잽니다(무게 Σw 공유). 뒤 창을 위해 선 앞쪽에 여유(도달 + L 의 최대)를 더 표본합니다.
 * 맑은 시작(σ < 0.1 /km): 자유 경로 P(τ(0,l) < 0.105) (U1a).
 *
 * 사용: tsunfix <tiles.bin> <shape.bin> <plan.txt> <out.f64>
 *   plan.txt: GRID nL L… / REACH nR r… / CONDL nCL idx… / FREE nF l… / LATTICE 0|1 / PARAM S tileKm ds rows startStep startRange lat lon / CELLS n /
 *             (칸마다 한 줄) tile mip macroS mode base top edge densityScale shapeAmount profLin profConst hf phiDeg seed
 *   out.f64: 칸마다 float64 기록 [nStarts, ⟨T(L)⟩×nL, Σw, nIn, Σw·T(r,r+L)×(nR·nCL) 앞(φ), 같은 것 뒤(φ+180°), nClear, nClearOk(l)×nF, ⟨σ⟩, 구름 안 비율]
 * 단일 스레드·고정 난수(splitmix64) — 같은 입력이면 같은 바이트(U1c).
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXL 32
#define MAXR 16
#define SH 128

static unsigned char SHAPE[SH * SH * SH]; // u8 그대로(2 MB — float 8 MB 보다 캐시에 잘 맞음)
static unsigned char *TILES = NULL;
static long TILES_LEN = 0;
static float TILE_F[256 * 256];
static int CUR_TILE = -1, CUR_MIP = -1, CUR_SM = 0;

static uint64_t sm64(uint64_t *s) {
  uint64_t z = (*s += 0x9E3779B97F4A7C15ull);
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
  return z ^ (z >> 31);
}
static double urand(uint64_t *s) { return (double)(sm64(s) >> 11) * (1.0 / 9007199254740992.0); }

static int S_TILE = 256;
static double TILE_KM = 24.0;

static void load_tile(int idx, int mip) {
  if (idx == CUR_TILE && mip == CUR_MIP) return;
  const unsigned char *t = TILES + (long)idx * S_TILE * S_TILE;
  if ((long)(idx + 1) * S_TILE * S_TILE > TILES_LEN) { fprintf(stderr, "tile %d out of range\n", idx); exit(3); }
  if (mip == 0) {
    CUR_SM = S_TILE;
    for (int i = 0; i < S_TILE * S_TILE; i++) TILE_F[i] = (float)(t[i] / 255.0);
  } else {
    // mip 1: 2×2 상자 평균, 바이트로 반올림(RGBA8 밉 저장) [estimate: 드라이버 generateMipmap = 상자]
    int s = S_TILE / 2;
    CUR_SM = s;
    for (int y = 0; y < s; y++)
      for (int x = 0; x < s; x++) {
        int a = t[(2 * y) * S_TILE + 2 * x], b = t[(2 * y) * S_TILE + 2 * x + 1];
        int c = t[(2 * y + 1) * S_TILE + 2 * x], d = t[(2 * y + 1) * S_TILE + 2 * x + 1];
        TILE_F[y * s + x] = (float)(((a + b + c + d + 2) >> 2) / 255.0);
      }
  }
  CUR_TILE = idx; CUR_MIP = mip;
}

/* n 은 2 의 거듭제곱(타일 256·128, 모양 128) — 2 의 보수 & 로 음수도 바르게 감습니다 */
static inline int wrapi(long i, int n) { return (int)(i & (long)(n - 1)); }
/* floor(): x86-64 기본(SSE2)에는 roundsd 가 없어 libm 호출이 됨 — 정수 자르기로 같은 값(|x| < 2^52) */
static inline long ifloor(double x) { long i = (long)x; return i - (x < (double)i); }

/* 평면 (동, 북) km → 타일 이중선형(RepeatWrapping) */
static inline double tile_bil(double ex, double ny) {
  const int n = CUR_SM;
  double u = ex / TILE_KM * n - 0.5, v = ny / TILE_KM * n - 0.5;
  long i0 = ifloor(u), j0 = ifloor(v);
  double a = u - (double)i0, b = v - (double)j0;
  int x0 = wrapi(i0, n), x1 = wrapi(i0 + 1, n), y0 = wrapi(j0, n), y1 = wrapi(j0 + 1, n);
  double p = TILE_F[y0 * n + x0] * (1 - a) + TILE_F[y0 * n + x1] * a;
  double q = TILE_F[y1 * n + x0] * (1 - a) + TILE_F[y1 * n + x1] * a;
  return p * (1 - b) + q * b;
}

/* 모양 텍스처 삼선형(텍스처 단위 좌표, 주기 1) */
static inline double shape_tri(double u, double v, double w) {
  double x = u * SH - 0.5, y = v * SH - 0.5, z = w * SH - 0.5;
  long ix = ifloor(x), iy = ifloor(y), iz = ifloor(z);
  double ax = x - (double)ix, ay = y - (double)iy, az = z - (double)iz;
  int x0 = wrapi(ix, SH), x1 = wrapi(ix + 1, SH), y0 = wrapi(iy, SH), y1 = wrapi(iy + 1, SH), z0 = wrapi(iz, SH), z1 = wrapi(iz + 1, SH);
#define SV(xx, yy, zz) ((double)SHAPE[((zz) * SH + (yy)) * SH + (xx)])
  double c00 = SV(x0, y0, z0) * (1 - ax) + SV(x1, y0, z0) * ax;
  double c10 = SV(x0, y1, z0) * (1 - ax) + SV(x1, y1, z0) * ax;
  double c01 = SV(x0, y0, z1) * (1 - ax) + SV(x1, y0, z1) * ax;
  double c11 = SV(x0, y1, z1) * (1 - ax) + SV(x1, y1, z1) * ax;
#undef SV
  double c0 = c00 * (1 - ay) + c10 * ay, c1 = c01 * (1 - ay) + c11 * ay;
  return (c0 * (1 - az) + c1 * az) * (1.0 / 255.0);
}

static double smoothstep(double e0, double e1, double x) {
  double t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: tsunfix tiles.bin shape.bin plan.txt out.f64\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("tiles"); return 2; }
  fseek(f, 0, SEEK_END); TILES_LEN = ftell(f); fseek(f, 0, SEEK_SET);
  TILES = malloc(TILES_LEN);
  if (fread(TILES, 1, TILES_LEN, f) != (size_t)TILES_LEN) { fprintf(stderr, "tiles read\n"); return 2; }
  fclose(f);
  f = fopen(argv[2], "rb");
  if (!f || fread(SHAPE, 1, sizeof SHAPE, f) != sizeof SHAPE) { fprintf(stderr, "shape read\n"); return 2; }
  fclose(f);
  FILE *pl = fopen(argv[3], "r");
  if (!pl) { perror("plan"); return 2; }
  char key[32];
  int nL = 0, nR = 0, nCL = 0, nF = 0, rows = 64;
  double L[MAXL], R[MAXR], FL[MAXL];
  int CL[MAXL];
  double ds = 0.05, startStep = 0.2, startRange = 24.0, lat = 34.97342, lon = 138.77713;
  long nCells = 0;
  int lattice = 0; // 1 = 행 오프셋을 격자(한 칸의 공통 난수 이동) — 0 = 행마다 지터
  while (fscanf(pl, "%31s", key) == 1) {
    if (!strcmp(key, "GRID")) { if (fscanf(pl, "%d", &nL) != 1) return 4; for (int i = 0; i < nL; i++) if (fscanf(pl, "%lf", &L[i]) != 1) return 4; }
    else if (!strcmp(key, "REACH")) { if (fscanf(pl, "%d", &nR) != 1) return 4; for (int i = 0; i < nR; i++) if (fscanf(pl, "%lf", &R[i]) != 1) return 4; }
    else if (!strcmp(key, "CONDL")) { if (fscanf(pl, "%d", &nCL) != 1) return 4; for (int i = 0; i < nCL; i++) if (fscanf(pl, "%d", &CL[i]) != 1) return 4; }
    else if (!strcmp(key, "FREE")) { if (fscanf(pl, "%d", &nF) != 1) return 4; for (int i = 0; i < nF; i++) if (fscanf(pl, "%lf", &FL[i]) != 1) return 4; }
    else if (!strcmp(key, "LATTICE")) { if (fscanf(pl, "%d", &lattice) != 1) return 4; }
    else if (!strcmp(key, "PARAM")) {
      if (fscanf(pl, "%d %lf %lf %d %lf %lf %lf %lf", &S_TILE, &TILE_KM, &ds, &rows, &startStep, &startRange, &lat, &lon) != 8) return 4;
    } else if (!strcmp(key, "CELLS")) { if (fscanf(pl, "%ld", &nCells) != 1) return 4; break; }
    else { fprintf(stderr, "plan key %s\n", key); return 4; }
  }
  if (S_TILE & (S_TILE - 1)) { fprintf(stderr, "S must be a power of two\n"); return 2; }
  // 창 최대 길이
  double span = 0;
  for (int i = 0; i < nL; i++) if (L[i] > span) span = L[i];
  for (int r = 0; r < nR; r++) for (int c = 0; c < nCL; c++) if (R[r] + L[CL[c]] > span) span = R[r] + L[CL[c]];
  for (int i = 0; i < nF; i++) if (FL[i] > span) span = FL[i];
  // 뒤 창 여유: 시작 칸 끝 s0 + ds 에서 거꾸로 r + L 까지
  double back = 0;
  for (int r = 0; r < nR; r++) for (int c = 0; c < nCL; c++) if (R[r] + L[CL[c]] > back) back = R[r] + L[CL[c]];
  const int kb = (int)ceil(back / ds) + 1;
  const int nS = kb + (int)ceil((startRange + span) / ds) + 2;
  const int stride = (int)llround(startStep / ds);
  const double invDs = 1.0 / ds;
  const int nStartsLine = (int)llround(startRange / startStep);
  double *C = malloc(sizeof(double) * (nS + 1));
  float *SG = malloc(sizeof(float) * nS);
  // 관측점 동·북 단위벡터(ECEF) — 모양 잡음 좌표의 방향
  const double la = lat * M_PI / 180, lo = lon * M_PI / 180;
  const double E[3] = { -sin(lo), cos(lo), 0 };
  const double N[3] = { -sin(la) * cos(lo), -sin(la) * sin(lo), cos(la) };
  const double SHAPE_REPEAT = 3e-4; // takram CloudsEffect.shapeRepeat 기본(1/m)
  const int recLen = 1 + nL + 2 + 2 * nR * nCL + 1 + nF + 2;
  double *rec = malloc(sizeof(double) * recLen);
  FILE *out = fopen(argv[4], "wb");
  if (!out) { perror("out"); return 2; }
  for (long ci = 0; ci < nCells; ci++) {
    int tile, mip, mode;
    double macroS, base, top, edge, dens, sa, pLin, pConst, hf, phi;
    unsigned long long seed;
    if (fscanf(pl, "%d %d %lf %d %lf %lf %lf %lf %lf %lf %lf %lf %lf %llu", &tile, &mip, &macroS, &mode, &base, &top, &edge, &dens, &sa, &pLin, &pConst, &hf, &phi, &seed) != 14) {
      fprintf(stderr, "cell %ld parse\n", ci); return 4;
    }
    load_tile(tile, mip);
    double hs;
    if (mode == 0) hs = smoothstep(0.0, base > 1e-4 ? base : 1e-4, hf) * pow(fmax(1 - hf, 1e-6), top);
    else hs = 1 - pow(fmax(fabs(hf * 2 - 1), 1e-6), fmax(top, 1e-3));
    const double thr = 1 - hs;
    const double sigK = dens * (pLin * hf + pConst); // 1/m 단위 계수(σ = min(d·sigK, 1))
    const double pr = phi * M_PI / 180;
    const double dx = sin(pr), dy = cos(pr);
    const double GOLD = 0.61803398874989484820; // 계수 1 격자의 둘째 축 생성자
    double sumT[MAXL] = { 0 }, sumWT[MAXR * MAXL] = { 0 }, sumWTb[MAXR * MAXL] = { 0 }, okF[MAXL] = { 0 };
    double sumW = 0, nIn = 0, nClear = 0, sigSum = 0, inCnt = 0;
    long nStarts = 0, nSamp = 0;
    uint64_t rs = seed;
    const double shiftU = urand(&rs), shiftV = urand(&rs);
    int gridN = 1;
    while ((gridN + 1) * (gridN + 1) <= rows) gridN++;
    for (int li = 0; li < rows; li++) {
      double fx, fy;
      if (lattice == 2) { // R2 수열(Roberts 2018, 플라스틱 수) — 방향에 따른 짧은 격자 벡터가 없음
        fx = li * 0.75487766624669276005 + shiftU; fy = li * 0.56984029099805326591 + shiftV;
      } else if (lattice == 3) { // 흔든 2D 격자(gridN² 칸, 남는 행은 고른 난수)
        if (li < gridN * gridN) { fx = (li % gridN + urand(&rs)) / gridN; fy = (li / gridN + urand(&rs)) / gridN; }
        else { fx = urand(&rs); fy = urand(&rs); }
      } else {
        const double gu = lattice ? shiftU : urand(&rs), gv = lattice ? shiftV : urand(&rs);
        fx = (li + gu) / rows; fy = li * GOLD + gv;
      }
      fx -= floor(fx); fy -= floor(fy);
      const double x0 = fx * TILE_KM, y0 = fy * TILE_KM;
      const double so[3] = { urand(&rs), urand(&rs), urand(&rs) };
      C[0] = 0;
      for (int k = 0; k < nS; k++) {
        const double t = (k - kb + 0.5) * ds; // 출발점(x0, y0)은 k = kb 칸의 시작
        const double ex = x0 + t * dx, ny = y0 + t * dy;
        double lw = tile_bil(ex, ny);
        if (macroS >= 0) { lw = (lw - macroS) / fmax(1 - macroS, 1e-3); lw = lw < 0 ? 0 : lw > 1 ? 1 : lw; }
        double sg = 0;
        if (lw >= 1.0 / 512.0) {
          double gd = (lw - thr) * edge;
          gd = gd < 0 ? 0 : gd > 1 ? 1 : gd;
          if (gd > 0) {
            double d = gd;
            if (sa > 0) {
              const double xm = ex * 1000, ym = ny * 1000;
              const double sh = shape_tri((xm * E[0] + ym * N[0]) * SHAPE_REPEAT + so[0], (xm * E[1] + ym * N[1]) * SHAPE_REPEAT + so[1],
                                          (xm * E[2] + ym * N[2]) * SHAPE_REPEAT + so[2]);
              const double lo2 = (1 - sh) * sa;
              d = (gd - lo2) / fmax(1 - lo2, 1e-6);
              d = d < 0 ? 0 : d > 1 ? 1 : d;
            }
            sg = d * sigK;
            if (sg > 1) sg = 1;
            sg *= 1000.0;
          }
        }
        SG[k] = (float)sg;
        C[k + 1] = C[k] + sg * ds;
        sigSum += sg; nSamp++;
      }
#define CAT(x) ({ double _q = (x) * invDs; long _i = (long)_q; double _f = _q - _i; C[_i] + _f * (C[_i + 1] - C[_i]); })
      // 창 투과율은 float exp(τ < 87 에서 상대 1e−7 — 평균 T 에 충분). 조건부 창은 시작 넷 중 하나(0.8 km 간격 — 이웃 시작은 같은 구름이라
      // 정보가 겹침; 행 256 이라 조건부 표본 수는 처음 판(행 128, 둘 중 하나)과 같고 선은 두 배)에서 앞·뒤 두 방향(§179 결정).
      for (int a = 0; a < nStartsLine; a++) {
        const int k0 = kb + a * stride;
        const double s0 = k0 * ds;
        const double c0 = C[k0];
        for (int i = 0; i < nL; i++) sumT[i] += expf((float)-(CAT(s0 + L[i]) - c0));
        const double sg0 = SG[k0];
        if (sg0 >= 0.1) {
          inCnt += 1;
          if (a & 3) continue;
          sumW += sg0; nIn += 1;
          const double e0 = s0 + ds; // 뒤 방향의 시작 = 시작 칸의 다른 끝
          for (int r = 0; r < nR; r++) {
            const double cr = CAT(s0 + R[r]), cb = CAT(e0 - R[r]);
            for (int c = 0; c < nCL; c++) {
              sumWT[r * nCL + c] += sg0 * expf((float)-(CAT(s0 + R[r] + L[CL[c]]) - cr));
              sumWTb[r * nCL + c] += sg0 * expf((float)-(cb - CAT(e0 - R[r] - L[CL[c]])));
            }
          }
        } else {
          nClear += 1;
          for (int i = 0; i < nF; i++) if (CAT(s0 + FL[i]) - c0 < 0.105) okF[i] += 1;
        }
        nStarts++;
      }
#undef CAT
    }
    int p = 0;
    rec[p++] = (double)nStarts;
    for (int i = 0; i < nL; i++) rec[p++] = sumT[i] / nStarts;
    rec[p++] = sumW; rec[p++] = nIn;
    for (int i = 0; i < nR * nCL; i++) rec[p++] = sumWT[i];
    for (int i = 0; i < nR * nCL; i++) rec[p++] = sumWTb[i];
    rec[p++] = nClear;
    for (int i = 0; i < nF; i++) rec[p++] = okF[i];
    rec[p++] = sigSum / (double)nSamp;
    rec[p++] = inCnt / (double)nStarts;
    fwrite(rec, sizeof(double), recLen, out);
  }
  fclose(out);
  fclose(pl);
  return 0;
}
