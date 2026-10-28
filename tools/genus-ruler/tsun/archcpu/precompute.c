/*
 * CPU port of the Bruneton (2017) precomputation as run by takram three-atmosphere 0.19.x
 * (src/shaders/bruneton/{common,precompute}.glsl + PrecomputedTexturesGenerator.ts, FloatType path,
 * i.e. no TRANSMITTANCE_PRECISION_LOG), for ONE wavelength triplet, outputs in radiance
 * (luminanceFromRadiance = identity). Spectral (15-lambda) app tables are linear combinations of
 * these per-batch outputs and are assembled in Python.
 *
 * usage: precompute <params.txt> <outdir>
 * params.txt: 15 numbers: solar[3] rayleigh[3] mie_sca[3] mie_ext[3] ozone[3]   (per km)
 * outputs (float32, little endian):
 *   transmittance.f32  [64][256][3]
 *   irradiance.f32     [16][64][3]   (sky only, orders 1..3, as takram)
 *   scattering.f32     [32][128][256][3]  single Rayleigh + sum(multiple / P_R(nu))
 *   mie.f32            [32][128][256][3]  single Mie
 *   higher.f32         [32][128][256][3]  sum over orders 2..4 of multiple / P_R(nu)
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define TW 256
#define TH 64
#define IW 64
#define IH 16
#define R_SIZE 32
#define MU_SIZE 128
#define MU_S_SIZE 32
#define NU_SIZE 8
#define SW (NU_SIZE * MU_S_SIZE)
#define SH MU_SIZE
#define SD R_SIZE
#define NTEX (SW * SH * SD)
#define PI 3.14159265358979323846

static double SOLAR[3], RAY[3], MIES[3], MIEE[3], OZ[3];
static const double BOTTOM = 6360.0, TOP = 6420.0;
static const double MIE_G = 0.8, SUN_ANG = 0.004675, GROUND_ALBEDO = 0.1;
static double MU_S_MIN;

typedef struct { double width, exp_term, exp_scale, linear_term, constant_term; } Layer;
static const Layer RAYL[2] = {{0, 0, 0, 0, 0}, {0, 1, -0.125, 0, 0}};
static const Layer MIEL[2] = {{0, 0, 0, 0, 0}, {0, 1, -0.833333, 0, 0}};
static const Layer OZL[2] = {{25, 0, 0, 1.0 / 15.0, -2.0 / 3.0}, {0, 0, 0, -1.0 / 15.0, 8.0 / 3.0}};

static float *Ttex, *Itex_delta, *Iout, *dR, *dM, *dMS, *dJ, *Sout, *Mout, *Hout;

static double clampd(double x, double a, double b) { return x < a ? a : (x > b ? b : x); }
static double ClampCosine(double mu) { return clampd(mu, -1.0, 1.0); }
static double ClampDistance(double d) { return d > 0 ? d : 0; }
static double ClampRadius(double r) { return clampd(r, BOTTOM, TOP); }
static double SafeSqrt(double a) { return sqrt(a > 0 ? a : 0); }
static double DistTop(double r, double mu) { return ClampDistance(-r * mu + SafeSqrt(r * r * (mu * mu - 1.0) + TOP * TOP)); }
static double DistBottom(double r, double mu) { return ClampDistance(-r * mu - SafeSqrt(r * r * (mu * mu - 1.0) + BOTTOM * BOTTOM)); }
static int RayIntersectsGround(double r, double mu) { return mu < 0.0 && r * r * (mu * mu - 1.0) + BOTTOM * BOTTOM >= 0.0; }
static double CoordFromUnit(double x, int n) { return 0.5 / n + x * (1.0 - 1.0 / n); }
static double UnitFromCoord(double u, int n) { return (u - 0.5 / n) / (1.0 - 1.0 / n); }
static double H_ATM;

/* ---- texture sampling: WebGL LinearFilter + ClampToEdge ---- */
static void lin(double u, int n, int *i0, int *i1, double *f) {
  double x = u * n - 0.5; double fl = floor(x); *f = x - fl; int i = (int)fl;
  *i0 = i < 0 ? 0 : (i > n - 1 ? n - 1 : i); int j = i + 1; *i1 = j < 0 ? 0 : (j > n - 1 ? n - 1 : j);
}
static void tex2(const float *t, int W, int H, double u, double v, double o[3]) {
  int x0, x1, y0, y1; double fx, fy; lin(u, W, &x0, &x1, &fx); lin(v, H, &y0, &y1, &fy);
  for (int c = 0; c < 3; c++) {
    double a = t[(y0 * W + x0) * 3 + c] * (1 - fx) + t[(y0 * W + x1) * 3 + c] * fx;
    double b = t[(y1 * W + x0) * 3 + c] * (1 - fx) + t[(y1 * W + x1) * 3 + c] * fx;
    o[c] = a * (1 - fy) + b * fy;
  }
}
static void tex3(const float *t, double u, double v, double w, double o[3]) {
  int x0, x1, y0, y1, z0, z1; double fx, fy, fz;
  lin(u, SW, &x0, &x1, &fx); lin(v, SH, &y0, &y1, &fy); lin(w, SD, &z0, &z1, &fz);
#define AT(z, y, x, c) t[(((size_t)(z) * SH + (y)) * SW + (x)) * 3 + (c)]
  for (int c = 0; c < 3; c++) {
    double a0 = AT(z0, y0, x0, c) * (1 - fx) + AT(z0, y0, x1, c) * fx;
    double b0 = AT(z0, y1, x0, c) * (1 - fx) + AT(z0, y1, x1, c) * fx;
    double a1 = AT(z1, y0, x0, c) * (1 - fx) + AT(z1, y0, x1, c) * fx;
    double b1 = AT(z1, y1, x0, c) * (1 - fx) + AT(z1, y1, x1, c) * fx;
    o[c] = (a0 * (1 - fy) + b0 * fy) * (1 - fz) + (a1 * (1 - fy) + b1 * fy) * fz;
  }
#undef AT
}

/* ---- common.glsl ---- */
static void TransUv(double r, double mu, double *u, double *v) {
  double rho = SafeSqrt(r * r - BOTTOM * BOTTOM);
  double d = DistTop(r, mu), dmin = TOP - r, dmax = rho + H_ATM;
  *u = CoordFromUnit((d - dmin) / (dmax - dmin), TW);
  *v = CoordFromUnit(rho / H_ATM, TH);
}
static void TransTop(double r, double mu, double o[3]) { double u, v; TransUv(r, mu, &u, &v); tex2(Ttex, TW, TH, u, v, o); }
static void Transmittance(double r, double mu, double d, int hg, double o[3]) {
  double r_d = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
  double mu_d = ClampCosine((r * mu + d) / r_d);
  double a[3], b[3];
  if (hg) { TransTop(r_d, -mu_d, a); TransTop(r, -mu, b); }
  else { TransTop(r, mu, a); TransTop(r_d, mu_d, b); }
  for (int c = 0; c < 3; c++) { double q = b[c] > 0 ? a[c] / b[c] : 0.0; o[c] = q < 1.0 ? q : 1.0; }
}
static double smoothstep(double e0, double e1, double x) { double t = clampd((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
static void TransToSun(double r, double mu_s, double o[3]) {
  double sh = BOTTOM / r, ch = -sqrt(fmax(1.0 - sh * sh, 0.0));
  TransTop(r, mu_s, o);
  double s = smoothstep(-sh * SUN_ANG, sh * SUN_ANG, mu_s - ch);
  for (int c = 0; c < 3; c++) o[c] *= s;
}
static double PhaseR(double nu) { return 3.0 / (16.0 * PI) * (1.0 + nu * nu); }
static double PhaseM(double g, double nu) { double k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g); return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5); }
static void ScatUvwz(double r, double mu, double mu_s, double nu, int hg, double uv[4]) {
  double rho = SafeSqrt(r * r - BOTTOM * BOTTOM);
  double u_r = CoordFromUnit(rho / H_ATM, R_SIZE);
  double r_mu = r * mu, disc = r_mu * r_mu - r * r + BOTTOM * BOTTOM, u_mu;
  if (hg) {
    double d = -r_mu - SafeSqrt(disc), dmin = r - BOTTOM, dmax = rho;
    u_mu = 0.5 - 0.5 * CoordFromUnit(dmax == dmin ? 0.0 : (d - dmin) / (dmax - dmin), MU_SIZE / 2);
  } else {
    double d = -r_mu + SafeSqrt(disc + H_ATM * H_ATM), dmin = TOP - r, dmax = rho + H_ATM;
    u_mu = 0.5 + 0.5 * CoordFromUnit((d - dmin) / (dmax - dmin), MU_SIZE / 2);
  }
  double d = DistTop(BOTTOM, mu_s), dmin = TOP - BOTTOM, dmax = H_ATM;
  double a = (d - dmin) / (dmax - dmin);
  double D = DistTop(BOTTOM, MU_S_MIN), A = (D - dmin) / (dmax - dmin);
  double u_mu_s = CoordFromUnit(fmax(1.0 - a / A, 0.0) / (1.0 + a), MU_S_SIZE);
  uv[0] = (nu + 1.0) / 2.0; uv[1] = u_mu_s; uv[2] = u_mu; uv[3] = u_r;
}
static void IrrUv(double r, double mu_s, double *u, double *v) {
  *u = CoordFromUnit(mu_s * 0.5 + 0.5, IW); *v = CoordFromUnit((r - BOTTOM) / (TOP - BOTTOM), IH);
}
static void GetIrr(const float *t, double r, double mu_s, double o[3]) { double u, v; IrrUv(r, mu_s, &u, &v); tex2(t, IW, IH, u, v, o); }

/* ---- precompute.glsl ---- */
static double LayerDensity(const Layer *l, double h) { return clampd(l->exp_term * exp(l->exp_scale * h) + l->linear_term * h + l->constant_term, 0, 1); }
static double ProfileDensity(const Layer *p, double h) { return h < p[0].width ? LayerDensity(&p[0], h) : LayerDensity(&p[1], h); }
static double OpticalLength(const Layer *p, double r, double mu) {
  const int N = 500; double dx = DistTop(r, mu) / N, res = 0;
  for (int i = 0; i <= N; i++) {
    double d = i * dx, ri = sqrt(d * d + 2.0 * r * mu * d + r * r);
    double y = ProfileDensity(p, ri - BOTTOM), w = (i == 0 || i == N) ? 0.5 : 1.0; res += y * w * dx;
  }
  return res;
}
static void ComputeTransmittanceTex(void) {
  for (int j = 0; j < TH; j++) for (int i = 0; i < TW; i++) {
    double u = (i + 0.5) / TW, v = (j + 0.5) / TH;
    double x_mu = UnitFromCoord(u, TW), x_r = UnitFromCoord(v, TH);
    double rho = H_ATM * x_r, r = sqrt(rho * rho + BOTTOM * BOTTOM), dmin = TOP - r, dmax = rho + H_ATM;
    double d = dmin + x_mu * (dmax - dmin);
    double mu = d == 0.0 ? 1.0 : (H_ATM * H_ATM - rho * rho - d * d) / (2.0 * r * d); mu = ClampCosine(mu);
    double lr = OpticalLength(RAYL, r, mu), lm = OpticalLength(MIEL, r, mu), lo = OpticalLength(OZL, r, mu);
    for (int c = 0; c < 3; c++) Ttex[(j * TW + i) * 3 + c] = (float)exp(-(RAY[c] * lr + MIEE[c] * lm + OZ[c] * lo));
  }
}
static void RMuMuSNu(double x, double y, double z, double *r, double *mu, double *mu_s, double *nu, int *hg) {
  double fnu = floor(x / MU_S_SIZE), fmus = fmod(x, (double)MU_S_SIZE);
  double uv0 = fnu / (NU_SIZE - 1), uv1 = fmus / MU_S_SIZE, uv2 = y / MU_SIZE, uv3 = z / R_SIZE;
  double rho = H_ATM * UnitFromCoord(uv3, R_SIZE);
  *r = sqrt(rho * rho + BOTTOM * BOTTOM);
  if (uv2 < 0.5) {
    double dmin = *r - BOTTOM, dmax = rho;
    double d = dmin + (dmax - dmin) * UnitFromCoord(1.0 - 2.0 * uv2, MU_SIZE / 2);
    *mu = d == 0.0 ? -1.0 : ClampCosine(-(rho * rho + d * d) / (2.0 * *r * d)); *hg = 1;
  } else {
    double dmin = TOP - *r, dmax = rho + H_ATM;
    double d = dmin + (dmax - dmin) * UnitFromCoord(2.0 * uv2 - 1.0, MU_SIZE / 2);
    *mu = d == 0.0 ? 1.0 : ClampCosine((H_ATM * H_ATM - rho * rho - d * d) / (2.0 * *r * d)); *hg = 0;
  }
  double x_mu_s = UnitFromCoord(uv1, MU_S_SIZE);
  double dmin = TOP - BOTTOM, dmax = H_ATM;
  double D = DistTop(BOTTOM, MU_S_MIN), A = (D - dmin) / (dmax - dmin);
  double a = (A - x_mu_s * A) / (1.0 + x_mu_s * A);
  double d = dmin + fmin(a, A) * (dmax - dmin);
  *mu_s = d == 0.0 ? 1.0 : ClampCosine((H_ATM * H_ATM - d * d) / (2.0 * BOTTOM * d));
  *nu = ClampCosine(uv0 * 2.0 - 1.0);
  double s = sqrt(fmax((1.0 - *mu * *mu) * (1.0 - *mu_s * *mu_s), 0.0));
  *nu = clampd(*nu, *mu * *mu_s - s, *mu * *mu_s + s);
}
static void Get4D(const float *t, double r, double mu, double mu_s, double nu, int hg, double o[3]) {
  double uv[4]; ScatUvwz(r, mu, mu_s, nu, hg, uv);
  double tcx = uv[0] * (NU_SIZE - 1), tx = floor(tcx), l = tcx - tx, a[3], b[3];
  tex3(t, (tx + uv[1]) / NU_SIZE, uv[2], uv[3], a);
  tex3(t, (tx + 1.0 + uv[1]) / NU_SIZE, uv[2], uv[3], b);
  for (int c = 0; c < 3; c++) o[c] = a[c] * (1 - l) + b[c] * l;
}
static void GetScatOrder(double r, double mu, double mu_s, double nu, int hg, int order, double o[3]) {
  if (order == 1) {
    double ra[3], mi[3]; Get4D(dR, r, mu, mu_s, nu, hg, ra); Get4D(dM, r, mu, mu_s, nu, hg, mi);
    double pr = PhaseR(nu), pm = PhaseM(MIE_G, nu);
    for (int c = 0; c < 3; c++) o[c] = ra[c] * pr + mi[c] * pm;
  } else Get4D(dMS, r, mu, mu_s, nu, hg, o);
}
static void SingleScattering(double r, double mu, double mu_s, double nu, int hg, double ray[3], double mie[3]) {
  const int N = 50; double dx = (hg ? DistBottom(r, mu) : DistTop(r, mu)) / N;
  double rs[3] = {0, 0, 0}, ms[3] = {0, 0, 0};
  for (int i = 0; i <= N; i++) {
    double d = i * dx;
    double r_d = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
    double mu_s_d = ClampCosine((r * mu_s + d * nu) / r_d);
    double t1[3], t2[3]; Transmittance(r, mu, d, hg, t1); TransToSun(r_d, mu_s_d, t2);
    double dr = ProfileDensity(RAYL, r_d - BOTTOM), dm = ProfileDensity(MIEL, r_d - BOTTOM);
    double w = (i == 0 || i == N) ? 0.5 : 1.0;
    for (int c = 0; c < 3; c++) { double t = t1[c] * t2[c]; rs[c] += t * dr * w; ms[c] += t * dm * w; }
  }
  for (int c = 0; c < 3; c++) { ray[c] = rs[c] * dx * SOLAR[c] * RAY[c]; mie[c] = ms[c] * dx * SOLAR[c] * MIES[c]; }
}
static void ScatteringDensity(double r, double mu, double mu_s, double nu, int order, double o[3]) {
  double om[3] = {sqrt(fmax(1.0 - mu * mu, 0.0)), 0.0, mu};
  double sx = om[0] == 0.0 ? 0.0 : (nu - mu * mu_s) / om[0];
  double sy = sqrt(fmax(1.0 - sx * sx - mu_s * mu_s, 0.0));
  double oms[3] = {sx, sy, mu_s};
  const int N = 16; const double dphi = PI / N, dth = PI / N;
  double acc[3] = {0, 0, 0};
  double rd = ProfileDensity(RAYL, r - BOTTOM), md = ProfileDensity(MIEL, r - BOTTOM);
  for (int l = 0; l < N; l++) {
    double th = (l + 0.5) * dth, ct = cos(th), st = sin(th);
    int hgi = RayIntersectsGround(r, ct);
    double dg = 0, tg[3] = {0, 0, 0}, alb = 0;
    if (hgi) { dg = DistBottom(r, ct); Transmittance(r, ct, dg, 1, tg); alb = GROUND_ALBEDO; }
    for (int m = 0; m < 2 * N; m++) {
      double ph = (m + 0.5) * dphi;
      double wi[3] = {cos(ph) * st, sin(ph) * st, ct};
      double dom = dth * dphi * sin(th);
      double nu1 = oms[0] * wi[0] + oms[1] * wi[1] + oms[2] * wi[2];
      double inc[3]; GetScatOrder(r, wi[2], mu_s, nu1, hgi, order - 1, inc);
      double gn[3] = {wi[0] * dg, wi[1] * dg, r + wi[2] * dg};
      double gl = sqrt(gn[0] * gn[0] + gn[1] * gn[1] + gn[2] * gn[2]);
      double gmu = (gn[0] * oms[0] + gn[1] * oms[1] + gn[2] * oms[2]) / gl;
      double gi[3]; GetIrr(Itex_delta, BOTTOM, gmu, gi);
      double nu2 = om[0] * wi[0] + om[1] * wi[1] + om[2] * wi[2];
      double pr = PhaseR(nu2), pm = PhaseM(MIE_G, nu2);
      for (int c = 0; c < 3; c++) {
        double L = inc[c] + tg[c] * alb * (1.0 / PI) * gi[c];
        acc[c] += L * (RAY[c] * rd * pr + MIES[c] * md * pm) * dom;
      }
    }
  }
  for (int c = 0; c < 3; c++) o[c] = acc[c];
}

/* Scattering density, same integrand and the same 16 x 32 midpoint quadrature as ComputeScatteringDensity,
 * but with the azimuth origin of the incident-direction grid at the SUN's azimuth instead of at omega's.
 * The incident radiance then depends only on (r, mu_s) and is looked up once per (r, mu_s) pair, and the
 * phase-weighted sum is done for all (mu, nu) texels of that pair. Same integral, different phi origin. */
static void DensityFactorized(int order) {
  const int N = 16, ND = 16 * 32; const double dphi = PI / N, dth = PI / N;
  double *Lin = malloc(sizeof(double) * ND * 3), *wi = malloc(sizeof(double) * ND * 3), *dom = malloc(sizeof(double) * ND);
  for (int z = 0; z < SD; z++) for (int xm = 0; xm < MU_S_SIZE; xm++) {
    double r, mu0, mus, nu0; int hg0;
    RMuMuSNu(xm + 0.5, SH / 2 + 0.5, z + 0.5, &r, &mu0, &mus, &nu0, &hg0);
    double ss = sqrt(fmax(1.0 - mus * mus, 0.0)), s3[3] = {ss, 0.0, mus};
    double rd = ProfileDensity(RAYL, r - BOTTOM), md = ProfileDensity(MIEL, r - BOTTOM);
    for (int l = 0; l < N; l++) {
      double th = (l + 0.5) * dth, ct = cos(th), st = sin(th);
      int hgi = RayIntersectsGround(r, ct);
      double dg = 0, tg[3] = {0, 0, 0}, alb = 0;
      if (hgi) { dg = DistBottom(r, ct); Transmittance(r, ct, dg, 1, tg); alb = GROUND_ALBEDO; }
      for (int m = 0; m < 2 * N; m++) {
        int i = l * 2 * N + m; double ph = (m + 0.5) * dphi;
        double w[3] = {cos(ph) * st, sin(ph) * st, ct};
        wi[i * 3] = w[0]; wi[i * 3 + 1] = w[1]; wi[i * 3 + 2] = w[2]; dom[i] = dth * dphi * st;
        double nu1 = s3[0] * w[0] + s3[2] * w[2];
        double inc[3]; GetScatOrder(r, ct, mus, nu1, hgi, order - 1, inc);
        double gn[3] = {w[0] * dg, w[1] * dg, r + w[2] * dg};
        double gl = sqrt(gn[0] * gn[0] + gn[1] * gn[1] + gn[2] * gn[2]);
        double gmu = (gn[0] * s3[0] + gn[2] * s3[2]) / gl;
        double gi[3]; GetIrr(Itex_delta, BOTTOM, gmu, gi);
        for (int c = 0; c < 3; c++) Lin[i * 3 + c] = (inc[c] + tg[c] * alb * (1.0 / PI) * gi[c]) * dom[i];
      }
    }
    for (int y = 0; y < SH; y++) for (int xn = 0; xn < NU_SIZE; xn++) {
      int x = xn * MU_S_SIZE + xm;
      double rr, mu, mus2, nu; int hg; RMuMuSNu(x + 0.5, y + 0.5, z + 0.5, &rr, &mu, &mus2, &nu, &hg);
      double ox = ss == 0.0 ? 0.0 : (nu - mu * mus) / ss;
      double oy = sqrt(fmax(1.0 - ox * ox - mu * mu, 0.0));
      double acc[3] = {0, 0, 0};
      for (int i = 0; i < ND; i++) {
        double nu2 = ox * wi[i * 3] + oy * wi[i * 3 + 1] + mu * wi[i * 3 + 2];
        double pr = PhaseR(nu2), pm = PhaseM(MIE_G, nu2);
        for (int c = 0; c < 3; c++) acc[c] += Lin[i * 3 + c] * (RAY[c] * rd * pr + MIES[c] * md * pm);
      }
      size_t k = (((size_t)z * SH + y) * SW + x) * 3; for (int c = 0; c < 3; c++) dJ[k + c] = (float)acc[c];
    }
  }
  free(Lin); free(wi); free(dom);
}
static void MultipleScattering(double r, double mu, double mu_s, double nu, int hg, double o[3]) {
  const int N = 50; double dx = (hg ? DistBottom(r, mu) : DistTop(r, mu)) / N;
  double acc[3] = {0, 0, 0};
  for (int i = 0; i <= N; i++) {
    double d = i * dx;
    double ri = ClampRadius(sqrt(d * d + 2.0 * r * mu * d + r * r));
    double mui = ClampCosine((r * mu + d) / ri), musi = ClampCosine((r * mu_s + d * nu) / ri);
    double J[3], T[3]; Get4D(dJ, ri, mui, musi, nu, hg, J); Transmittance(r, mu, d, hg, T);
    double w = (i == 0 || i == N) ? 0.5 : 1.0;
    for (int c = 0; c < 3; c++) acc[c] += J[c] * T[c] * dx * w;
  }
  for (int c = 0; c < 3; c++) o[c] = acc[c];
}
static void DirectIrradianceTex(float *out) {
  for (int j = 0; j < IH; j++) for (int i = 0; i < IW; i++) {
    double x_mu_s = UnitFromCoord((i + 0.5) / IW, IW), x_r = UnitFromCoord((j + 0.5) / IH, IH);
    double r = BOTTOM + x_r * (TOP - BOTTOM), mu_s = ClampCosine(2.0 * x_mu_s - 1.0);
    double as = SUN_ANG, f = mu_s < -as ? 0.0 : (mu_s > as ? mu_s : (mu_s + as) * (mu_s + as) / (4.0 * as));
    double T[3]; TransTop(r, mu_s, T);
    for (int c = 0; c < 3; c++) out[(j * IW + i) * 3 + c] = (float)(SOLAR[c] * T[c] * f);
  }
}
static void IndirectIrradianceTex(int order, float *out, int additive) {
  const int N = 32; const double dphi = PI / N, dth = PI / N;
  for (int j = 0; j < IH; j++) for (int i = 0; i < IW; i++) {
    double x_mu_s = UnitFromCoord((i + 0.5) / IW, IW), x_r = UnitFromCoord((j + 0.5) / IH, IH);
    double r = BOTTOM + x_r * (TOP - BOTTOM), mu_s = ClampCosine(2.0 * x_mu_s - 1.0);
    double oms[3] = {sqrt(fmax(1.0 - mu_s * mu_s, 0.0)), 0.0, mu_s}, acc[3] = {0, 0, 0};
    for (int jj = 0; jj < N / 2; jj++) {
      double th = (jj + 0.5) * dth;
      for (int ii = 0; ii < 2 * N; ii++) {
        double ph = (ii + 0.5) * dphi;
        double w[3] = {cos(ph) * sin(th), sin(ph) * sin(th), cos(th)};
        double dom = dth * dphi * sin(th), nu = w[0] * oms[0] + w[1] * oms[1] + w[2] * oms[2];
        double L[3]; GetScatOrder(r, w[2], mu_s, nu, 0, order, L);
        for (int c = 0; c < 3; c++) acc[c] += L[c] * w[2] * dom;
      }
    }
    for (int c = 0; c < 3; c++) { size_t k = (j * IW + i) * 3 + c; out[k] = (float)((additive ? out[k] : 0.0f) + acc[c]); }
  }
}
static void save(const char *dir, const char *name, const float *p, size_t n) {
  char path[1024]; snprintf(path, sizeof path, "%s/%s", dir, name);
  FILE *f = fopen(path, "wb"); if (!f) { perror(path); exit(1); }
  fwrite(p, sizeof(float), n, f); fclose(f);
}
static double now(void) { struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return ts.tv_sec + 1e-9 * ts.tv_nsec; }

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage\n"); return 1; }
  FILE *f = fopen(argv[1], "r"); double *P[5] = {SOLAR, RAY, MIES, MIEE, OZ};
  for (int k = 0; k < 5; k++) for (int c = 0; c < 3; c++) if (fscanf(f, "%lf", &P[k][c]) != 1) { fprintf(stderr, "bad params\n"); return 1; }
  fclose(f);
  int maxOrder = argc > 3 ? atoi(argv[3]) : 4;
  MU_S_MIN = cos(120.0 * PI / 180.0); H_ATM = sqrt(TOP * TOP - BOTTOM * BOTTOM);
  Ttex = calloc(TW * TH * 3, 4); Itex_delta = calloc(IW * IH * 3, 4); Iout = calloc(IW * IH * 3, 4);
  dR = calloc((size_t)NTEX * 3, 4); dM = calloc((size_t)NTEX * 3, 4); dMS = calloc((size_t)NTEX * 3, 4); dJ = calloc((size_t)NTEX * 3, 4);
  Sout = calloc((size_t)NTEX * 3, 4); Mout = calloc((size_t)NTEX * 3, 4); Hout = calloc((size_t)NTEX * 3, 4);
  double t0 = now();
  ComputeTransmittanceTex();
  DirectIrradianceTex(Itex_delta);
  fprintf(stderr, "transmittance+direct %.1fs\n", now() - t0);
  for (int z = 0; z < SD; z++) for (int y = 0; y < SH; y++) for (int x = 0; x < SW; x++) {
    double r, mu, mus, nu; int hg; RMuMuSNu(x + 0.5, y + 0.5, z + 0.5, &r, &mu, &mus, &nu, &hg);
    double ra[3], mi[3]; SingleScattering(r, mu, mus, nu, hg, ra, mi);
    size_t k = (((size_t)z * SH + y) * SW + x) * 3;
    for (int c = 0; c < 3; c++) { dR[k + c] = (float)ra[c]; dM[k + c] = (float)mi[c]; Sout[k + c] = (float)ra[c]; Mout[k + c] = (float)mi[c]; }
  }
  fprintf(stderr, "single %.1fs\n", now() - t0);
  for (int order = 2; order <= maxOrder; order++) {
    DensityFactorized(order);
    fprintf(stderr, "order %d density %.1fs\n", order, now() - t0);
    IndirectIrradianceTex(order - 1, Itex_delta, 0);
    for (int i = 0; i < IW * IH * 3; i++) Iout[i] += Itex_delta[i];
    for (int z = 0; z < SD; z++) for (int y = 0; y < SH; y++) for (int x = 0; x < SW; x++) {
      double r, mu, mus, nu; int hg; RMuMuSNu(x + 0.5, y + 0.5, z + 0.5, &r, &mu, &mus, &nu, &hg);
      double Lm[3]; MultipleScattering(r, mu, mus, nu, hg, Lm);
      size_t k = (((size_t)z * SH + y) * SW + x) * 3; double pr = PhaseR(nu);
      for (int c = 0; c < 3; c++) { dMS[k + c] = (float)Lm[c]; Sout[k + c] += (float)(Lm[c] / pr); Hout[k + c] += (float)(Lm[c] / pr); }
    }
    fprintf(stderr, "order %d multiple %.1fs\n", order, now() - t0);
  }
  save(argv[2], "transmittance.f32", Ttex, TW * TH * 3);
  save(argv[2], "irradiance.f32", Iout, IW * IH * 3);
  save(argv[2], "scattering.f32", Sout, (size_t)NTEX * 3);
  save(argv[2], "mie.f32", Mout, (size_t)NTEX * 3);
  save(argv[2], "higher.f32", Hout, (size_t)NTEX * 3);
  fprintf(stderr, "done %.1fs\n", now() - t0);
  return 0;
}
