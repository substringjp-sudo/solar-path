/*
 * tsunfix.c — §179 WP1 T_sun 빈틈 법칙 고정표(fixture)의 C 핵. 앱 종류 타일(makeGenusWeather 바이트)을 렌더러 밀도식으로
 * 다시 세워(CPU 복제) 수평 직선마다 투과율을 무차별로 적분합니다. 표 꾸리기(build-fixture.mjs)와 단위 시험(fixture-test.mjs)이
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
 * 칸(cell) = (타일, mip, 문턱 s, 종류 단면, hf, 방위 φ, 씨앗). 방위 φ 는 북에서 시계 방향, 선 방향 = (sin φ, cos φ) (동, 북).
 * 선 rows 개를 φ 에 수직으로 층화(행 i 의 수직 오프셋 = (i + u)/rows × 타일 길이; LATTICE 1 이면 u 는 칸마다 하나, 0 이면 행마다)하고, 선마다 시작점 startRange km 를 startStep 간격으로
 * 잡아 그 시작에서 L 만큼의 창 투과율 T = exp(−∫σ) 를 평균합니다(접두합 C, 표본 중점 규칙 ds, 소수 위치는 칸 안 선형 = 조각 상수 σ 에 정확).
 * 같은 시작 집합을 모든 L 에 쓰므로 −ln⟨T(L)⟩ 는 L 에 대해 단조입니다.
 * 구름 안 시작(σ ≥ 0.1 /km = takram minExtinction 1e−4 /m): σ 가중 조건부 ⟨T(r, r+L)⟩ — 화면에 그 표본이 기여하는 비중(σ)으로 가중 [decision, §179].
 * 맑은 시작(σ < 0.1 /km): 자유 경로 P(τ(0,l) < 0.105) (U1a).
 *
 * 사용: tsunfix <tiles.bin> <shape.bin> <plan.txt> <out.f64>
 *   plan.txt: GRID nL L… / REACH nR r… / CONDL nCL idx… / FREE nF l… / LATTICE 0|1 / PARAM S tileKm ds rows startStep startRange lat lon / CELLS n /
 *             (칸마다 한 줄) tile mip macroS mode base top edge densityScale shapeAmount profLin profConst hf phiDeg seed
 *   out.f64: 칸마다 float64 기록 [nStarts, ⟨T(L)⟩×nL, Σw, nIn, Σw·T(r,r+L)×(nR·nCL), nClear, nClearOk(l)×nF, ⟨σ⟩, 구름 안 비율]
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

static unsigned char SHAPE[SH * SH * SH];
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

/* 평면 (동, 북) km → 타일 이중선형(RepeatWrapping) */
static inline double tile_bil(double ex, double ny) {
  const int n = CUR_SM;
  double u = ex / TILE_KM * n - 0.5, v = ny / TILE_KM * n - 0.5;
  double fu = floor(u), fv = floor(v);
  long i0 = (long)fu, j0 = (long)fv;
  double a = u - fu, b = v - fv;
  int x0 = wrapi(i0, n), x1 = wrapi(i0 + 1, n), y0 = wrapi(j0, n), y1 = wrapi(j0 + 1, n);
  double p = TILE_F[y0 * n + x0] * (1 - a) + TILE_F[y0 * n + x1] * a;
  double q = TILE_F[y1 * n + x0] * (1 - a) + TILE_F[y1 * n + x1] * a;
  return p * (1 - b) + q * b;
}

/* 모양 텍스처 삼선형(텍스처 단위 좌표, 주기 1) */
static inline double shape_tri(double u, double v, double w) {
  double x = u * SH - 0.5, y = v * SH - 0.5, z = w * SH - 0.5;
  double fx = floor(x), fy = floor(y), fz = floor(z);
  long ix = (long)fx, iy = (long)fy, iz = (long)fz;
  double ax = x - fx, ay = y - fy, az = z - fz;
  int x0 = wrapi(ix, SH), x1 = wrapi(ix + 1, SH), y0 = wrapi(iy, SH), y1 = wrapi(iy + 1, SH), z0 = wrapi(iz, SH), z1 = wrapi(iz + 1, SH);
#define SV(xx, yy, zz) ((double)SHAPE[((zz) * SH + (yy)) * SH + (xx)])
  double c00 = SV(x0, y0, z0) * (1 - ax) + SV(x1, y0, z0) * ax;
  double c10 = SV(x0, y1, z0) * (1 - ax) + SV(x1, y1, z0) * ax;
  double c01 = SV(x0, y0, z1) * (1 - ax) + SV(x1, y0, z1) * ax;
  double c11 = SV(x0, y1, z1) * (1 - ax) + SV(x1, y1, z1) * ax;
#undef SV
  double c0 = c00 * (1 - ay) + c10 * ay, c1 = c01 * (1 - ay) + c11 * ay;
  return (c0 * (1 - az) + c1 * az) / 255.0;
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
  const int nS = (int)ceil((startRange + span) / ds) + 2;
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
  const int recLen = 1 + nL + 2 + nR * nCL + 1 + nF + 2;
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
    const double dx = sin(pr), dy = cos(pr), px = cos(pr), py = -sin(pr);
    double sumT[MAXL] = { 0 }, sumWT[MAXR * MAXL] = { 0 }, okF[MAXL] = { 0 };
    double sumW = 0, nIn = 0, nClear = 0, sigSum = 0, inCnt = 0;
    long nStarts = 0, nSamp = 0;
    uint64_t rs = seed;
    const double shift = urand(&rs);
    for (int li = 0; li < rows; li++) {
      const double off = (li + (lattice ? shift : urand(&rs))) / rows * TILE_KM;
      const double t0 = urand(&rs) * TILE_KM;
      const double so[3] = { urand(&rs), urand(&rs), urand(&rs) };
      C[0] = 0;
      for (int k = 0; k < nS; k++) {
        const double t = t0 + (k + 0.5) * ds;
        const double ex = off * px + t * dx, ny = off * py + t * dy;
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
      for (int a = 0; a < nStartsLine; a++) {
        const int k0 = a * stride;
        const double s0 = k0 * ds;
        const double c0 = C[k0];
        for (int i = 0; i < nL; i++) sumT[i] += exp(-(CAT(s0 + L[i]) - c0));
        const double sg0 = SG[k0];
        if (sg0 >= 0.1) {
          inCnt += 1;
          sumW += sg0; nIn += 1;
          for (int r = 0; r < nR; r++) {
            const double cr = CAT(s0 + R[r]);
            for (int c = 0; c < nCL; c++) sumWT[r * nCL + c] += sg0 * exp(-(CAT(s0 + R[r] + L[CL[c]]) - cr));
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
