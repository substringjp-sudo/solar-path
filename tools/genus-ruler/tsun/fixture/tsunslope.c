/*
 * tsunslope.c — §179 검토 반영(물리 6, 2026-10-29) U1g: 성장 곡선(LP3 법칙 G(Λ; c, hf))을 **기운 직선**에서 무차별로 잽니다.
 * U1b·U1e 는 수평선(고정 hf)만, U2a·U2c·U2g 는 같은 법칙의 구적과 비교 — 층을 비스듬히 가로지르는 선(아틀라스가 실제로 쓰는 것)에서
 * λ(hf) 가 '어느 칸이 어느 높이까지 닿는지'로 정해지는 실제 밀도와 법칙이 맞는지는 렌더 전에는 잰 적이 없었음.
 *
 * 같은 밀도 복제: tsunfix.c 를 그대로 #include(main 만 이름을 바꿔 쓰지 않음) — 타일 읽기(tile_bil)·모양 잡음(shape_tri)·smoothstep·씨앗(sm64)이
 * 바이트 같은 코드. 밀도식은 tsunfix.c main 의 칸 함수와 같은 줄을 아래 sigma_at 에 옮김(hf 가 표본마다 바뀌는 것만 다름 — hs·문턱·sigK 를 표본마다).
 * 고정표 핵(tsunfix.c)은 고치지 않음 — 표의 칸 캐시 열쇠(실행 파일 sha)와 U1c(두 번 만든 표 바이트 같음)가 그대로.
 *
 * 선: 관측 기둥(평면 0, 0)에서 시작 높이 h0 = hb + hf0·(ht − hb), 방위 φ(북에서 시계 = 해 쪽), 국소 고도 e. 평면 자리 = 시작 + s·cos e·(sin φ, cos φ)
 * (종류 평면 틀 = 시작 기둥의 접평면 — 렌더러 getGlobeUv 와 같은 투영), 높이 h(s) = √((R + h0)² + 2(R + h0)·s·sin e + s²) − R(구면, R 6360 km).
 * 선이 [hb, ht] 를 벗어나면(e > 0 이면 위로 나감 — 다시 안 들어옴) 끝. 시작점 = 타일 위 R2 점 × 선을 따라 startStep 간격 starts 개(tsunfix 와 같은 점 집합 규칙).
 * 기록: 칸마다 [선 수, ⟨T⟩ = ⟨exp(−∫σ ds)⟩, ⟨τ⟩, ⟨층 안 길이 km⟩, 구름 안 시작 비율] — float64.
 *
 * 사용: tsunslope <tiles.bin> <shape.bin> <plan.txt> <out.f64>
 *   plan.txt: SLOPE S tileKm ds rows starts startStep lat lon / CELLS n /
 *             (칸마다) tile mip macroS mode base top edge densityScale shapeAmount profLin profConst hf0 phiDeg eDeg hbKm htKm seed
 * 단일 스레드·고정 난수 — 같은 입력이면 같은 바이트.
 */
#define main tsunfix_main_unused
#include "tsunfix.c"
#undef main

/* tsunfix.c main 의 칸 함수와 같은 밀도식(1/km) — 높이 비율 hf 를 표본마다 받음. */
static double sigma_at(double ex, double ny, double hf, int mode, double base, double top, double edge, double dens, double sa, double pLin, double pConst,
                       double macroS, const double *so, const double *E, const double *N) {
  if (!(hf >= 0.0 && hf <= 1.0)) return 0.0;
  double hs;
  if (mode == 0) hs = smoothstep(0.0, base > 1e-4 ? base : 1e-4, hf) * pow(fmax(1 - hf, 1e-6), top);
  else hs = 1 - pow(fmax(fabs(hf * 2 - 1), 1e-6), fmax(top, 1e-3));
  const double thr = 1 - hs;
  double lw = tile_bil(ex, ny);
  if (macroS >= 0) { lw = (lw - macroS) / fmax(1 - macroS, 1e-3); lw = lw < 0 ? 0 : lw > 1 ? 1 : lw; }
  if (lw < 1.0 / 512.0) return 0.0;
  double gd = (lw - thr) * edge;
  gd = gd < 0 ? 0 : gd > 1 ? 1 : gd;
  if (gd <= 0) return 0.0;
  double d = gd;
  if (sa > 0) {
    const double SHAPE_REPEAT = 3e-4;
    const double xm = ex * 1000, ym = ny * 1000;
    const double sh = shape_tri((xm * E[0] + ym * N[0]) * SHAPE_REPEAT + so[0], (xm * E[1] + ym * N[1]) * SHAPE_REPEAT + so[1], (xm * E[2] + ym * N[2]) * SHAPE_REPEAT + so[2]);
    const double lo2 = (1 - sh) * sa;
    d = (gd - lo2) / fmax(1 - lo2, 1e-6);
    d = d < 0 ? 0 : d > 1 ? 1 : d;
  }
  double sg = d * dens * (pLin * hf + pConst);
  if (sg > 1) sg = 1;
  return sg * 1000.0;
}

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: tsunslope tiles.bin shape.bin plan.txt out.f64\n"); return 2; }
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
  int rows = 256, starts = 16;
  double ds = 0.05, startStep = 3.0, lat = 34.97342, lon = 138.77713;
  long nCells = 0;
  while (fscanf(pl, "%31s", key) == 1) {
    if (!strcmp(key, "SLOPE")) {
      if (fscanf(pl, "%d %lf %lf %d %d %lf %lf %lf", &S_TILE, &TILE_KM, &ds, &rows, &starts, &startStep, &lat, &lon) != 8) return 4;
    } else if (!strcmp(key, "CELLS")) { if (fscanf(pl, "%ld", &nCells) != 1) return 4; break; }
    else { fprintf(stderr, "plan key %s\n", key); return 4; }
  }
  if (S_TILE & (S_TILE - 1)) { fprintf(stderr, "S must be a power of two\n"); return 2; }
  const double la = lat * M_PI / 180, lo = lon * M_PI / 180;
  const double E[3] = { -sin(lo), cos(lo), 0 };
  const double N[3] = { -sin(la) * cos(lo), -sin(la) * sin(lo), cos(la) };
  const double R = 6360.0;
  FILE *out = fopen(argv[4], "wb");
  if (!out) { perror("out"); return 2; }
  for (long ci = 0; ci < nCells; ci++) {
    int tile, mip, mode;
    double macroS, base, top, edge, dens, sa, pLin, pConst, hf0, phi, eDeg, hb, ht;
    unsigned long long seed;
    if (fscanf(pl, "%d %d %lf %d %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %llu", &tile, &mip, &macroS, &mode, &base, &top, &edge, &dens, &sa, &pLin, &pConst,
               &hf0, &phi, &eDeg, &hb, &ht, &seed) != 17) { fprintf(stderr, "cell %ld parse\n", ci); return 4; }
    load_tile(tile, mip);
    const double pr = phi * M_PI / 180, er = eDeg * M_PI / 180;
    const double dx = sin(pr), dy = cos(pr), ce = cos(er), se = sin(er);
    const double H = ht - hb, h0 = hb + hf0 * H, r0 = R + h0;
    uint64_t rs = seed;
    const double shiftU = urand(&rs), shiftV = urand(&rs);
    double sumT = 0, sumTau = 0, sumLen = 0, nIn = 0, nLines = 0;
    for (int li = 0; li < rows; li++) {
      double fx = li * 0.75487766624669276005 + shiftU, fy = li * 0.56984029099805326591 + shiftV;   // R2 점 집합(tsunfix LATTICE 2)
      fx -= floor(fx); fy -= floor(fy);
      const double so[3] = { urand(&rs), urand(&rs), urand(&rs) };
      for (int a = 0; a < starts; a++) {
        const double x0 = fx * TILE_KM + a * startStep * dx, y0 = fy * TILE_KM + a * startStep * dy;
        double tau = 0, len = 0;
        if (sigma_at(x0, y0, hf0, mode, base, top, edge, dens, sa, pLin, pConst, macroS, so, E, N) >= 0.1) nIn += 1;
        for (int k = 0; k < 200000; k++) {
          const double s = (k + 0.5) * ds;
          const double h = sqrt(r0 * r0 + 2 * r0 * s * se + s * s) - R;
          if (h > ht || h < hb) break;   // e > 0: 위로 나가면 끝(다시 안 들어옴) · e < 0 의 밑면도 끝(이 시험은 e > 0 만)
          const double hf = (h - hb) / H;
          tau += sigma_at(x0 + s * ce * dx, y0 + s * ce * dy, hf, mode, base, top, edge, dens, sa, pLin, pConst, macroS, so, E, N) * ds;
          len += ds;
        }
        sumT += exp(-tau); sumTau += tau; sumLen += len; nLines += 1;
      }
    }
    double rec[5] = { nLines, sumT / nLines, sumTau / nLines, sumLen / nLines, nIn / nLines };
    fwrite(rec, sizeof(double), 5, out);
  }
  fclose(out);
  fclose(pl);
  return 0;
}
