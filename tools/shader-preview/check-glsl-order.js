/**
 * GLSL 함수 선언 순서 검사.
 * GLSL ES 1.0은 선언 후 사용이 강제되므로, 공유 청크에 함수를 추가할 때
 * 순서를 어기면 런타임에야 컴파일 오류로 드러납니다. 여기서 미리 잡습니다.
 */
global.__DEV__ = false;
const { ATMOSPHERE_GLSL: g } = require('/tmp/atmbuild/atmosphere.js');

const defs = {};
for (const m of g.matchAll(/^(?:vec[234]|float|void)\s+(atm_\w+)\s*\(/gm)) {
  if (!(m[1] in defs)) defs[m[1]] = m.index;
}
let bad = 0;
for (const [name, pos] of Object.entries(defs)) {
  const re = new RegExp('\\b' + name + '\\s*\\(', 'g');
  let m;
  while ((m = re.exec(g))) {
    if (m.index < pos) {
      console.log(`❌ ${name}: 정의(@${pos}) 이전에 호출(@${m.index})`);
      bad++;
      break;
    }
  }
}
if (/\$\{/.test(g)) { console.log('❌ 미치환 템플릿 리터럴'); bad++; }
if (/undefined|NaN/.test(g)) { console.log('❌ 상수 주입 실패'); bad++; }
console.log(bad === 0 ? `✅ atm_* ${Object.keys(defs).length}개 모두 선언 후 사용` : `${bad}건 위반`);
process.exit(bad ? 1 : 0);
