// RULER-display.md 판정: node display-ruler.js  → 곡선 × 종류 D1~D3 (D4 는 clip 쪽 결과 파일을 읽음)
const { execSync } = require('child_process'); const fs = require('fs');
const R = require('./photo-display-ruler.json');
const G = { Cu: 'Cu', Ac: 'AcCc', Ci: 'Ci', Sc: 'StSc' }, TM = ['AGX', 'ACES_FILMIC', 'NEUTRAL'];
const med = a => a.slice().sort((x, y) => x - y)[1];
const D4 = fs.existsSync('display-clip.json') ? require('./display-clip.json') : null;
const res = {};
for (const tm of TM) { let pass = 0, pass4 = 0; const rows = [];
  for (const [k, g] of Object.entries(G)) {
    const files = [200, 110, 20].map(a => `../proto/d${tm}-${k}-${a}.png`);
    const out = execSync('node skyratio.js ' + files.join(' ')).toString().trim().split('\n').map(l => l.split(' ').slice(1).join(' ').split(' / ').map(Number));
    const b = med(out.map(r => r[0])), d = med(out.map(r => r[1])), c = med(out.map(r => r[2]));
    const d1 = b >= R[g].bright[0] && b <= R[g].bright[2], d2 = d >= R[g].dark[0] && d <= R[g].dark[2], d3 = c <= 0.01;
    const ok = d1 && d2 && d3; if (ok) pass++;
    let d4 = null; if (D4) { d4 = D4[tm][g] >= D4.AGX[g] - 0.05; if (d4) pass4++; }
    rows.push(`${g.padEnd(5)} 밝은쪽 ${b.toFixed(2)} ${d1 ? '○' : '×'} | 어두운쪽 ${d.toFixed(2)} ${d2 ? '○' : '×'} | 포화 ${c.toFixed(3)} ${d3 ? '○' : '×'}${D4 ? ' | CLIP ' + D4[tm][g].toFixed(2) + (d4 ? ' ○' : ' ×') : ''}`);
  }
  res[tm] = { pass, pass4 }; console.log(`== ${tm}: D1–D3 통과 ${pass}/4${D4 ? ', D4 ' + pass4 + '/4' : ''}`); rows.forEach(r => console.log('  ' + r));
}
