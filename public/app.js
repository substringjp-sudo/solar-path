// BeforeGlow Web Application Interactive Controller

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  // 페이지별 SEO 메타 태그 정의
  const PAGE_META = {
    home: {
      title: 'BeforeGlow - 스마트 노을 & 일출 예보 트래커 | Sunset & Sunrise Tracker',
      description: 'BeforeGlow와 함께 인생 최고의 골든아워를 만나보세요. 3D 지형 노을 시뮬레이션, 실시간 AR 태양 추적, 정밀 기상 분석 및 글로벌 갤러리 공유 서비스를 제공합니다.',
      canonical: 'https://bglow.pplaner.com/',
    },
    features: {
      title: 'BeforeGlow 주요 기능 - Features | 3D 지형 시뮬레이션, AR 태양 추적',
      description: '3D 실제 지형 기반 노을 시뮬레이션, AR 카메라 태양 궤적 추적, 기상 노을 점수 예측, 골든아워 알림 등 BeforeGlow의 핵심 기능을 확인하세요.',
      canonical: 'https://bglow.pplaner.com/#features',
    },
    gallery: {
      title: 'BeforeGlow 갤러리 - 글로벌 노을 사진 Gallery | 전 세계 노을',
      description: 'BeforeGlow 사용자들이 기록하고 공유한 전 세계의 실시간 노을 & 일출 사진. 사생활 보호를 위해 업로드 1시간 후 공개됩니다.',
      canonical: 'https://bglow.pplaner.com/#gallery',
    },
    guides: {
      title: 'BeforeGlow 가이드 - 노을 시뮬레이션 & 기상 가이드 Guides',
      description: '아름다운 노을을 포착하기 위한 기상 산란 법칙, 구름 종류별 노을 효과, 3D 지형 시뮬레이션 활용 가이드를 소개합니다.',
      canonical: 'https://bglow.pplaner.com/#guides',
    },
    isolain: {
      title: 'Isolain - 등시선 태양 지도 시뮬레이터 | BeforeGlow Solar Map',
      description: '전 세계 어디서든 태양의 일출·일몰 등시선(Isolain)을 3D 지구본 위에서 시각화합니다. 실시간 터미네이터 라인, 태양 위치, 위치별 상세 태양 정보를 확인하세요.',
      canonical: 'https://bglow.pplaner.com/#isolain',
    },
    credits: {
      title: 'BeforeGlow 크레딧 - 오픈소스 라이선스 & 기여 Credits',
      description: 'BeforeGlow에서 활용한 오픈소스 라이브러리, 공공 지리데이터 서비스, API 출처 및 라이선스 정보를 확인하세요.',
      canonical: 'https://bglow.pplaner.com/#credits',
    },
  };

  function updatePageMeta(pageId) {
    const meta = PAGE_META[pageId] || PAGE_META.home;
    const BASE_URL = 'https://bglow.pplaner.com/';

    // Title
    document.title = meta.title;
    const elTitle = document.getElementById('meta-title');
    if (elTitle) elTitle.textContent = meta.title;

    // Description
    const elDesc = document.getElementById('meta-description');
    if (elDesc) elDesc.setAttribute('content', meta.description);

    // Canonical
    const elCanon = document.getElementById('meta-canonical');
    if (elCanon) elCanon.setAttribute('href', meta.canonical);

    // OG
    const elOgTitle = document.getElementById('og-title');
    if (elOgTitle) elOgTitle.setAttribute('content', meta.title);
    const elOgDesc = document.getElementById('og-description');
    if (elOgDesc) elOgDesc.setAttribute('content', meta.description);
    const elOgUrl = document.getElementById('og-url');
    if (elOgUrl) elOgUrl.setAttribute('content', meta.canonical);

    // Twitter
    const elTwTitle = document.getElementById('tw-title');
    if (elTwTitle) elTwTitle.setAttribute('content', meta.title);
    const elTwDesc = document.getElementById('tw-description');
    if (elTwDesc) elTwDesc.setAttribute('content', meta.description);
  }

  // ============================================================
  // 0. SPA Section Router
  // ============================================================
  const ALL_PAGES = ['home', 'features', 'gallery', 'guides', 'credits', 'isolain'];

  function showPage(pageId) {
    const validId = ALL_PAGES.includes(pageId) ? pageId : 'home';

    // 모든 page-section 숨김
    ALL_PAGES.forEach(id => {
      const el = document.getElementById('page-' + id);
      if (el) el.style.display = 'none';
    });

    // 대상 page-section만 표시
    const target = document.getElementById('page-' + validId);
    if (target) target.style.display = 'block';

    // 활성 nav 링크 강조
    document.querySelectorAll('.nav-link[data-page]').forEach(a => a.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-page="${validId}"]`);
    if (activeLink) activeLink.classList.add('active');

    // URL 해시 업데이트 (home은 클린 URL 유지)
    if (validId === 'home') {
      history.pushState(null, '', location.pathname);
    } else {
      history.pushState(null, '', '#' + validId);
    }

    // 페이지별 SEO 메타 태그 업데이트
    updatePageMeta(validId);

    // 페이지 상단으로 스크롤
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // nav-link[data-page] 클릭 이벤트
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showPage(link.getAttribute('data-page'));
    });
  });

  // 로고 클릭 → 홈으로
  const logoBtn = document.getElementById('logo-home-btn');
  if (logoBtn) {
    logoBtn.addEventListener('click', () => showPage('home'));
  }

  // 뒤로가기/앞으로가기 지원
  window.addEventListener('popstate', () => {
    const hash = location.hash.replace('#', '') || 'home';
    showPage(hash);
  });

  // 초기 로드 시 해시로 페이지 결정
  const initPage = location.hash.replace('#', '') || 'home';
  showPage(initPage);

  // 1. Phone Simulator Viewport Tab Switcher (Updated to Top Navigation Toggle)
  const phoneNavBtns = document.querySelectorAll('.phone-nav-btn');
  const simScreens = document.querySelectorAll('.sim-screen');
  const phoneNavIndicator = document.getElementById('phoneNavIndicator');
  const phoneDateNav = document.getElementById('phoneDateNav');

  phoneNavBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      const targetScreenId = btn.getAttribute('data-target');

      // Deactivate all buttons and screens
      phoneNavBtns.forEach(b => b.classList.remove('active'));
      simScreens.forEach(s => s.classList.remove('active'));

      // Activate clicked button and matched screen
      btn.classList.add('active');
      const targetScreen = document.getElementById(targetScreenId);
      if (targetScreen) {
        targetScreen.classList.add('active');
      }

      // Slide the indicator background (44px * index)
      if (phoneNavIndicator) {
        phoneNavIndicator.style.transform = `translateX(${index * 44}px)`;
      }

      // Show/Hide Date Navigation depending on active screen (hidden in Gallery)
      if (phoneDateNav) {
        if (targetScreenId === 'screen-gallery') {
          phoneDateNav.style.opacity = '0';
          phoneDateNav.style.pointerEvents = 'none';
        } else {
          phoneDateNav.style.opacity = '1';
          phoneDateNav.style.pointerEvents = 'auto';
        }
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

  // 2-2. Cloud Guide Filter Controller
  const cloudFilterBtns = document.querySelectorAll('.cloud-filter-btn');
  const cloudRows = document.querySelectorAll('.cloud-row');

  cloudFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter');

      // Update active button style
      cloudFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide rows
      cloudRows.forEach(row => {
        const altType = row.getAttribute('data-alt');
        if (filter === 'all' || filter === altType) {
          row.classList.remove('hidden');
        } else {
          row.classList.add('hidden');
        }
      });
    });
  });

  // 3. Navbar Scroll Interaction
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  // 4. Download Alert Simulation (removed preventDefault to allow play store link navigation)

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
      { shape: '#cloud-shape-cirrus', scale: 0.8, x: 50, y: 30, speed: 0.15, layer: 'high', width: 220, distance: 2.2 },
      { shape: '#cloud-shape-cirrus', scale: 0.7, x: 320, y: 45, speed: 0.12, layer: 'high', width: 220, distance: 2.5 }
    ],
    cloudy: [
      { shape: '#cloud-shape-altocumulus', scale: 0.75, x: -30, y: 50, speed: 0.25, layer: 'mid', width: 170, distance: 1.5 },
      { shape: '#cloud-shape-cumulonimbus', scale: 1.2, x: 80, y: 20, speed: 0.3, layer: 'low', width: 160, distance: 1.8 },
      { shape: '#cloud-shape-cumulus-1', scale: 0.6, x: 120, y: 70, speed: 0.35, layer: 'low', width: 190, distance: 1.1 },
      { shape: '#cloud-shape-cumulus-2', scale: 0.8, x: 280, y: 95, speed: 0.28, layer: 'low', width: 215, distance: 0.9 },
      { shape: '#cloud-shape-cumulonimbus', scale: 1.8, x: 20, y: -10, speed: 0.45, layer: 'low', width: 160, distance: 0.75 },
      { shape: '#cloud-shape-altocumulus', scale: 0.9, x: 420, y: 60, speed: 0.22, layer: 'mid', width: 170, distance: 1.4 },
      { shape: '#cloud-shape-cumulus-1', scale: 0.7, x: 190, y: 120, speed: 0.32, layer: 'low', width: 190, distance: 0.8 }
    ],
    overcast: [
      { shape: '#cloud-shape-nimbostratus', scale: 1.8, x: -100, y: -10, speed: 0.3, layer: 'low', width: 200, distance: 1.2 },
      { shape: '#cloud-shape-cumulonimbus', scale: 1.6, x: 50, y: 5, speed: 0.32, layer: 'low', width: 160, distance: 1.4 },
      { shape: '#cloud-shape-nimbostratus', scale: 1.7, x: 100, y: 10, speed: 0.35, layer: 'low', width: 200, distance: 1.0 },
      { shape: '#cloud-shape-nimbostratus', scale: 1.8, x: 300, y: -5, speed: 0.25, layer: 'low', width: 200, distance: 1.3 },
      { shape: '#cloud-shape-cumulonimbus', scale: 2.1, x: 220, y: -15, speed: 0.5, layer: 'low', width: 160, distance: 0.7 },
      { shape: '#cloud-shape-nimbostratus', scale: 1.7, x: 500, y: 5, speed: 0.32, layer: 'low', width: 200, distance: 1.1 },
      { shape: '#cloud-shape-cumulus-2', scale: 1.6, x: -50, y: 30, speed: 0.4, layer: 'low', width: 215, distance: 0.95 },
      { shape: '#cloud-shape-cumulus-2', scale: 1.5, x: 150, y: 50, speed: 0.45, layer: 'low', width: 215, distance: 1.05 },
      { shape: '#cloud-shape-cumulus-2', scale: 1.6, x: 350, y: 25, speed: 0.38, layer: 'low', width: 215, distance: 0.9 },
      { shape: '#cloud-shape-cumulus-2', scale: 1.5, x: 550, y: 45, speed: 0.42, layer: 'low', width: 215, distance: 1.1 },
      { shape: '#cloud-shape-cumulus-1', scale: 1.5, x: 0, y: 70, speed: 0.5, layer: 'low', width: 190, distance: 0.8 },
      { shape: '#cloud-shape-cumulus-1', scale: 1.6, x: 200, y: 90, speed: 0.48, layer: 'low', width: 190, distance: 0.85 },
      { shape: '#cloud-shape-cumulus-1', scale: 1.5, x: 400, y: 80, speed: 0.52, layer: 'low', width: 190, distance: 0.75 },
      { shape: '#cloud-shape-cumulus-1', scale: 1.6, x: 600, y: 95, speed: 0.46, layer: 'low', width: 190, distance: 0.9 }
    ]
  };

  let weatherState = 'clear';
  let activeClouds = [];
  let phoneActiveClouds = [];
  const cloudGroup = document.getElementById('simCloudGroup');
  const phoneCloudGroup = document.getElementById('phoneCloudGroup');

  const initCloudAssets = (state) => {
    if (!cloudGroup) return;
    cloudGroup.innerHTML = '';
    activeClouds = JSON.parse(JSON.stringify(cloudConfigs[state] || cloudConfigs.clear));

    // Z-ordering: 거리가 먼 구름이 먼저 추가되어 뒤에 깔리게 정렬
    activeClouds.sort((a, b) => (b.distance || 1.0) - (a.distance || 1.0));

    activeClouds.forEach((cloud) => {
      const dist = cloud.distance || 1.0;
      cloud.baseScale = cloud.scale;
      cloud.scale = cloud.baseScale / dist;

      cloud.baseSpeed = cloud.speed;
      cloud.speed = cloud.baseSpeed / dist;

      const useNode = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      useNode.setAttribute('href', cloud.shape);
      useNode.setAttribute('class', `sim-svg-cloud layer-${cloud.layer}`);
      
      // 대기 원근법 적용: 멀수록 약간 흐릿해짐
      const opacity = Math.max(0.35, Math.min(1.0, 1.25 - (dist - 1.0) * 0.35));
      useNode.setAttribute('opacity', opacity);

      cloudGroup.appendChild(useNode);
      cloud.dom = useNode;
    });
  };

  const initPhoneCloudAssets = (state) => {
    if (!phoneCloudGroup) return;
    phoneCloudGroup.innerHTML = '';
    phoneActiveClouds = JSON.parse(JSON.stringify(cloudConfigs[state] || cloudConfigs.clear));

    // Z-ordering
    phoneActiveClouds.sort((a, b) => (b.distance || 1.0) - (a.distance || 1.0));

    phoneActiveClouds.forEach((cloud) => {
      const dist = cloud.distance || 1.0;
      
      // 폰 시뮬레이터 크기(250x200)에 맞춰 좌표 및 스케일 0.5배 보정 적용
      cloud.x = cloud.x * 0.5;
      cloud.y = (cloud.y * 0.5) - 5; // y축 오프셋 보정
      
      cloud.baseScale = cloud.scale * 0.5;
      cloud.scale = cloud.baseScale / dist;
      
      cloud.baseSpeed = cloud.speed * 0.5;
      cloud.speed = cloud.baseSpeed / dist;
      cloud.width = cloud.width * 0.5;

      const useNode = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      useNode.setAttribute('href', cloud.shape);
      useNode.setAttribute('class', `sim-svg-cloud layer-${cloud.layer}`);
      
      const opacity = Math.max(0.35, Math.min(1.0, 1.25 - (dist - 1.0) * 0.35));
      useNode.setAttribute('opacity', opacity);

      phoneCloudGroup.appendChild(useNode);
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
    initPhoneCloudAssets(state); // 폰용 구름 에셋도 동일 기상으로 동기화 로드

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

    // 폰 시뮬레이터 태양 동기화
    const phoneSunY = 145 - (altitude * 6.5);
    const phoneSunX = 125;

    const phoneSunDisk = document.getElementById('phoneSunDisk');
    const phoneSunGlowOuter = document.getElementById('phoneSunGlowOuter');
    const phoneSunGlowInner = document.getElementById('phoneSunGlowInner');

    if (phoneSunDisk) {
      phoneSunDisk.setAttribute('cx', phoneSunX);
      phoneSunDisk.setAttribute('cy', phoneSunY);
    }
    if (phoneSunGlowOuter) {
      phoneSunGlowOuter.setAttribute('cx', phoneSunX);
      phoneSunGlowOuter.setAttribute('cy', phoneSunY);
    }
    if (phoneSunGlowInner) {
      phoneSunGlowInner.setAttribute('cx', phoneSunX);
      phoneSunGlowInner.setAttribute('cy', phoneSunY);
    }

    const skyColors = getInterpolatedSky(weatherState, altitude);
    const stop0 = document.getElementById('skyStop0');
    const stop1 = document.getElementById('skyStop1');
    const stop2 = document.getElementById('skyStop2');

    if (stop0) stop0.setAttribute('stop-color', skyColors[0]);
    if (stop1) stop1.setAttribute('stop-color', skyColors[1]);
    if (stop2) stop2.setAttribute('stop-color', skyColors[2]);

    // 폰 시뮬레이터 하늘 동기화
    const phoneStop0 = document.getElementById('phoneSkyStop0');
    const phoneStop1 = document.getElementById('phoneSkyStop1');
    const phoneStop2 = document.getElementById('phoneSkyStop2');
    const phoneStop3 = document.getElementById('phoneSkyStop3');

    if (phoneStop0) phoneStop0.setAttribute('stop-color', skyColors[0]);
    if (phoneStop1) phoneStop1.setAttribute('stop-color', skyColors[1]);
    if (phoneStop2) phoneStop2.setAttribute('stop-color', skyColors[2]);
    if (phoneStop3) phoneStop3.setAttribute('stop-color', altitude < 0 ? '#020008' : '#100305');

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

    // 폰 시뮬레이터 태양 색상/투명도 동기화
    if (phoneSunDisk) {
      phoneSunDisk.setAttribute('fill', sunColor);
      phoneSunDisk.style.opacity = sunOpacity;
    }
    if (phoneSunGlowOuter) {
      phoneSunGlowOuter.setAttribute('fill', outerGlowColor);
      phoneSunGlowOuter.style.opacity = sunOpacity;
    }
    if (phoneSunGlowInner) {
      phoneSunGlowInner.setAttribute('fill', innerGlowColor);
      phoneSunGlowInner.style.opacity = sunOpacity;
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

    // 폰 시뮬레이터 구름 동기화 제어
    phoneActiveClouds.forEach(cloud => {
      cloud.x += cloud.speed;
      const cloudRightBoundary = 250;
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

  // 6. Premium Offline Mock Photos Data Generator
  const getMockPhotos = () => {
    return [
      {
        id: 'mock1',
        imageUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
        locationName: 'Namsan Tower, Seoul',
        userName: 'SunsetLover',
        timestamp: Date.now() - 7200000, // 2 hours ago (Visible)
        landscapeScore: 4.8,
        weatherScore: 4.7,
        deviceAzimuth: 294.5,
        devicePitch: 3.2
      },
      {
        id: 'mock2',
        imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
        locationName: 'Haeundae Beach, Busan',
        userName: 'OceanBreeze',
        timestamp: Date.now() - 10800000, // 3 hours ago (Visible)
        landscapeScore: 4.9,
        weatherScore: 4.8,
        deviceAzimuth: 115.2,
        devicePitch: 2.1
      },
      {
        id: 'mock3',
        imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=600&q=80',
        locationName: 'Hallasan, Jeju',
        userName: 'Trekkie99',
        timestamp: Date.now() - 5400000, // 1.5 hours ago (Visible)
        landscapeScore: 4.7,
        weatherScore: 4.5,
        deviceAzimuth: 180.0,
        devicePitch: -1.5
      },
      {
        id: 'mock4',
        imageUrl: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=600&q=80',
        locationName: 'Gwangalli Bridge, Busan',
        userName: 'BridgeWalker',
        timestamp: Date.now() - 4000000, // 1.1 hours ago (Visible)
        landscapeScore: 4.6,
        weatherScore: 4.4,
        deviceAzimuth: 90.0,
        devicePitch: 0.5
      }
    ];
  };

  // 7. Dynamic Web Gallery Renderer with 1-Hour Delay filter
  const renderWebGallery = (photos) => {
    const grid = document.getElementById('web-gallery-grid');
    const phoneViewport = document.querySelector('#screen-gallery .gallery-viewport');
    if (!grid) return;

    grid.innerHTML = '';

    const now = Date.now();
    const publishedPhotos = photos.filter(p => {
      // 신변 및 사생활 보호를 위해 업로드 후 최소 1시간(3,600,000ms) 경과된 것만 공개
      return now - p.timestamp >= 3600000;
    });

    if (publishedPhotos.length === 0) {
      grid.innerHTML = `
        <div class="gallery-empty-placeholder">
          <i data-lucide="image" style="width: 48px; height: 48px;"></i>
          <h4>아직 공개된 사진이 없습니다</h4>
          <p>BeforeGlow 앱에서 공유된 사진들은 사생활 보호를 위해 업로드 1시간 후에 이곳에 노출됩니다.</p>
        </div>
      `;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    // 1) Web Main Gallery Rendering
    publishedPhotos.forEach(p => {
      const card = document.createElement('div');
      card.className = 'web-gallery-card';

      // Compass azimuth to cardinal labels helper
      const getDirText = (az) => {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return dirs[Math.round(az / 45) % 8];
      };

      const formattedDate = new Date(p.timestamp).toLocaleDateString();
      const avgScore = p.landscapeScore && p.weatherScore
        ? ((p.landscapeScore + p.weatherScore) / 2).toFixed(1)
        : (p.landscapeScore || p.weatherScore || 5.0).toFixed(1);

      card.innerHTML = `
        <div class="web-gallery-image-wrapper">
          <img class="web-gallery-image" src="${p.imageUrl}" alt="${p.locationName || 'Sunset'}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80'">
          ${p.deviceAzimuth !== undefined && p.devicePitch !== undefined 
            ? `<div class="web-gallery-hud-overlay">
                 <i data-lucide="compass" style="width: 12px; height: 12px;"></i>
                 <span>🧭 ${getDirText(p.deviceAzimuth)} • ${Math.round(p.devicePitch)}°</span>
               </div>`
            : ''
          }
          <div class="web-gallery-score-badge">
            <i data-lucide="star" style="width: 12px; height: 12px; fill: #FFA500;"></i>
            <span>${avgScore}</span>
          </div>
        </div>
        <div class="web-gallery-card-info">
          <h4 class="web-gallery-loc">${p.locationName || 'Golden Hour Spot'}</h4>
          <div class="web-gallery-meta-bottom">
            <span class="web-gallery-user">
              <i data-lucide="user" style="width: 12px; height: 12px;"></i>
              <span>${p.userName || 'Anonymous'}</span>
            </span>
            <span class="web-gallery-date">${formattedDate}</span>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

    // 2) Phone Mock Simulator Gallery Rendering (Only when actual photos exist)
    if (phoneViewport) {
      phoneViewport.innerHTML = '';
      publishedPhotos.slice(0, 4).forEach(p => {
        const card = document.createElement('div');
        card.className = 'gallery-card';

        const avgScore = p.landscapeScore && p.weatherScore
          ? ((p.landscapeScore + p.weatherScore) / 2).toFixed(1)
          : (p.landscapeScore || p.weatherScore || 5.0).toFixed(1);

        card.innerHTML = `
          <div class="card-img" style="background-image: url('${p.imageUrl}'); background-size: cover; background-position: center; width: 100%; height: 100%;">
          </div>
          <div class="card-info">
            <span class="card-loc" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px;">
              ${p.locationName ? p.locationName.split(' at ')[0] : 'Golden Spot'}
            </span>
            <span class="card-score">★ ${avgScore}</span>
          </div>
        `;
        phoneViewport.appendChild(card);
      });
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  };

  // 8. Initialize and Listen to Firebase Firestore 'global_photos'
  const startGalleryListening = () => {
    let db = null;
    
    if (typeof firebase !== 'undefined') {
      try {
        const app = firebase.app();
        // Custom database ID 'beforeglow' 사용 (v10 compat 공식 스펙 적용)
        db = firebase.firestore(app, 'beforeglow');
      } catch (err) {
        console.warn('Firebase app is not initialized via init.js yet. Trying default...', err);
        try {
          db = firebase.firestore();
        } catch (e) {
          console.error('Firebase fallback initialization failed:', e);
        }
      }
    }

    if (db) {
      console.log('Successfully connected to Firestore database: beforeglow');
      db.collection('global_photos')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot((snapshot) => {
          const photos = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            photos.push({ id: doc.id, ...data });
          });
          renderWebGallery(photos);
        }, (error) => {
          console.error("Firestore subscription error:", error);
          renderWebGallery(getMockPhotos());
        });
    } else {
      console.log('Loading default premium simulator mockup photos (No SDK).');
      renderWebGallery(getMockPhotos());
    }
  };

  startGalleryListening();

  // 6. Beta Tester Signup Controller
  const betaForm = document.getElementById('beta-form');
  const betaEmailInput = document.getElementById('beta-email');
  const betaSubmitBtn = document.getElementById('btn-beta-submit');
  const betaStatusMsg = document.getElementById('beta-status-msg');

  if (betaForm) {
    betaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = betaEmailInput.value.trim();
      if (!email) return;

      // UI loading state
      betaSubmitBtn.disabled = true;
      const originalBtnHtml = betaSubmitBtn.innerHTML;
      betaSubmitBtn.innerHTML = `
        <span class="spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></span>
        <span>신청 중...</span>
      `;
      
      betaStatusMsg.className = 'beta-status-msg';
      betaStatusMsg.classList.add('hidden');

      try {
        const registerBetaTester = firebase.app().functions().httpsCallable('registerBetaTester');
        const result = await registerBetaTester({ email });
        
        if (result.data && result.data.success) {
          betaStatusMsg.textContent = result.data.message;
          betaStatusMsg.classList.add('success');
          betaStatusMsg.classList.remove('hidden');
          betaEmailInput.value = ''; // Input clear
        } else {
          throw new Error('신청 처리 중 알 수 없는 응답이 반환되었습니다.');
        }
      } catch (error) {
        console.error('Beta tester registration failed:', error);
        betaStatusMsg.textContent = error.message || '등록 중 에러가 발생했습니다. 다시 시도해 주세요.';
        betaStatusMsg.classList.add('error');
        betaStatusMsg.classList.remove('hidden');
      } finally {
        betaSubmitBtn.disabled = false;
        betaSubmitBtn.innerHTML = originalBtnHtml;
      }
    });
  }
});
