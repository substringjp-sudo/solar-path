// BeforeGlow Web Application Interactive Controller

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // 1. Phone Simulator Viewport Tab Switcher
  const phoneTabs = document.querySelectorAll('.tab-indicator');
  const simScreens = document.querySelectorAll('.sim-screen');

  phoneTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetScreenId = tab.getAttribute('data-target');

      // Deactivate all tabs and screens
      phoneTabs.forEach(t => t.classList.remove('active'));
      simScreens.forEach(s => s.classList.remove('active'));

      // Activate clicked tab and matched screen
      tab.classList.add('active');
      const targetScreen = document.getElementById(targetScreenId);
      if (targetScreen) {
        targetScreen.classList.add('active');
      }
    });
  });

  // 2. Guides Tab Controller
  const guideTabs = document.querySelectorAll('.guide-tab-btn');
  const guideContents = document.querySelectorAll('.guide-tab-content');

  guideTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTabId = tab.getAttribute('data-tab');

      // Remove active classes
      guideTabs.forEach(t => t.classList.remove('active'));
      guideContents.forEach(c => c.classList.remove('active'));

      // Add active class to target
      tab.classList.add('active');
      const targetContent = document.getElementById(targetTabId);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // 3. Navbar Scroll Interaction
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.4)';
      navbar.style.backgroundColor = 'rgba(10, 6, 16, 0.95)';
    } else {
      navbar.style.boxShadow = 'none';
      navbar.style.backgroundColor = 'rgba(13, 8, 20, 0.8)';
    }
  });

  // 4. Download Alert Simulation
  const downloadBtn = document.getElementById('btn-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      alert('BeforeGlow 앱이 현재 구글 플레이 스토어 내부 심사 준비 중입니다. 업로드된 AAB 패키지 빌드 검토가 승인된 후 즉시 다운로드 링크로 활성화됩니다!');
    });
  }

  // 5. Interactive Sunset Simulator Engine (SVG Renderer)
  const simViewport = document.getElementById('sim-viewport-demo');
  if (!simViewport) return;

  // Color Utility Class for RGB Interpolation
  class RGB {
    constructor(r, g, b) {
      this.r = r;
      this.g = g;
      this.b = b;
    }
    toCss(alpha = 1.0) {
      return `rgba(${Math.round(this.r)}, ${Math.round(this.g)}, ${Math.round(this.b)}, ${alpha})`;
    }
    static parseHex(hex) {
      hex = hex.replace('#', '');
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return new RGB(r, g, b);
    }
    static lerp(c1, c2, t) {
      t = Math.max(0, Math.min(1, t));
      return new RGB(
        c1.r + (c2.r - c1.r) * t,
        c1.g + (c2.g - c1.g) * t,
        c1.b + (c2.b - c1.b) * t
      );
    }
  }

  // Sky Gradient LUT based on true solar altitude
  const skyLut = {
    clear: [
      { alt: 12.0, colors: ['#0d47a1', '#1976d2', '#bbdefb'] },
      { alt: 3.0,  colors: ['#1a0933', '#7b1fa2', '#e64a19'] },
      { alt: -2.0, colors: ['#0a0518', '#311b92', '#d84315'] },
      { alt: -8.0, colors: ['#020105', '#080512', '#120a21'] }
    ],
    cloudy: [
      { alt: 12.0, colors: ['#0d47a1', '#1e88e5', '#bbdefb'] },
      { alt: 3.0,  colors: ['#0d001a', '#6a1b9a', '#ff7043'] },
      { alt: -2.0, colors: ['#050010', '#311b92', '#ad1457'] },
      { alt: -8.0, colors: ['#020105', '#080512', '#120a21'] }
    ],
    overcast: [
      { alt: 12.0, colors: ['#424242', '#616161', '#9e9e9e'] },
      { alt: 3.0,  colors: ['#212121', '#303030', '#5d4037'] },
      { alt: -2.0, colors: ['#1a1a1a', '#212121', '#2d2d2d'] },
      { alt: -8.0, colors: ['#0a0a0a', '#101010', '#151515'] }
    ]
  };

  const getInterpolatedSky = (state, alt) => {
    const lut = skyLut[state] || skyLut.clear;
    let lo = lut[0];
    let hi = lut[lut.length - 1];

    for (let i = 0; i < lut.length - 1; i++) {
      if (alt <= lut[i].alt && alt > lut[i + 1].alt) {
        lo = lut[i];
        hi = lut[i + 1];
        break;
      }
    }

    if (alt >= lut[0].alt) return lut[0].colors;
    if (alt <= lut[lut.length - 1].alt) return lut[lut.length - 1].colors;

    const t = (lo.alt - alt) / (lo.alt - hi.alt);
    return [
      RGB.lerp(RGB.parseHex(lo.colors[0]), RGB.parseHex(hi.colors[0]), t).toCss(),
      RGB.lerp(RGB.parseHex(lo.colors[1]), RGB.parseHex(hi.colors[1]), t).toCss(),
      RGB.lerp(RGB.parseHex(lo.colors[2]), RGB.parseHex(hi.colors[2]), t).toCss()
    ];
  };

  // Cloud configuration template
  const cloudConfigs = {
    clear: [
      { shape: '#cloud-shape-cirrus', scale: 0.8, x: 50, y: 30, speed: 0.15, layer: 'high', width: 220 },
      { shape: '#cloud-shape-cirrus', scale: 0.7, x: 320, y: 45, speed: 0.12, layer: 'high', width: 220 }
    ],
    cloudy: [
      { shape: '#cloud-shape-altocumulus', scale: 0.75, x: -30, y: 50, speed: 0.25, layer: 'mid', width: 170 },
      { shape: '#cloud-shape-cumulus-1', scale: 0.6, x: 120, y: 70, speed: 0.35, layer: 'low', width: 190 },
      { shape: '#cloud-shape-cumulus-2', scale: 0.8, x: 280, y: 95, speed: 0.28, layer: 'low', width: 215 },
      { shape: '#cloud-shape-altocumulus', scale: 0.9, x: 420, y: 60, speed: 0.22, layer: 'mid', width: 170 },
      { shape: '#cloud-shape-cumulus-1', scale: 0.7, x: 190, y: 120, speed: 0.32, layer: 'low', width: 190 }
    ],
    overcast: [
      { shape: '#cloud-shape-nimbostratus', scale: 1.1, x: -80, y: 45, speed: 0.45, layer: 'low', width: 200 },
      { shape: '#cloud-shape-cumulus-2', scale: 1.3, x: 80, y: 80, speed: 0.55, layer: 'low', width: 215 },
      { shape: '#cloud-shape-nimbostratus', scale: 1.2, x: 230, y: 60, speed: 0.4, layer: 'low', width: 200 },
      { shape: '#cloud-shape-cumulus-1', scale: 1.4, x: 380, y: 110, speed: 0.5, layer: 'low', width: 190 },
      { shape: '#cloud-shape-nimbostratus', scale: 1.0, x: 520, y: 90, speed: 0.35, layer: 'low', width: 200 },
      { shape: '#cloud-shape-cumulus-2', scale: 1.1, x: 160, y: 130, speed: 0.48, layer: 'low', width: 215 }
    ]
  };

  let weatherState = 'clear';
  let activeClouds = [];
  const cloudGroup = document.getElementById('simCloudGroup');

  const initCloudAssets = (state) => {
    if (!cloudGroup) return;
    cloudGroup.innerHTML = '';
    activeClouds = JSON.parse(JSON.stringify(cloudConfigs[state] || cloudConfigs.clear));

    activeClouds.forEach((cloud) => {
      const useNode = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      useNode.setAttribute('href', cloud.shape);
      useNode.setAttribute('class', `sim-svg-cloud layer-${cloud.layer}`);
      cloudGroup.appendChild(useNode);
      cloud.dom = useNode;
    });
  };

  const weatherBtns = document.querySelectorAll('.weather-tab-btn');
  let weatherAutoplayInterval;
  const weatherStates = ['clear', 'cloudy', 'overcast'];
  let currentWeatherIndex = 0;

  const setWeatherState = (state) => {
    weatherState = state;
    initCloudAssets(state);

    simViewport.classList.remove('state-clear', 'state-cloudy', 'state-overcast');
    simViewport.classList.add(`state-${state}`);

    weatherBtns.forEach(btn => {
      if (btn.getAttribute('data-weather') === state) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    currentWeatherIndex = weatherStates.indexOf(state);
  };

  const startWeatherAutoplay = () => {
    weatherAutoplayInterval = setInterval(() => {
      currentWeatherIndex = (currentWeatherIndex + 1) % weatherStates.length;
      setWeatherState(weatherStates[currentWeatherIndex]);
    }, 6000);
  };

  weatherBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      clearInterval(weatherAutoplayInterval);
      const state = btn.getAttribute('data-weather');
      setWeatherState(state);
    });
  });

  setWeatherState('clear');
  startWeatherAutoplay();

  const cycleDuration = 12000;

  const updateTick = () => {
    const timeFactor = (Date.now() % cycleDuration) / cycleDuration;
    const rad = timeFactor * 2 * Math.PI;
    const altitude = Math.sin(rad) * 10 + 2; 

    const sunY = 190 - (altitude * 8.5);
    const sunX = 250;

    const sunDisk = document.getElementById('simSunDisk');
    const sunGlowOuter = document.getElementById('simSunGlowOuter');
    const sunGlowInner = document.getElementById('simSunGlowInner');

    if (sunDisk) {
      sunDisk.setAttribute('cx', sunX);
      sunDisk.setAttribute('cy', sunY);
    }
    if (sunGlowOuter) {
      sunGlowOuter.setAttribute('cx', sunX);
      sunGlowOuter.setAttribute('cy', sunY);
    }
    if (sunGlowInner) {
      sunGlowInner.setAttribute('cx', sunX);
      sunGlowInner.setAttribute('cy', sunY);
    }

    const skyColors = getInterpolatedSky(weatherState, altitude);
    const stop0 = document.getElementById('skyStop0');
    const stop1 = document.getElementById('skyStop1');
    const stop2 = document.getElementById('skyStop2');

    if (stop0) stop0.setAttribute('stop-color', skyColors[0]);
    if (stop1) stop1.setAttribute('stop-color', skyColors[1]);
    if (stop2) stop2.setAttribute('stop-color', skyColors[2]);

    let sunColor = '#FFFFFF';
    let outerGlowColor = 'rgba(255, 112, 67, 0.4)';
    let innerGlowColor = 'rgba(255, 215, 0, 0.6)';
    let sunOpacity = 1.0;

    if (weatherState === 'overcast') {
      sunOpacity = 0.15;
      sunColor = '#9E9E9E';
      outerGlowColor = 'rgba(97, 97, 97, 0.15)';
      innerGlowColor = 'rgba(158, 158, 158, 0.2)';
    } else {
      if (altitude > 5.0) {
        sunColor = '#FFFFFF';
        outerGlowColor = 'rgba(255, 215, 0, 0.4)';
        innerGlowColor = 'rgba(255, 255, 255, 0.7)';
      } else if (altitude > -2.0) {
        const t = (5.0 - altitude) / 7.0;
        const sunRGB = RGB.lerp(new RGB(255, 255, 255), new RGB(255, 60, 0), t);
        sunColor = sunRGB.toCss();
        outerGlowColor = RGB.lerp(new RGB(255, 215, 0), new RGB(230, 30, 0), t).toCss(0.5);
        innerGlowColor = RGB.lerp(new RGB(255, 255, 255), new RGB(255, 110, 0), t).toCss(0.7);
        sunOpacity = 1.0 - ((-altitude) / 5.0) * 0.5;
      } else {
        const t = Math.min(1.0, (-altitude - 2.0) / 6.0);
        sunOpacity = Math.max(0, 0.5 - t * 0.5);
        sunColor = 'rgba(213, 0, 0, 0.8)';
        outerGlowColor = 'rgba(128, 0, 0, 0.15)';
        innerGlowColor = 'rgba(255, 23, 0, 0.2)';
      }
    }

    if (sunDisk) {
      sunDisk.setAttribute('fill', sunColor);
      sunDisk.style.opacity = sunOpacity;
    }
    if (sunGlowOuter) {
      sunGlowOuter.setAttribute('fill', outerGlowColor);
      sunGlowOuter.style.opacity = sunOpacity;
    }
    if (sunGlowInner) {
      sunGlowInner.setAttribute('fill', innerGlowColor);
      sunGlowInner.style.opacity = sunOpacity;
    }

    activeClouds.forEach(cloud => {
      cloud.x += cloud.speed;
      const cloudRightBoundary = 500;
      const cloudLeftBoundary = -cloud.width * cloud.scale;
      if (cloud.x > cloudRightBoundary) {
        cloud.x = cloudLeftBoundary;
      }

      let cloudFill = '#FFFFFF';
      if (weatherState === 'overcast') {
        const t = Math.max(0, Math.min(1.0, (12.0 - altitude) / 20.0));
        cloudFill = RGB.lerp(new RGB(95, 95, 95), new RGB(30, 30, 34), t).toCss();
      } else if (weatherState === 'clear') {
        if (altitude > 5.0) {
          cloudFill = '#FFFFFF';
        } else if (altitude > -2.0) {
          const t = (5.0 - altitude) / 7.0;
          cloudFill = RGB.lerp(new RGB(255, 255, 255), new RGB(255, 182, 193), t).toCss();
        } else {
          const t = Math.min(1.0, (-altitude - 2.0) / 6.0);
          cloudFill = RGB.lerp(new RGB(255, 182, 193), new RGB(106, 27, 154), t).toCss();
        }
      } else {
        if (altitude > 5.0) {
          cloudFill = cloud.layer === 'high' ? '#FFFFFF' : '#E0E0E0';
        } else if (altitude > -2.0) {
          const t = (5.0 - altitude) / 7.0;
          if (cloud.layer === 'high') {
            cloudFill = RGB.lerp(new RGB(255, 255, 255), new RGB(255, 128, 171), t).toCss();
          } else if (cloud.layer === 'mid') {
            cloudFill = RGB.lerp(new RGB(255, 255, 255), new RGB(255, 167, 38), t).toCss();
          } else {
            cloudFill = RGB.lerp(new RGB(224, 224, 224), new RGB(255, 110, 64), t).toCss();
          }
        } else {
          const t = Math.min(1.0, (-altitude - 2.0) / 6.0);
          if (cloud.layer === 'high') {
            cloudFill = RGB.lerp(new RGB(255, 128, 171), new RGB(74, 20, 140), t).toCss();
          } else if (cloud.layer === 'mid') {
            cloudFill = RGB.lerp(new RGB(255, 167, 38), new RGB(136, 14, 79), t).toCss();
          } else {
            cloudFill = RGB.lerp(new RGB(255, 110, 64), new RGB(49, 27, 146), t).toCss();
          }
        }
      }

      if (cloud.dom) {
        cloud.dom.setAttribute('transform', `translate(${cloud.x}, ${cloud.y}) scale(${cloud.scale})`);
        cloud.dom.setAttribute('fill', cloudFill);
      }
    });

    const hudTime = document.getElementById('sim-hud-time');
    const hudStatus = document.getElementById('sim-hud-status');
    const hudAltitude = document.getElementById('sim-hud-altitude');
    const hudScore = document.getElementById('sim-hud-score');

    let displayMin = 18 * 60; 
    if (altitude >= 0) {
      const t = (12 - altitude) / 12;
      displayMin = 18 * 60 + t * 102;
    } else {
      const t = (-altitude) / 8;
      displayMin = 19 * 60 + 42 + t * 63;
    }
    const hours = Math.floor(displayMin / 60);
    const minutes = Math.floor(displayMin % 60);
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    if (hudTime) hudTime.textContent = timeStr;
    if (hudAltitude) hudAltitude.textContent = `Alt: ${altitude.toFixed(1)}°`;

    let statusText = 'Golden Hour';
    let scoreVal = 30;

    if (weatherState === 'overcast') {
      statusText = 'Heavy Rain / Overcast';
      scoreVal = 0;
    } else {
      if (altitude > 5.0) {
        statusText = 'Golden Hour';
      } else if (altitude > -2.0) {
        statusText = 'Sunset Peak';
      } else {
        statusText = 'Twilight Glow';
      }

      if (weatherState === 'clear') {
        scoreVal = 53;
      } else {
        const dist = Math.abs(altitude - 0.5);
        const factor = Math.max(0, 1.0 - dist / 6.0);
        scoreVal = Math.round(35 + factor * 54);
      }
    }

    if (hudStatus) hudStatus.textContent = statusText;
    if (hudScore) hudScore.textContent = `Score: ${scoreVal}`;

    requestAnimationFrame(updateTick);
  };

  requestAnimationFrame(updateTick);


});
