import { Skia } from '@shopify/react-native-skia';

/**
 * AGSL (Android Graphics Shading Language) source code for high-fidelity 2D atmospheric scattering.
 * Computes Rayleigh scattering, Mie scattering, and horizon extinction per pixel on the GPU.
 * High-compatibility mobile GPU driver patch: strictly uses float literals with no 'f' suffix,
 * ternary operators instead of step/mix branches, and uniform float3 mix vectors.
 */
const skyShaderSource = `
  uniform float2 u_resolution;
  uniform float2 u_sunPos;
  uniform float3 u_sunLight;
  uniform float3 u_horizonBeam;
  uniform float u_sunAlt;
  uniform float u_beta;
  uniform float u_pathClarity;
  uniform float u_visualFov;
  uniform float u_horizonY;
  uniform float u_sunBrightness;
  uniform float u_dayMultiplier;
  uniform float u_overheadOvercast;
  uniform float u_cloudGrid[32];

  float getCloudDensity(int idx) {
    if (idx == 0) return u_cloudGrid[0];
    if (idx == 1) return u_cloudGrid[1];
    if (idx == 2) return u_cloudGrid[2];
    if (idx == 3) return u_cloudGrid[3];
    if (idx == 4) return u_cloudGrid[4];
    if (idx == 5) return u_cloudGrid[5];
    if (idx == 6) return u_cloudGrid[6];
    if (idx == 7) return u_cloudGrid[7];
    if (idx == 8) return u_cloudGrid[8];
    if (idx == 9) return u_cloudGrid[9];
    if (idx == 10) return u_cloudGrid[10];
    if (idx == 11) return u_cloudGrid[11];
    if (idx == 12) return u_cloudGrid[12];
    if (idx == 13) return u_cloudGrid[13];
    if (idx == 14) return u_cloudGrid[14];
    if (idx == 15) return u_cloudGrid[15];
    if (idx == 16) return u_cloudGrid[16];
    if (idx == 17) return u_cloudGrid[17];
    if (idx == 18) return u_cloudGrid[18];
    if (idx == 19) return u_cloudGrid[19];
    if (idx == 20) return u_cloudGrid[20];
    if (idx == 21) return u_cloudGrid[21];
    if (idx == 22) return u_cloudGrid[22];
    if (idx == 23) return u_cloudGrid[23];
    if (idx == 24) return u_cloudGrid[24];
    if (idx == 25) return u_cloudGrid[25];
    if (idx == 26) return u_cloudGrid[26];
    if (idx == 27) return u_cloudGrid[27];
    if (idx == 28) return u_cloudGrid[28];
    if (idx == 29) return u_cloudGrid[29];
    if (idx == 30) return u_cloudGrid[30];
    if (idx == 31) return u_cloudGrid[31];
    return 0.0;
  }

  float getBilinearDensity(float colF, float rowF) {
    int c0 = int(clamp(colF, 0.0, 7.0));
    int c1 = int(clamp(colF + 1.0, 0.0, 7.0));
    int r0 = int(clamp(rowF, 0.0, 3.0));
    int r1 = int(clamp(rowF + 1.0, 0.0, 3.0));
    
    float tx = fract(colF);
    float ty = fract(rowF);
    
    float d00 = getCloudDensity(r0 * 8 + c0);
    float d10 = getCloudDensity(r0 * 8 + c1);
    float d01 = getCloudDensity(r1 * 8 + c0);
    float d11 = getCloudDensity(r1 * 8 + c1);
    
    float d0 = mix(d00, d10, tx);
    float d1 = mix(d01, d11, tx);
    
    return mix(d0, d1, ty);
  }

  float4 main(float2 pos) {
    // Relocated constants to prevent global context linking errors in Skia compilers
    float3 OVERCAST = float3(0.498, 0.541, 0.588);
    float3 AMBIENT_NIGHT = float3(0.003, 0.003, 0.010);
    float PI = 3.14159265;

    // 1. Calculate elevation angle (theta) of the pixel in degrees
    // Non-linear dome mapping to represent 0 to 75 degrees of the sky dome
    float dy = u_horizonY - pos.y;
    float degPerPixel = u_visualFov / max(1.0, u_resolution.x);
    
    // Normalize dy relative to the vertical space above the horizon
    float normY = max(0.0, dy) / max(1.0, u_horizonY);
    float theta_deg = (dy >= 0.0) ? 75.0 * pow(normY, 1.5) : dy * degPerPixel;
    
    // Calculate horizontal azimuth angle (phi) relative to the sun (centered horizontally)
    float dx = pos.x - (max(1.0, u_resolution.x) / 2.0);
    float phi_deg = dx * degPerPixel;

    // Map angles to bilinear cloud grid cells
    float colF = (phi_deg + u_visualFov / 2.0) / (u_visualFov / 8.0) - 0.5;
    float rowF = theta_deg / (75.0 / 4.0) - 0.5;
    float cloudDensity = getBilinearDensity(colF, rowF);

    // Convert angles to radians
    float theta_rad = theta_deg * PI / 180.0;
    float phi_rad = phi_deg * PI / 180.0;
    float sunAlt_rad = u_sunAlt * PI / 180.0;

    // 2. 3D Spherical directions to compute scattering phase angle (gamma)
    float cosTheta = cos(theta_rad);
    float sinTheta = sin(theta_rad);
    float cosGamma = sinTheta * sin(sunAlt_rad) + cosTheta * cos(sunAlt_rad) * cos(phi_rad);
    cosGamma = clamp(cosGamma, -1.0, 1.0);

    // 3. Rayleigh & Mie Phase functions
    float rayleighPhase = 0.05968 * (1.0 + cosGamma * cosGamma);
    
    // Henyey-Greenstein Mie phase (g = 0.78 for aerosols)
    float g = 0.78;
    float g2 = g * g;
    float mieBase = max(0.001, 1.0 + g2 - 2.0 * g * cosGamma);
    float miePhase = 0.07957 * (1.0 - g2) / (mieBase * sqrt(mieBase));

    // 4. Airmass calculation (for pixel direction)
    float m = 1.0 / max(0.015, sin(theta_rad));
    m = clamp(m, 1.0, 40.0);

    // 5. Rayleigh scattering channel intensities
    // Extinguish background scattering mildly under clouds
    float rayleighStrength = exp(-0.055 * m) * rayleighPhase * (1.0 - cloudDensity * 0.4);
    float3 rayleigh = float3(
      u_sunLight.r * 0.065 * rayleighStrength,
      u_sunLight.g * 0.165 * rayleighStrength,
      u_sunLight.b * 0.38 * rayleighStrength
    );

    // 6. Mie scattering channel intensities
    // Strongly extinguish Mie scattering halo (Sun Glow) behind clouds
    float mieStrength = 0.14 * (m - 1.0) * u_beta * miePhase * (1.0 - cloudDensity * 0.95);
    float3 mie = float3(
      u_sunLight.r * mieStrength,
      u_sunLight.g * mieStrength,
      u_sunLight.b * mieStrength
    );

    // 7. Horizon Extinction (scattering light fading near the horizon)
    float horizonWeight = exp(-0.35 * max(0.0, theta_deg));
    float horizonStrength = horizonWeight * u_pathClarity * 2.2 * (1.0 - cloudDensity * 0.6);
    
    float altWeight = clamp((u_sunAlt - 0.0) / 10.0, 0.0, 1.0);
    float gFilter = mix(0.42, 0.9, altWeight);
    float bFilter = mix(0.05, 0.8, altWeight);
    
    float3 horizon = float3(
      u_horizonBeam.r * horizonStrength,
      u_horizonBeam.g * horizonStrength * gFilter,
      u_horizonBeam.b * horizonStrength * bFilter
    );

    // 8. Ground / Night / Below Horizon fading
    // Apply exposure multiplier (12.0) to convert small physical scattering quantities to rich visual tones
    float3 skyRGB = (rayleigh + mie + horizon) * 12.0;
    
    // Ternary fade-out below horizon with limit guard to prevent GPU underflow NaN
    float belowHorizonFade = (theta_deg < 0.0) ? exp(max(-20.0, theta_deg * 0.8)) : 1.0;
    skyRGB = skyRGB * belowHorizonFade;

    // 9. Absolute base color + Sun Brightness & Overcast mixing
    float3 finalRGB = (skyRGB + float3(0.008, 0.008, 0.010)) * u_sunBrightness * u_dayMultiplier 
                     + AMBIENT_NIGHT * (1.0 - u_sunBrightness);

    // Apply cloud overcast darkening (merging global overcast with localized cloud density)
    float localOvercast = max(u_overheadOvercast, cloudDensity);
    float overcastWeight = localOvercast * 0.75 * u_sunBrightness;
    finalRGB = mix(finalRGB, OVERCAST, overcastWeight);

    // Gamma correction for sRGB color space mapping on mobile displays
    finalRGB = pow(finalRGB, float3(1.0 / 2.2));

    return float4(clamp(finalRGB, 0.0, 1.0), 1.0);
  }
`;

export const skyShaderEffect = Skia.RuntimeEffect.Make(skyShaderSource);
