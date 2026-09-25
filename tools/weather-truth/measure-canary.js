/**
 * **카나리아 한 점이 정말 나머지 34점을 대변하는가** — 실측.
 *
 * ## 무엇을 확인하려는 것인가
 *
 * `cachePolicy.ts` 의 카나리아는 가정 하나 위에 서 있습니다:
 *
 * > 35점은 같은 모델 런에서 온다. 런은 격자 전체가 한꺼번에 갈린다.
 * > 그러므로 **관측점이 안 갈렸으면 나머지도 안 갈렸다.**
 *
 * 기전으로는 맞아 보이지만 **잰 적이 없습니다.** 그리고 구멍이 하나 보입니다 —
 * `icon_seamless` 는 자기도 icon_d2/eu/global 을 앞선 시간과 지역으로 섞으므로,
 * 관측점과 380km 밖 점이 다른 하위 모델에 걸치고 그중 하나만 갱신되면
 * 카나리아가 놓칠 수 있습니다.
 *
 * 이 자가 그걸 잽니다. **붙이기 전에 이게 통과해야 합니다.**
 *
 * ## 어떻게 재나
 *
 * "이전 런" API 로 같은 시각을 **서로 다른 런**이 뭐라고 했는지 받습니다.
 * 그러면 런이 갈린 판이 여럿 생깁니다. 판마다 묻습니다:
 *
 * ```
 *   먼 점의 구름이 갈렸는가?   →  관측점의 기온도 갈렸는가?
 * ```
 *
 * ⚠ 잡아야 하는 것은 **"먼 곳은 갈렸는데 관측점은 그대로"** 인 판입니다.
 * 그게 한 번이라도 나오면 카나리아는 **조용히 옛 하늘을 그립니다.**
 * 반대(관측점만 갈림)는 안전합니다 — 괜히 다 받을 뿐입니다.
 *
 * ## ⚠ 한도 주의
 *
 * Open-Meteo 무료 한도가 하루치입니다. 2026-09-22 에 크기를 재다가 한도를
 * 다 써서 이 측정을 못 했습니다. **요청은 한 번**만 던집니다.
 *
 * 사용: node tools/weather-truth/measure-canary.js
 */
const https = require('https');

const LAT = 35.3606, LON = 136.1875;
const ANGLES = [-20, -10, 0, 10, 20];
const DISTANCES = [10, 30, 70, 130, 200, 280, 380];
/** 이전 런을 며칠치까지 물을지. 판이 이만큼 생깁니다. */
const PREV_DAYS = [1, 2, 3, 4, 5, 6, 7];

const dest = (lat, lon, d, az) => {
  const R = 6371, br = az * Math.PI / 180, dr = d / R;
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
  const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la),
                              Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return [+(la2 * 180 / Math.PI).toFixed(5), +(lo2 * 180 / Math.PI).toFixed(5)];
};

const get = url => new Promise((res, rej) => {
  https.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej);
});

/** 두 배열이 값으로 같은가 (null 자리까지 같아야 같음). */
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((v, i) => v === b[i]);

(async () => {
  // 관측점을 **맨 앞**에 둡니다 — 앱의 virtualPoints 와 같은 차례입니다.
  const pts = [[LAT, LON]];
  for (const a of ANGLES) for (const d of DISTANCES) pts.push(dest(LAT, LON, d, 270 + a));

  const vars = ['cloud_cover', 'temperature_2m'];
  const hourly = [];
  for (const v of vars) {
    hourly.push(v);
    for (const p of PREV_DAYS) hourly.push(`${v}_previous_day${p}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const url = 'https://previous-runs-api.open-meteo.com/v1/forecast'
    + `?latitude=${pts.map(p => p[0]).join(',')}`
    + `&longitude=${pts.map(p => p[1]).join(',')}`
    + `&hourly=${hourly.join(',')}`
    + `&start_date=${today}&end_date=${today}&timezone=auto`;

  console.log(`점 ${pts.length}개 · 변수 ${hourly.length}개 · ${today}`);
  const body = await get(url);
  let arr;
  try {
    arr = JSON.parse(body);
  } catch {
    console.log('응답을 못 읽었습니다:', body.slice(0, 200));
    process.exit(2);
  }
  if (!Array.isArray(arr)) {
    if (arr && arr.error) {
      console.log(`\nAPI 오류: ${arr.reason}`);
      if (String(arr.reason || '').includes('limit')) {
        console.log('→ 하루 한도입니다. 내일 다시 돌리세요. **요청은 한 번만** 던지고 끝냅니다.');
      }
      process.exit(2);
    }
    arr = [arr];
  }

  // 판을 만듭니다: (현재 런) vs (이전 런 N)
  let pass = 0, fail = 0, skipped = 0, canaryUnchangedPanels = 0, farChangedPanels = 0;
  console.log('\n판정 — 먼 곳이 갈렸는데 관측점이 그대로인 경우가 있는가\n');

  for (const p of PREV_DAYS) {
    const obs = arr[0]?.hourly;
    if (!obs) { console.log(`  ${p}일 전 런: 관측점 자료 없음 — 건너뜀`); skipped++; continue; }

    const obsTempNow = obs['temperature_2m'];
    const obsTempPrev = obs[`temperature_2m_previous_day${p}`];
    if (!obsTempPrev || obsTempPrev.every(v => v === null)) {
      console.log(`  ${p}일 전 런: 이전 런 자료 없음 — 건너뜀`); skipped++; continue;
    }

    const canaryUnchanged = same(obsTempNow, obsTempPrev);
    if (canaryUnchanged) canaryUnchangedPanels++;

    // 먼 점들 중 하나라도 구름이 갈렸는가
    let changedFar = 0, comparedFar = 0;
    for (let i = 1; i < arr.length; i++) {
      const h = arr[i]?.hourly;
      if (!h) continue;
      const now = h['cloud_cover'], prev = h[`cloud_cover_previous_day${p}`];
      if (!prev || prev.every(v => v === null)) continue;
      comparedFar++;
      if (!same(now, prev)) changedFar++;
    }

    const verdict = canaryUnchanged && changedFar > 0 ? '❌ 놓침' : '✅';
    console.log(`  ${p}일 전 런 — 카나리아(관측점 기온) ${canaryUnchanged ? '그대로' : '갈림'}`
      + ` · 먼 점 구름 ${changedFar}/${comparedFar} 갈림   ${verdict}`);

    if (changedFar > 0) farChangedPanels++;

    if (canaryUnchanged && changedFar > 0) {
      console.log(`      ⚠ **카나리아가 놓쳤습니다.** 관측점은 그대로인데 먼 점 ${changedFar}개가 갈렸습니다.`);
      console.log(`         이 상태로 붙이면 옛 하늘을 그립니다. 붙이지 마세요.`);
      fail++;
    } else if (comparedFar === 0) {
      skipped++;
    } else {
      pass++;
    }
  }

  /* ⚠ **자가 공허하지 않은지 확인합니다.**
   *
   * 이 자가 잡으려는 것은 "먼 곳은 갈렸는데 관측점은 그대로" 인 판입니다.
   * 그런데 며칠 떨어진 런끼리는 **늘 둘 다 갈립니다.** 그러면 위험한 가지를
   * 한 번도 안 밟고 합격이 나옵니다 — 그건 통과가 아니라 **안 재 본 것**입니다.
   */
  console.log('');
  console.log('자 자체 점검 — 이 판정이 공허하지 않은가');
  console.log(`  먼 곳이 갈린 판: ${farChangedPanels}개 — 이 판들이 **위험한 조건부가 시험된 횟수**입니다.`);
  console.log(`  그중 카나리아가 놓친 판: ${fail}개`);
  if (farChangedPanels === 0) {
    console.log('  ⚠ 먼 곳이 한 번도 안 갈렸습니다 — 위험한 조건부가 **시험되지 않았습니다.**');
    console.log('     이 합격은 아무 뜻이 없습니다.');
  } else {
    console.log(`  → "먼 곳이 갈리면 카나리아도 갈린다" 가 ${farChangedPanels}/${farChangedPanels} 성립했습니다.`);
  }
  console.log(`  카나리아가 "그대로" 로 나온 판: ${canaryUnchangedPanels}개`);
  if (canaryUnchangedPanels === 0) {
    console.log('     (며칠 떨어진 런은 늘 갈리므로 0 이 정상입니다. 같은 런 안에서 두 번');
    console.log('      부르는 경우 — 곧 앱이 실제로 건너뛰는 상황 — 은 여기서 안 재집니다.');
    console.log('      다만 그쪽은 모든 점이 함께 그대로인 **안전한 방향**입니다.)');
  }

  console.log('');
  if (skipped && !pass && !fail) {
    console.log('판을 하나도 못 만들었습니다 — 이전 런 자료가 안 왔습니다. 판정 못 함.');
    process.exit(2);
  }
  if (fail) {
    console.log(`불합격 — ${fail}개 판에서 카나리아가 놓쳤습니다. **붙이면 안 됩니다.**`);
    process.exit(1);
  }
  console.log(`합격 — 판 ${pass}개에서 놓친 적이 없습니다. (건너뛴 판 ${skipped})`);
  console.log('⚠ 다만 icon_d2 권역(독일 근처)은 이 자리에서 안 재집니다.');
  process.exit(0);
})();
