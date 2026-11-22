/**
 * SkyScene3D 모듈을 브라우저에서 그대로 실행할 수 있게 준비합니다.
 *
 * tsc가 뱉은 ESM은 `from 'three'`, `from './x'` 처럼 브라우저가 해석할 수 없는
 * 지정자를 씁니다. 여기서 vendor 경로와 .js 확장자로만 고쳐서 넣습니다 —
 * **로직은 한 줄도 건드리지 않습니다.** 그래야 미리보기가 앱과 같은 코드가 됩니다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 이 파일이 든 저장소를 컴파일합니다. 예전엔 '/home/user/solar-path' 로 박혀 있어서, 다른 작업 트리
// (예: main 을 따로 풀어 둔 곳)에서 돌려도 늘 이 경로의 코드를 올렸습니다 — 기준선 비교가 조용히
// 같은 코드끼리의 비교가 됐습니다(§117.5). 중간 산출물도 트리마다 따로 둡니다.
const { PREVIEW, REPO_ROOT, SCRATCH } = require('./paths');
const SRC = REPO_ROOT;
const OUT = path.join(SCRATCH, 'esmbuild');
const APP = path.join(PREVIEW, 'app');

const ENTRIES = [
  'src/components/SkyScene3D/StarField.ts',
  'src/components/SkyScene3D/MilkyWayBand.ts',
  'src/components/SkyScene3D/CelestialPathMesh.ts',
  'src/components/SkyScene3D/cloudPlacement.ts',
  'src/components/SkyScene3D/cloudAtlas.ts',
  'src/components/SkyScene3D/CloudField.ts',
  'src/components/SkyScene3D/CloudDeck.ts',
  'src/components/SkyScene3D/SceneComposer.ts',
  'src/components/SkyScene3D/CloudSlab.ts',
  // §120 B — 위에서 본 구름. 슬랩 셰이더를 그대로 불러 씁니다.
  'src/components/SkyScene3D/CloudTopView.ts',
  // A/B 습작이 씁니다 — PR #14 시점 슬랩의 사본입니다. 앱은 임포트하지
  // 않습니다(번들에 안 들어갑니다). 지금 셰이더와 그때 셰이더를 **같은
  // 페이지에서 같은 입력**으로 나란히 그리려면 둘 다 있어야 합니다.
  'src/components/SkyScene3D/CloudSlabPrev.ts',
  'src/components/SkyScene3D/cloudCellTexture.ts',
  'src/components/SkyScene3D/Skydome.ts',
  'src/components/SkyScene3D/TerrainRing.ts',
  'src/components/SkyScene3D/groundProjection.ts',
  'src/components/SkyScene3D/TerrainField.ts',
  'src/components/SkyScene3D/BuildingField.ts',
  'src/components/SkyScene3D/SeaPlane.ts',
  'src/utils/mvtTiles.ts',
  'src/utils/buildingTiles.ts',
  // 박명광선 습작이 씁니다 — 광선의 원천(태양 원반)과, 끌려오면 안 되는
  // 밝은 것(달)이 화면에 없으면 무엇을 재는지 알 수 없습니다.
  'src/components/SkyScene3D/SunMesh.ts',
  'src/components/SkyScene3D/MoonMesh.ts',
  // 2D 수역 마스크. main 이 지면 셰이더를 uWaterTex2D 로 바꾸면서 필요해졌는데
  // 여기 목록에 안 들어와 있었습니다 — 그래서 물 하네스가 낡은 1D 텍스처를
  // 계속 쓰고 있었습니다.
  'src/utils/waterMask.ts',
  // DEM 타일 (해안선 계획 1단계)
  'src/utils/demTiles.ts',
  // 지형이 눈을 따라가는 기하(눈의 블록 안 타일 좌표 · 블록이 덮는가) — verify-eye-follow.js
  'src/utils/demGeometry.ts',
  'src/utils/geoMove.ts',
  // 지형 평탄화(건물 발자국 바닥 · 강 수면) — verify-dem-flatten.js
  'src/utils/demBuildingFlatten.ts',
  // AR 방위각 ↔ 화소 사상. 나침반 눈금자와 시뮬레이터가 **같은 함수**를
  // 쓰게 하려고 뽑아낸 것이라, 하네스도 베끼지 말고 이것을 임포트합니다.
  'src/utils/arProjection.ts',
  'src/utils/modelBlend.ts',
  'src/utils/localDate.ts',
  'src/utils/devicePose.ts',
  'src/utils/terrainPick.ts',
  'src/utils/cloudProfile.ts',
  // 스치는 햇빛 광선 적분(§106). 구름 슬랩이 임포트하지만, 판정이 따로 부르므로 명시합니다.
  'src/utils/grazingRay.ts',
  'src/utils/simReport.ts',
  'src/utils/weatherCacheKey.ts',
  'src/utils/satelliteBias.ts',
  'src/utils/solarGeometry.ts',
  // 앱의 태양력 — 판정(verify-solar-position)이 PyEphem 표에 대어 봅니다.
  'src/utils/solarPosition.ts',
  // 정밀한 달 위치(Meeus 47 장)와 해·달 걸기 탐색 — 판정이 astronomy-engine 표에 대어 봅니다
  // (verify-moon-position.js · verify-align-search.js).
  'src/utils/moonPosition.ts',
  // 월식(접촉 시각 · 크기) — verify-lunar-eclipse.js
  'src/utils/lunarEclipse.ts',
  'src/utils/eclipsePlan.ts',
  'src/utils/eclipseEvent.ts',
  // 카메라 노출 추천 칸 · 자동 시작 카운트다운 — verify-exposure-advice.js
  'src/utils/exposureAdvice.ts',
  'src/utils/autoStart.ts',
  'src/utils/horizon.ts',
  'src/utils/refractionK.ts',
  'src/utils/mp4Plan.ts',
  // 지형에 가린 일출·일몰(해 뜨는 시각 계산 과정) — verify-terrain-sun.js
  'src/utils/terrainSun.ts',
  'src/utils/calcSteps.ts',
  // 학습 페이지(02 학습)의 접는 규칙 · 고른 날 · 줄 누름 연결 — verify-learn-sections.js
  'src/utils/learnSections.ts',
  'src/utils/calcTopic.ts',
  // 학습 페이지 "오늘" 구역의 시간대별 점수 — verify-day-score-series.js
  'src/utils/dayScoreSeries.ts',
  // 01 하늘의 시간대별 점수 그래프(창 · 표본 · 경로 · 눈금) — verify-score-series.js
  'src/utils/scoreSeries.ts',
  'src/utils/alignSearch.ts',
  // 고른 대상을 위경도로 기억했다가 새 눈 기준으로 다시 만들기(저장한 장면 열기) — verify-picked-target.js
  'src/utils/pickedTarget.ts',
  // 저장한 장면(이름 · 요약 글 · 목록 · 저장소에서 읽기 · 고른 대상 오가기) — verify-saved-scenes.js
  'src/utils/savedScenes.ts',
  'src/utils/geoMove.ts',
  'src/utils/sunsetPhysics.ts',
  // 먼 건물 가시성(지평선 프로필 · 타일 · 건물 고르기) — verify-far-buildings.js 가 합성 산으로 판정합니다.
  'src/utils/farBuildings.ts',
  'src/utils/farBuildingsLoad.ts',
  'src/utils/demPick.ts',
  // 별 보기 조건(한계등급) — verify-star-visibility.js
  'src/utils/starVisibility.ts',
  'src/utils/starTonight.ts',
  // 건물 고르기(눈에서 쏜 시선이 처음 닿는 건물, 꼭대기 붙이기)와 지형·건물을 아우른 고르기 — verify-building-pick.js
  'src/utils/buildingPick.ts',
  'src/utils/pickTarget.ts',
  'src/utils/cloudRadar.ts',
  // 하늘 시트의 추천·일반 이벤트(점검 2026-09-29) — 판정이 불러 씁니다.
  'src/utils/skyEvents.ts',
  // 3D 라벨의 맨눈 가시성(2026-09-30) · 알림 계획 — 판정이 불러 씁니다.
  'src/utils/labelVisibility.ts',
  'src/utils/notificationPlan.ts',
  'src/utils/airQuality.ts',
  'src/utils/cloudMatrix.ts',
  'src/utils/mapProjection.ts',
  // 하늘 → 지도 → 구 줌의 한 줄 축척(verify-zoom-continuum.js).
  'src/utils/zoomContinuum.ts',
  'src/utils/cachePolicy.ts',
  'src/utils/cloudDeck.ts',
  // 샌드박스 세로 막대(높이·줌)와 이동 조이스틱 계산 — verify-sandbox-dials.js
  'src/utils/sandboxDials.ts',
  // 연속 이동 조이스틱의 이동 엔진(속도 곡선 · 부드러운 가감속 · 시선 기준 회전) — verify-joystick-motion.js
  'src/utils/joystickMotion.ts',
  // 연속 이동 조이스틱의 구동기(프레임 이어 붙이기 · 멈춘 뒤 한 번 확정)와 건물 받기 진행 막대 — verify-joystick-driver.js
  'src/utils/joystickDriver.ts',
  'src/utils/loadProgress.ts',
  // 비행 모드 눈 높이와 "여기로 가기" 부드러운 이동 — verify-fly-glide.js
  'src/utils/flightAssist.ts',
  // 촬영 모드 고르기(권하는 모드 · 줄 · 글) — verify-capture-mode.js
  'src/utils/captureMode.ts',
  // 모드 줄(시뮬레이션 · 샌드박스 · 사진 · 천체 · 타임랩스) 고르기 · 밀기 · 가이드 넘기기 — verify-mode-strip.js
  'src/utils/modeStrip.ts',
  // 유리 재질 · 위아래 어두운 막 값과 글자 대비 계산 — verify-glass-tokens.js
  'src/theme/glassTokens.ts',
  // 앱 머리줄 유리 자리 · 재질 — verify-header-layout.js
  'src/utils/headerLayout.ts',
  // 시간 자(끌어서 시각 바꾸기 · 눈금 · 날짜 줄) — verify-time-ruler.js
  'src/utils/timeRuler.ts',
  // 타임랩스 예측 노출 곡선(해 고도 → 맑은 하늘 밝기 → 단 변화) — verify-exposure-curve.js
  'src/utils/exposureCurve.ts',
  // 타임랩스 계획(간격 · 총 시간 · 영상 길이) — verify-timelapse-plan.js
  'src/utils/timelapsePlan.ts',
  // 촬영 중 카드(예측 대 실제 밝기 곡선 · 배터리 줄) — verify-run-card.js
  'src/utils/runCurve.ts',
  // 머리줄 탭 이름 — verify-tab-labels.js
  'src/utils/tabLabels.ts',
  // 접었다 펼치는 아래 막대의 단계 계산과 화면 요소 겹침 판정 — verify-dock-stages.js
  'src/utils/dockStages.ts',
  'src/utils/layoutOverlap.ts',
  // 03 기록의 종류 거르기 · 피드백 요약 — verify-record-compare.js
  'src/utils/recordCompare.ts',
  // 촬영 결과 비교(영역별 밝기 · 색 차이 줄, 나누는 위치, 그때 예보 한 줄) — verify-result-compare.js
  'src/utils/resultCompare.ts',
  // 자이로·자기 방위 융합. 화면·센서에서 떼어낸 순수 논리라 가짜 센서 열로
  // 판정할 수 있습니다 (verify-heading-fusion.js).
  'src/utils/headingFusion.ts',
  // 카메라 화면으로 AR 자세 보정(능선·해·달). 순수 논리라 합성 화면으로 판정합니다
  // (verify-ar-vision.js).
  'src/utils/arVision.ts',
  // 01 하늘의 쉬운 말(구름 한 줄 · 해 방향) — verify-sky-words.js
  'src/utils/skyWords.ts',
  'src/utils/demCpu.ts',
  // 화면의 시각이 시계를 따라가는가(스토어의 시각 조각 + 1분 타이머·앱 복귀). 가짜 타이머로
  // 판정합니다(verify-live-clock.js).
  'src/utils/liveClock.ts',
  // 하단 날짜·시간 막대 — 정확도 구간·데이터 기간·날짜 산술(verify-time-bar.js).
  'src/utils/timeBar.ts',
  'src/utils/dateSlider.ts',
  // 02 예보 — 16일 해 쪽 줄 자료로 날마다 일출 · 일몰 판정(verify-sun-forecast.js).
  'src/utils/sunForecast.ts',
  // 01 하늘의 "다가오는 좋은 순간" 카드 고르기 — verify-upcoming-moments.js
  'src/utils/upcomingMoments.ts',
  // 촬영 화면 전체 화면 — 미리보기 화각 · 해 경로 투영(verify-camera-overlay.js).
  'src/utils/cameraOverlay.ts',
  // 야간 장노출 예측 · 지구자전 역투영 정합 (verify-astro-forecast.js · verify-astro-stack.js).
  'src/utils/astroForecast.ts',
  'src/utils/astroStackMath.ts',
  // 시간 슬라이더 해제 후 단일 수렴 · 24시간 예열 버킷 (verify-slider-settle.js).
  'src/utils/sliderSettle.ts',
  // 천체 촬영 뷰파인더 · 야간 적색 화면 · 흔들림 감지 · 노출 스케일 (verify-astro-camera-ui.js).
  'src/utils/astroCameraUi.ts',
];
// 지워진 파일(예: de80a00 이 CloudSlabPrev.ts 를 없앴습니다)이 목록에 남아 있으면 tsc 가 그 항목만 못 만들고 스테이징 전체가
// 죽습니다 — 그 파일을 쓰는 낡은 습작(build-slab-ab 등)만 실패하게 하고 나머지 하네스는 돌게 합니다.
const MISSING = ENTRIES.filter(e => !fs.existsSync(path.join(SRC, e)));
if (MISSING.length) {
  console.warn('⚠ 없는 항목을 건너뜁니다: ' + MISSING.join(', '));
  for (const m of MISSING) ENTRIES.splice(ENTRIES.indexOf(m), 1);
}

fs.rmSync(OUT, { recursive: true, force: true });
// tsc는 타입 오류가 있어도 emit합니다. 리포에는 이 작업과 무관한 기존 오류
// (sunsetPhysics의 CloudData 유니온, weather.ts의 __DEV__ 전역)가 있으므로
// 종료 코드로 실패시키지 않고, **출력이 실제로 나왔는지**로 판단합니다.
try {
  execFileSync('npx', ['tsc', '--module', 'esnext', '--target', 'es2020',
    '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', OUT, ...ENTRIES],
    { cwd: SRC, stdio: 'pipe' });
} catch (e) {
  // 무시 — 아래에서 산출물 존재로 검증합니다.
}
for (const entry of ENTRIES) {
  const emitted = path.join(OUT, entry.replace(/^src\//, '').replace(/\.ts$/, '.js'));
  if (!fs.existsSync(emitted)) {
    throw new Error(`tsc가 ${entry} 를 emit하지 못했습니다 (${emitted} 없음)`);
  }
}

for (const d of ['components', 'utils']) fs.rmSync(path.join(APP, d), { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'vendor'), { recursive: true });
fs.cpSync(OUT, APP, { recursive: true });

const VENDOR = {
  three: 'three.module.js',
  suncalc: 'suncalc.js',
  'date-fns': 'date-fns.js',
};

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const files = walk(APP).filter(f => f.endsWith('.js') && !f.includes(`${path.sep}vendor${path.sep}`));
for (const f of files) {
  const rel = path.relative(path.dirname(f), APP) || '.';
  const vendorDir = (rel === '' ? '.' : rel) + '/vendor';
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(/from\s+(['"])([^'"]+)\1/g, (m, q, spec) => {
    if (VENDOR[spec]) return `from "${vendorDir}/${VENDOR[spec]}"`;
    if (spec.startsWith('.')) return `from "${spec}.js"`;
    return m;
  });
  fs.writeFileSync(f, s);
}

// vendor: three는 **node_modules에서** 가져옵니다. 예전에는 PREVIEW에 미리
// 받아둔 사본을 `if (exists)`로 복사했는데, /tmp가 비워지거나 사본이 사라지면
// 조용히 건너뛰고 브라우저에서만 404가 나 "__stats가 없습니다"로 나타났습니다
// (원인을 찾는 데 한참 걸립니다). 앱이 실제로 쓰는 버전과 같아야 하기도 하고요.
// three.module.js는 three.core.js를 import하므로 둘 다 필요합니다.
{
  const buildDir = path.join(SRC, 'node_modules/three/build');
  for (const f of ['three.module.js', 'three.core.js']) {
    const from = path.join(buildDir, f);
    if (!fs.existsSync(from)) {
      throw new Error(`${from} 가 없습니다 — npm install 이 필요합니다`);
    }
    fs.copyFileSync(from, path.join(APP, 'vendor', f));
  }
}
// sunsetPhysics는 sky_weights_v2.json을 import합니다. 브라우저는 JSON 모듈을
// import attribute 없이 못 읽으므로, ESM 래퍼로 감싸 같은 경로에 둡니다.
// (상대 import에 .js를 붙이는 규칙과 맞물려 './sky_weights_v2.json.js'가 됩니다.)
{
  const weightsSrc = path.join(SRC, 'src/utils/sky_weights_v2.json');
  if (fs.existsSync(weightsSrc)) {
    fs.mkdirSync(path.join(APP, 'utils'), { recursive: true });
    fs.writeFileSync(
      path.join(APP, 'utils', 'sky_weights_v2.json.js'),
      'export default ' + fs.readFileSync(weightsSrc, 'utf8') + ';\n'
    );
  }
}

const sc = fs.readFileSync(path.join(SRC, 'node_modules/suncalc/suncalc.js'), 'utf8');
fs.writeFileSync(path.join(APP, 'vendor', 'suncalc.js'),
  'const module={exports:{}};const exports=module.exports;\n' + sc + '\nexport default module.exports;\n');
fs.writeFileSync(path.join(APP, 'vendor', 'date-fns.js'),
  '// 미리보기 전용 최소 shim — date-fns의 addHours/startOfDay와 동일한 동작\n' +
  'export function addHours(d, n) { return new Date(d.getTime() + n * 3600000); }\n' +
  'export function startOfDay(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }\n');

console.log(`준비 완료: ${files.length}개 모듈 + vendor 4개`);
