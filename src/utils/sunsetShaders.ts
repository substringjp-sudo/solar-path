import { Skia } from '@shopify/react-native-skia';

/**
 * AGSL (Android Graphics Shading Language) source code for high-fidelity 2D atmospheric scattering.
 * Computes Rayleigh scattering, Mie scattering, and horizon extinction per pixel on the GPU.
 * Const/Variables relocated inside main and division-by-zero guards added to avoid C++ compiler crash.
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

  float4 main(float2 pos) {
    // Relocated constants to prevent global context linking errors in Skia compilers
    float3 OVERCAST = float3(0.498, 0.541, 0.588);
    float3 AMBIENT_NIGHT = float3(0.003, 0.003, 0.010);
    float PI = 3.14159265;

    // 1. Calculate elevation angle (theta) of the pixel in degrees
    // Prevent division-by-zero crash if u_resolution.x is 0
    float dy = u_horizonY - pos.y;
    float degPerPixel = u_visualFov / max(1.0, u_resolution.x);
    float theta_deg = dy * degPerPixel;
    
    // Calculate horizontal azimuth angle (phi) relative to the sun (centered horizontally)
    float dx = pos.x - (max(1.0, u_resolution.x) / 2.0);
    float phi_deg = dx * degPerPixel;

    // Convert angles to radians
    float theta_rad = theta_deg * PI / 180.0;
    float phi_rad = phi_deg * PI / 180.0;
    float sunAlt_rad = u_sunAlt * PI / 180.0;

    // 2. 3D Spherical directions to compute scattering phase angle (gamma)
    float cosTheta = cos(theta_rad);
    float cosGamma = cosTheta * cos(sunAlt_rad) * cos(phi_rad) + sin(theta_rad) * sin(sunAlt_rad);
    cosGamma = clamp(cosGamma, -1.0, 1.0);

    // 3. Rayleigh & Mie Phase functions
    float rayleighPhase = 0.05968 * (1.0 + cosGamma * cosGamma);
    
    // Henyey-Greenstein Mie phase (g = 0.78 for aerosols)
    float g = 0.78;
    float g2 = g * g;
    float miePhase = 0.07957 * (1.0 - g2) / pow(max(0.001, 1.0 + g2 - 2.0 * g * cosGamma), 1.5);

    // 4. Airmass calculation (for pixel direction)
    float m = 1.0 / max(0.015, sin(theta_rad));
    m = clamp(m, 1.0, 40.0);

    // 5. Rayleigh scattering channel intensities
    float rayleighStrength = exp(-0.055 * m) * rayleighPhase;
    float3 rayleigh = float3(
      u_sunLight.r * 0.065 * rayleighStrength,
      u_sunLight.g * 0.165 * rayleighStrength,
      u_sunLight.b * 0.38 * rayleighStrength
    );

    // 6. Mie scattering channel intensities
    float mieStrength = 0.14 * (m - 1.0) * u_beta * miePhase;
    float3 mie = float3(
      u_sunLight.r * mieStrength,
      u_sunLight.g * mieStrength,
      u_sunLight.b * mieStrength
    );

    // 7. Horizon Extinction (scattering light fading near the horizon)
    float horizonWeight = exp(-0.35 * max(0.0, theta_deg));
    float horizonStrength = horizonWeight * u_pathClarity * 2.2;
    float3 horizon = float3(
      u_horizonBeam.r * horizonStrength,
      u_horizonBeam.g * horizonStrength * 0.42,
      u_horizonBeam.b * horizonStrength * 0.05
    );

    // 8. Ground / Night / Below Horizon fading
    float3 skyRGB = rayleigh + mie + horizon;
    
    // Branchless exponential fade-out below the horizon with exponential lower-bound safety guard to prevent GPU underflow NaN
    float isBelow = step(theta_deg, 0.0); 
    float belowHorizonFade = mix(1.0, exp(max(-20.0, theta_deg * 0.8)), isBelow);
    skyRGB = skyRGB * belowHorizonFade;

    // 9. Absolute base color + Sun Brightness & Overcast mixing
    float3 finalRGB = (skyRGB + float3(0.008, 0.008, 0.010)) * u_sunBrightness * u_dayMultiplier 
                     + AMBIENT_NIGHT * (1.0 - u_sunBrightness);

    // Apply cloud overcast darkening
    float overcastWeight = u_overheadOvercast * 0.7 * u_sunBrightness;
    finalRGB = mix(finalRGB, OVERCAST, overcastWeight);

    return float4(clamp(finalRGB, 0.0, 1.0), 1.0);
  }
`;

export const skyShaderEffect = Skia.RuntimeEffect.Make(skyShaderSource);
