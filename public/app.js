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


  // 6. Interactive Rayleigh & Mie Scattering Visualization Engine
  const scatterViewport = document.getElementById('scatter-viewport-demo');
  if (!scatterViewport) return;

  const scatterTabs = document.querySelectorAll('.scatter-tab-btn');
  const scatterDescs = document.querySelectorAll('.scatter-desc');
  const groupRayleigh = document.getElementById('group-rayleigh-demo');
  const groupMie = document.getElementById('group-mie-demo');
  const mieSliderContainer = document.getElementById('mie-slider-container');

  let activeScatter = 'rayleigh';

  scatterTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-scatter');
      activeScatter = type;

      // Toggle tab buttons
      scatterTabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');

      // Toggle description blocks
      scatterDescs.forEach(d => d.classList.remove('active'));
      document.getElementById(`desc-${type}`).classList.add('active');

      // Toggle SVG groups & sliders
      if (type === 'rayleigh') {
        groupRayleigh.setAttribute('display', 'inline');
        groupMie.setAttribute('display', 'none');
        mieSliderContainer.style.display = 'none';
      } else {
        groupRayleigh.setAttribute('display', 'none');
        groupMie.setAttribute('display', 'inline');
        mieSliderContainer.style.display = 'flex';
      }
    });
  });

  // 6A. Rayleigh Scattering Particle System (60fps simulation)
  const rayleighRaysGroup = document.getElementById('rayleigh-rays');
  const rayleighSun = document.getElementById('rayleigh-sun');
  const rayleighLabel = document.getElementById('rayleigh-state-label');
  
  let rayleighParticles = [];
  const observerX = 250;
  const observerY = 220;
  
  // 6B. Mie Scattering Particle System
  const mieParticlesGroup = document.getElementById('mie-particles');
  const mieRaysGroup = document.getElementById('mie-rays');
  const mieSunGlow = document.getElementById('mie-sun-glow');
  const mieLabel = document.getElementById('mie-state-label');
  const mieHumiditySlider = document.getElementById('mie-humidity-slider');
  const mieHumidityVal = document.getElementById('mie-humidity-val');
  const mieHumidityFade = document.getElementById('mie-humidity-fade');

  let mieParticles = [];
  let mieWaves = [];
  let humidity = 45;

  // Initialize 12 large aerosol particles for Mie Scattering
  for (let i = 0; i < 14; i++) {
    mieParticles.push({
      x: 50 + Math.random() * 400,
      y: 50 + Math.random() * 150,
      r: 3.5 + Math.random() * 4,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      dom: null
    });
  }

  const initMieDom = () => {
    if (!mieParticlesGroup) return;
    mieParticlesGroup.innerHTML = '';
    mieParticles.forEach(p => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', p.r);
      circle.setAttribute('fill', 'rgba(251, 192, 45, 0.45)');
      circle.setAttribute('stroke', 'rgba(120, 80, 0, 0.35)');
      circle.setAttribute('stroke-width', '1');
      mieParticlesGroup.appendChild(circle);
      p.dom = circle;
    });
  };
  initMieDom();

  // Slider event listener
  if (mieHumiditySlider && mieHumidityVal && mieHumidityFade) {
    mieHumiditySlider.addEventListener('input', (e) => {
      humidity = parseInt(e.target.value, 10);
      let humidityText = `${humidity}%`;
      if (humidity < 40) {
        humidityText += ' (건조 - 쨍한 노을)';
      } else if (humidity < 70) {
        humidityText += ' (보통 - 골든 글로우)';
      } else if (humidity < 85) {
        humidityText += ' (다습 - 노을빛 감쇄)';
      } else {
        humidityText += ' (매우 습함 - 광선 흡수 차단)';
      }
      mieHumidityVal.textContent = humidityText;

      // Update humidity fade dark overlay (now a light mist overlay)
      const maxOverlayOpacity = 0.78;
      const opacity = Math.max(0, (humidity - 35) / 60) * maxOverlayOpacity;
      mieHumidityFade.setAttribute('opacity', Math.max(0, Math.min(maxOverlayOpacity, opacity)));
    });
  }

  // Animation Loop for Scatter Viewports
  const scatterTick = () => {
    const now = Date.now();

    if (activeScatter === 'rayleigh') {
      // 1. Rayleigh: Solar altitude motion loop (20s cycle)
      const rFactor = (now % 20000) / 20000;
      const rRad = rFactor * 2 * Math.PI;
      
      // 태양이 포물선을 돌며 위(낮)와 아래(일몰)를 왕복
      const sunAltDeg = Math.sin(rRad) * 12 + 1; // -11° ~ +13°
      const isDay = sunAltDeg > 2.0;

      // Y position mapping
      const sY = 175 - (sunAltDeg * 6.0); // 13°일 때 Y=97 (높음), -11°일 때 Y=241 (완전 진 상태)
      const sX = 80 + rFactor * 340;      // 왼쪽에서 오른쪽으로 궤적 이동

      // 1-1. Rayleigh 대기 돔 그라데이션 동적 보간
      const atmosStop0 = document.getElementById('atmosStop0');
      const atmosStop1 = document.getElementById('atmosStop1');
      if (atmosStop0 && atmosStop1) {
        let bottomAtmos, topAtmos;
        let atmosOpacity = 0.7;
        if (sunAltDeg > 5.0) {
          // 낮: 활기찬 푸른 대기층
          bottomAtmos = new RGB(33, 150, 243).toCss(0.8);
          topAtmos = new RGB(33, 150, 243).toCss(0.0);
          atmosOpacity = 0.7;
        } else if (sunAltDeg > -1.0) {
          // 일몰: 아래는 피빛 오렌지, 위는 은은한 보랏빛 대기
          const t = (5.0 - sunAltDeg) / 6.0;
          bottomAtmos = RGB.lerp(new RGB(33, 150, 243), new RGB(255, 87, 34), t).toCss(0.85);
          topAtmos = RGB.lerp(new RGB(33, 150, 243), new RGB(156, 39, 176), t).toCss(t * 0.5);
          atmosOpacity = 0.75;
        } else {
          // 황혼 및 밤: 흰색 배경 위에 어두운 밤하늘 대기를 돔 형태로 렌더링
          const t = Math.min(1.0, (-sunAltDeg - 1.0) / 6.0);
          bottomAtmos = RGB.lerp(new RGB(255, 87, 34), new RGB(13, 8, 28), t).toCss(0.9);
          topAtmos = RGB.lerp(new RGB(156, 39, 176), new RGB(5, 3, 12), t).toCss(0.35 + t * 0.45);
          atmosOpacity = 0.85;
        }
        atmosStop0.setAttribute('stop-color', bottomAtmos);
        atmosStop1.setAttribute('stop-color', topAtmos);
        const rayleighPath = document.querySelector('#group-rayleigh-demo path');
        if (rayleighPath) rayleighPath.setAttribute('opacity', atmosOpacity);
      }

      if (rayleighSun) {
        rayleighSun.setAttribute('cx', sX);
        rayleighSun.setAttribute('cy', sY);
        
        // 태양 색상 틴트 보간 (흰색 배경에서도 잘 보이게 채도 높임)
        if (sunAltDeg > 5.0) {
          rayleighSun.setAttribute('fill', '#ff9800');
          rayleighSun.setAttribute('stroke', '#e65100');
          rayleighSun.setAttribute('opacity', '1.0');
        } else if (sunAltDeg > -1.0) {
          const t = (5.0 - sunAltDeg) / 6.0;
          const sunRGB = RGB.lerp(new RGB(255, 152, 0), new RGB(211, 47, 47), t);
          rayleighSun.setAttribute('fill', sunRGB.toCss());
          rayleighSun.setAttribute('stroke', '#7f0000');
          rayleighSun.setAttribute('opacity', '1.0');
        } else {
          const t = Math.min(1.0, (-sunAltDeg - 1.0) / 4.0);
          rayleighSun.setAttribute('fill', '#7f0000');
          rayleighSun.setAttribute('stroke', '#3e0000');
          rayleighSun.setAttribute('opacity', Math.max(0, 1.0 - t));
        }
      }

      if (rayleighLabel) {
        if (sunAltDeg > 5.0) {
          rayleighLabel.textContent = `레일리 산란: 낮 (파란 파장 사방 산란)`;
          rayleighLabel.setAttribute('fill', '#0d47a1');
        } else if (sunAltDeg > 0.0) {
          rayleighLabel.textContent = `레일리 산란: 골든아워 (대기 통과거리 길어짐)`;
          rayleighLabel.setAttribute('fill', '#e65100');
        } else if (sunAltDeg > -6.0) {
          rayleighLabel.textContent = `레일리 산란: 일몰 절정 (붉은 파장만 도달)`;
          rayleighLabel.setAttribute('fill', '#c62828');
        } else {
          rayleighLabel.textContent = `레일리 산란: 황혼/밤 (빛 차단 상태)`;
          rayleighLabel.setAttribute('fill', '#4a148c');
        }
      }

      // 2. 파티클 생성 로직 (대략 3프레임마다 2개씩 발사)
      if (Math.random() < 0.35 && sunAltDeg > -6.0) {
        // 파티클 하나는 파란색, 하나는 빨간색 (태양 위치에서 관측자 250, 220을 향함)
        const angleToObserver = Math.atan2(observerY - sY, observerX - sX);
        
        // 발사각 분산 약간 부여
        const spread = (Math.random() - 0.5) * 0.15;
        const speed = 2.2 + Math.random() * 0.8;
        
        // 파란 파티클 (산란이 잘됨)
        rayleighParticles.push({
          x: sX,
          y: sY,
          vx: Math.cos(angleToObserver + spread) * speed,
          vy: Math.sin(angleToObserver + spread) * speed,
          type: 'blue',
          isScattered: false,
          scatterTicks: 0,
          opacity: 1.0
        });

        // 빨간 파티클 (통과력이 강함)
        rayleighParticles.push({
          x: sX,
          y: sY,
          vx: Math.cos(angleToObserver + spread) * (speed - 0.2), // 약간 느리게 이동하여 대비 극대화
          vy: Math.sin(angleToObserver + spread) * (speed - 0.2),
          type: 'red',
          isScattered: false,
          opacity: 1.0
        });
      }

      // 3. 파티클 물리 업데이트 및 DOM 렌더링
      if (rayleighRaysGroup) {
        rayleighRaysGroup.innerHTML = '';
        
        // 대기층의 상단 경계선 (Y좌표)
        // 대기가 둥근 곡선이므로 중심(250, 220) 기준 거리로 판정
        const atmosphereRadius = 135; 

        rayleighParticles.forEach((p, idx) => {
          const dx = p.x - observerX;
          const dy = p.y - observerY;
          const distToObserver = Math.sqrt(dx*dx + dy*dy);

          // 대기층 진입 여부
          const inAtmosphere = distToObserver <= atmosphereRadius;

          if (inAtmosphere && !p.isScattered) {
            if (p.type === 'blue') {
              // 파란색은 대기 속에서 산란 확률 발생
              // 태양 고도가 낮을 때(수평 입사) 대기 통과 거리가 더 길기 때문에 입사 초기(관측자로부터 멀리 떨어져 있을 때)에 바로 산란되도록 설정
              const pathLengthFactor = Math.max(1.0, (200 - sY) / 45); // 일몰일수록 증가 (1.0 -> 3.5)
              const scatterChance = 0.09 * pathLengthFactor;

              if (Math.random() < scatterChance) {
                p.isScattered = true;
                // 산란: 속도 방향을 사방으로 튕김
                const randomAngle = Math.random() * 2 * Math.PI;
                const scatterSpeed = 1.2 + Math.random() * 0.6;
                p.vx = Math.cos(randomAngle) * scatterSpeed;
                p.vy = Math.sin(randomAngle) * scatterSpeed;

                // --- [신규] 충돌 스파크 파편 추가 생성 ---
                for (let k = 0; k < 3; k++) {
                  const spAngle = randomAngle + (Math.random() - 0.5) * 1.5;
                  const spSpeed = scatterSpeed * (0.6 + Math.random() * 0.6);
                  rayleighParticles.push({
                    x: p.x,
                    y: p.y,
                    vx: Math.cos(spAngle) * spSpeed,
                    vy: Math.sin(spAngle) * spSpeed,
                    type: 'blue-spark',
                    isScattered: true,
                    scatterTicks: 10, // 조금 더 빨리 사라지게 10틱부터 시작
                    opacity: 0.95
                  });
                }
              }
            }
          }

          // 속도 업데이트
          p.x += p.vx;
          p.y += p.vy;

          if (p.isScattered) {
            p.scatterTicks++;
            p.opacity = Math.max(0, 1.0 - p.scatterTicks / 30); // 산란된 파티클은 30틱 동안 서서히 소멸
          }

          // 화면 경계 이탈 또는 수명 마감 확인
          let isDead = p.x < 0 || p.x > 500 || p.y < 0 || p.y > 280 || p.opacity <= 0;
          // 관측자 도달 시 사망
          if (distToObserver < 9) {
            isDead = true;
          }

          if (!isDead) {
            // SVG 엘리먼트 생성 및 추가
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', p.x.toFixed(1));
            circle.setAttribute('cy', p.y.toFixed(1));
            
            if (p.type === 'blue') {
              circle.setAttribute('r', p.isScattered ? '2.5' : '4.5');
              circle.setAttribute('fill', `rgba(13, 71, 161, ${p.opacity.toFixed(2)})`);
              circle.setAttribute('stroke', `rgba(255, 255, 255, ${p.opacity.toFixed(2)})`);
              circle.setAttribute('stroke-width', '0.6');
            } else if (p.type === 'blue-spark') {
              circle.setAttribute('r', '1.5');
              circle.setAttribute('fill', `rgba(30, 136, 229, ${p.opacity.toFixed(2)})`);
            } else {
              circle.setAttribute('r', '6.5');
              circle.setAttribute('fill', `rgba(211, 47, 47, ${p.opacity.toFixed(2)})`);
              circle.setAttribute('stroke', `rgba(255, 255, 255, ${p.opacity.toFixed(2)})`);
              circle.setAttribute('stroke-width', '0.6');
              // 빛 번짐을 가미
              circle.setAttribute('filter', 'url(#scatterGlow)');
            }
            rayleighRaysGroup.appendChild(circle);
          } else {
            // 배열에서 삭제
            rayleighParticles.splice(idx, 1);
          }
        });
      }

    } else {
      // 1. Mie: Large particle movement
      mieParticles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        // 경계 튕기기
        if (p.x < 15 || p.x > 485) p.vx *= -1;
        if (p.y < 45 || p.y > 200) p.vy *= -1;

        if (p.dom) {
          p.dom.setAttribute('cx', p.x.toFixed(1));
          p.dom.setAttribute('cy', p.y.toFixed(1));
        }
      });

      // 2. 태양으로부터 퍼지는 빔 및 파동 연산
      if (mieRaysGroup) {
        mieRaysGroup.innerHTML = '';

        // 습도가 높을수록 먼지 입자 크기를 비주얼적으로 부풀려 수증기 물방울 응결 현상 시각화
        const particleScale = 1.0 + ((humidity - 45) / 50) * 1.0;
        mieParticles.forEach(p => {
          if (p.dom) {
            p.dom.setAttribute('r', (p.r * particleScale).toFixed(1));
            // 습도가 높으면 입자가 탁한 백색 물방울처럼 표현됨
            const waterOpacity = 0.45 + (humidity / 100) * 0.5;
            p.dom.setAttribute('fill', `rgba(200, 200, 225, ${waterOpacity.toFixed(2)})`);
            p.dom.setAttribute('stroke', `rgba(80, 80, 100, ${(0.25 + (humidity / 100) * 0.35).toFixed(2)})`);
          }
        });

        // 태양에서 20방향으로 퍼지는 광선
        const rayCount = 20;
        const maxRayDist = 220 * (1.0 - (humidity / 100) * 0.65); // 습도가 높으면 광선이 안개에 가로막혀 감쇄
        
        for (let r = 0; r < rayCount; r++) {
          const angle = (r / rayCount) * 2 * Math.PI;
          const targetX = 250 + Math.cos(angle) * maxRayDist;
          const targetY = 120 + Math.sin(angle) * maxRayDist;

          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', '250');
          line.setAttribute('y1', '120');
          line.setAttribute('x2', targetX.toFixed(1));
          line.setAttribute('y2', targetY.toFixed(1));
          // 밝은 배경에서 광선이 선명하도록 오렌지-엠버 색상의 불투명도를 높임
          line.setAttribute('stroke', `rgba(224, 117, 0, ${(0.55 * (1.0 - humidity / 110)).toFixed(2)})`);
          line.setAttribute('stroke-width', '2.8');
          if (humidity > 70) {
            line.setAttribute('stroke-dasharray', '4,4'); // 광선 감쇄 분절화
          }
          mieRaysGroup.appendChild(line);

          // 광선 경로에 걸쳐 있는 입자가 있는지 체크해 전방 산란 에너지 구형 파동 생성
          mieParticles.forEach(p => {
            const x0 = p.x, y0 = p.y;
            const x1 = 250, y1 = 120;
            const x2 = targetX, y2 = targetY;

            const A = y2 - y1;
            const B = x1 - x2;
            const C = x2*y1 - x1*y2;
            const dist = Math.abs(A*x0 + B*y0 + C) / Math.sqrt(A*A + B*B);

            if (dist < p.r * particleScale + 6) {
              const distToSun = Math.sqrt((x0-250)*(x0-250) + (y0-120)*(y0-120));
              if (distToSun < maxRayDist && Math.random() < 0.05) {
                mieWaves.push({
                  x: x0,
                  y: y0,
                  r: p.r,
                  maxR: 25 + Math.random() * 30,
                  opacity: 0.85
                });
              }
            }
          });
        }

        // 파동 그리기
        mieWaves.forEach((w, idx) => {
          w.r += 1.0;
          w.opacity -= 0.03;

          if (w.opacity <= 0 || w.r >= w.maxR) {
            mieWaves.splice(idx, 1);
          } else {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', w.x.toFixed(1));
            circle.setAttribute('cy', w.y.toFixed(1));
            circle.setAttribute('r', w.r.toFixed(1));
            circle.setAttribute('fill', 'none');
            // 습도가 높으면 파동이 어두운 회색으로 탁해짐
            const waveColor = humidity > 75 ? '120, 120, 130' : '230, 81, 0';
            circle.setAttribute('stroke', `rgba(${waveColor}, ${w.opacity.toFixed(2)})`);
            circle.setAttribute('stroke-width', '1.5');
            mieRaysGroup.appendChild(circle);
          }
        });

        // 3. 습도 조절에 따른 태양 번짐(Glow) 변화
        if (mieSunGlow) {
          const glowSize = 35 + (humidity / 100) * 45;
          const glowOpacity = 0.65 * (1.0 - (humidity - 10) / 115);
          mieSunGlow.setAttribute('r', glowSize.toFixed(1));
          mieSunGlow.style.opacity = glowOpacity;
        }

        // 3-1. 습도 조절에 따른 미에 대기 돔 그라데이션 업데이트
        const mieAtmosStop0 = document.getElementById('mieAtmosStop0');
        const mieAtmosStop1 = document.getElementById('mieAtmosStop1');
        if (mieAtmosStop0 && mieAtmosStop1) {
          const hT = (humidity - 10) / 85;
          // 습도가 높을수록 파란빛/노란빛 산란 파동이 다 막히고 탁한 안개 회색(RGB 130, 130, 138)으로 차오름
          const startColor = RGB.lerp(new RGB(255, 152, 0), new RGB(130, 130, 138), hT).toCss(0.6 + hT * 0.25);
          const endColor = RGB.lerp(new RGB(255, 215, 0), new RGB(80, 80, 88), hT).toCss(hT * 0.2);
          
          mieAtmosStop0.setAttribute('stop-color', startColor);
          mieAtmosStop1.setAttribute('stop-color', endColor);
        }

        if (mieLabel) {
          if (humidity < 40) {
            mieLabel.textContent = `미에 산란: 건조 (전방 황금빛 산란 활성화)`;
            mieLabel.setAttribute('fill', '#b25e00'); // 하얀색 배경에 잘 보이는 어두운 앰버/브라운
          } else if (humidity < 70) {
            mieLabel.textContent = `미에 산란: 보통 (안정적인 골든 코로나)`;
            mieLabel.setAttribute('fill', '#a55200');
          } else if (humidity < 85) {
            mieLabel.textContent = `미에 산란: 다습 (수증기에 의한 광선 감쇄)`;
            mieLabel.setAttribute('fill', '#c62828');
          } else {
            mieLabel.textContent = `미에 산란: 매우 습함 (수증기가 노을빛을 완전 흡수)`;
            mieLabel.setAttribute('fill', '#8e1c1c');
          }
        }
      }
    }

    requestAnimationFrame(scatterTick);
  };

  // Start the scatter simulation updates
  requestAnimationFrame(scatterTick);
});
