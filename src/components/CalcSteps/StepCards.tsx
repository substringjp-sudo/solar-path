/**
 * StepCards.tsx — 계산 과정의 **단계 카드**와 그 안의 그림 둘(스카이라인 단면 · 주변 구름 지도).
 *
 * 처음에는 `CalcStepsModal`(왜 그런가요 창) 안에 있었고, 학습 페이지(`LearnScreen/WhySection`)가 같은 카드를 접는 줄 안에 그리면서
 * 두 곳이 함께 쓰도록 꺼냈습니다. 값은 `utils/calcSteps.ts` 가 앱의 실제 계산에서 가져오고, 이 부품은 그리기만 합니다.
 *
 * `inset` 은 카드가 이미 패널 위(접는 줄 안)에 놓일 때 쓰는 모양입니다. 패널과 같은 배경이면 카드가 구분되지 않아 은은한 칠 + 테두리로 바꿉니다.
 */
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { makeStyles } from '../../theme/useTheme';
import { mono } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { sunLineGap, type SkyMap, type SkyPicture, type StepCard } from '../../utils/calcSteps';

type Lang = 'ko' | 'en' | 'ja';

export const StepCardView: React.FC<{ index: number; card: StepCard; language: Lang; inset?: boolean }> = ({ index, card, language, inset }) => {
  const styles = useStyles();
  const box = [styles.card, inset && styles.cardInset];
  if (card.shape === 'result') {
    return (
      <View style={box}>
        <View style={styles.cardRow}>
          <Text style={styles.num}>{index}</Text>
          <Text style={styles.cardTitleFlex}>{card.title}</Text>
          <Text style={styles.resultText}>{card.result}</Text>
        </View>
        {card.rows && card.rows.length > 0 && (
          <View style={[styles.rowsLine, styles.resultRows]}>
            {card.rows.map(r => <Text key={r.label} style={styles.rowText}>{r.label} {r.value}</Text>)}
          </View>
        )}
      </View>
    );
  }
  if (card.shape === 'metric') {
    const tone = card.tone === 'good' ? styles.toneGood : card.tone === 'warn' ? styles.toneWarn : card.tone === 'bad' ? styles.toneBad : card.tone === 'moon' ? styles.toneMoon : styles.tonePlain;
    return (
      <View style={[...box, card.key && styles.cardKey]}>
        <View style={styles.metricRow}>
          <Text style={styles.num}>{index}</Text>
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.note}>{card.note}</Text>
            {card.rows && card.rows.length > 0 && (
              <View style={styles.rowsLine}>
                {card.rows.map(r => <Text key={r.label} style={styles.rowText}>{r.label} {r.value}</Text>)}
              </View>
            )}
          </View>
          <Text style={[styles.metricValue, tone]}>{card.result}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[...box, card.key && styles.cardKey]}>
      <View style={styles.cardRowTop}>
        <Text style={styles.num}>{index}</Text>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          {card.shape === 'rows' && (
            <View style={styles.rowsLine}>
              {card.rows!.map(r => (
                <Text key={r.label} style={styles.rowText}>{r.label} {r.value}</Text>
              ))}
            </View>
          )}
          {card.shape === 'bar' && card.bar && (
            <View style={styles.barRow}>
              <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(0, Math.min(1, card.bar.value)) * 100}%` }]} /></View>
              <Text style={styles.barText}>{card.bar.display}</Text>
            </View>
          )}
          {card.shape === 'map' && card.map && (
            <>
              <SkyMapView map={card.map} language={language} />
              <Text style={styles.hint}>{L3(language, '읽는 법: 가운데가 나, 바깥일수록 먼 곳. 원이 크고 진할수록 구름이 많아요. 주황 점선이 해 방향이에요.', 'How to read: you are in the middle, farther out is farther away. Bigger, darker circles mean more cloud. The orange dashed line points to the sun.', '読み方: 真ん中が自分で、外ほど遠くです。丸が大きく濃いほど雲が多いです。オレンジの点線が太陽の方向です。')}</Text>
              {card.map.sunLine && card.map.sunLine.length > 1 && <SunLineStrip map={card.map} language={language} />}
            </>
          )}
          {card.shape === 'sky' && card.sky && <SkyPictureView sky={card.sky} language={language} />}
          <Text style={styles.note}>{card.note}</Text>
        </View>
      </View>
    </View>
  );
};

/** 스카이라인 단면: 윤곽 · 평평한 수평선(0°) · 해 둘(평평한 수평선 기준 / 실제로 보이는). 하늘 위에 그리므로 화면 모드와 상관없이 어둡습니다. */
export const SkyPictureView: React.FC<{ sky: SkyPicture; language: Lang }> = ({ sky, language }) => {
  const W = 320, H = 96;
  const [az0, az1] = sky.azRange, [el0, el1] = sky.elRange;
  const x = (az: number) => ((az - az0) / (az1 - az0)) * W;
  const y = (el: number) => H - ((el - el0) / (el1 - el0)) * H;
  const ridge = sky.skyline.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const rPx = Math.max(4, (sky.sunRadiusDeg / (el1 - el0)) * H);
  const label = L3(language, '지평선 단면', 'Horizon section', '地平線の断面');
  const aria = `${label}: ${sky.caption ?? ''}`;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={aria} style={{ borderRadius: 6 }}>
      <Rect x={0} y={0} width={W} height={H} fill="#0F1625" />
      <Line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
      <Path d={`${ridge} L${W} ${H} L0 ${H} Z`} fill="#1D2A3D" />
      {sky.suns.map(s => (
        <React.Fragment key={s.kind}>
          <Circle cx={x(s.az)} cy={y(s.el)} r={rPx} fill={s.kind === 'visible' ? '#FBBF24' : 'none'} stroke="#FBBF24" strokeWidth={s.kind === 'visible' ? 0 : 1} strokeDasharray={s.kind === 'visible' ? undefined : '2 2'} />
          <SvgText x={Math.min(W - 34, Math.max(2, x(s.az) + rPx + 3))} y={y(s.el) + (s.kind === 'visible' ? -rPx - 2 : rPx + 10)} fill="#94A3B8" fontSize={9} fontFamily={mono}>{s.label}</SvgText>
        </React.Fragment>
      ))}
      <SvgText x={6} y={H - 6} fill="#94A3B8" fontSize={9} fontFamily={mono}>0°</SvgText>
      {sky.caption ? <SvgText x={W - 6} y={12} fill="#94A3B8" fontSize={9} fontFamily={mono} textAnchor="end">{sky.caption}</SvgText> : null}
    </Svg>
  );
};

/**
 * 주변 구름 지도(북쪽이 위): 관측점에서 본 방위·거리의 구름을 칸마다 원으로(구름이 많을수록 크고 진하게), 거리 고리와
 * 해 방향 점선을 함께. 거리는 √ 눈금이라 가까운 곳이 너무 좁아지지 않습니다. 하늘 위에 그리므로 화면 모드와 상관없이 어둡습니다.
 */
export const SkyMapView: React.FC<{ map: SkyMap; language: Lang }> = ({ map, language }) => {
  const W = 320, H = 150, cx = W / 2, cy = H / 2, R = 62;
  const BG = '#0F1625';
  const pos = (distKm: number, azDeg: number): [number, number] => {
    const r = R * Math.sqrt(distKm / map.maxKm);
    const a = (azDeg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const [sx, sy] = pos(map.maxKm, map.sunAzDeg);
  const aria = L3(language, '주변 구름 지도', 'Cloud map around you', '周りの雲の地図');
  // 해 쪽 이름표: 선 끝(바깥 고리)에서 구름 원 하나(최대 반지름 13)만큼 더 밖에 둡니다. 해가 거의 정북·정남이라 화면 위아래로 몰리면 구름과
  // 겹칠 수 있어 뒤를 배경색으로 칠합니다.
  const sunLabel = L3(language, '해 쪽', 'Sun', '太陽側');
  const sa = (map.sunAzDeg * Math.PI) / 180;
  const sunAnchor: 'start' | 'middle' | 'end' = Math.sin(sa) > 0.35 ? 'start' : Math.sin(sa) < -0.35 ? 'end' : 'middle';
  const sunLx = cx + (R + 17) * Math.sin(sa);
  const sunLy = Math.min(H - 5, Math.max(20, cy - (R + 14) * Math.cos(sa) + 3));
  const sunLabelW = [...sunLabel].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 9 : 5.4), 0) + 4;
  const sunLabelX = sunAnchor === 'start' ? sunLx - 2 : sunAnchor === 'end' ? sunLx - sunLabelW + 2 : sunLx - sunLabelW / 2;
  const labelRings: { km: number; y: number }[] = [];
  let lastLabelY = -Infinity;
  for (const km of map.ringsKm) {
    const y = cy + R * Math.sqrt(km / map.maxKm);
    if (y - lastLabelY >= 9) { labelRings.push({ km, y }); lastLabelY = y; }
  }
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={aria} style={{ borderRadius: 6 }}>
      <Rect x={0} y={0} width={W} height={H} fill={BG} />
      {map.ringsKm.map(km => <Circle key={km} cx={cx} cy={cy} r={R * Math.sqrt(km / map.maxKm)} fill="none" stroke="rgba(255,255,255,0.12)" />)}
      {map.cells.map((c, i) => {
        const [x, y] = pos(c.distKm, c.azDeg);
        return <Circle key={i} cx={x} cy={y} r={4 + 9 * c.cover} fill={`rgba(226,232,240,${(0.10 + 0.55 * c.cover).toFixed(2)})`} />;
      })}
      <Line x1={cx} y1={cy} x2={sx} y2={sy} stroke="#F97316" strokeWidth={1.5} strokeDasharray="3 3" />
      <Circle cx={cx} cy={cy} r={3} fill="#38BDF8" />
      <Rect x={sunLabelX} y={sunLy - 9} width={sunLabelW} height={12} fill={BG} opacity={0.85} />
      <SvgText x={sunLx} y={sunLy} fill="#F97316" fontSize={9} fontFamily={mono} textAnchor={sunAnchor}>{sunLabel}</SvgText>
      <SvgText x={cx} y={11} fill="#94A3B8" fontSize={9} fontFamily={mono} textAnchor="middle">N</SvgText>
      {/* 거리 이름표: 남쪽 축(아래)의 각 고리 위에 놓고 뒤를 배경색으로 칠해 구름 위에서도 읽히게 합니다. 직전에 그린 이름표와 9 미만으로 붙는 고리는 건너뜁니다(글자 높이 8). */}
      {labelRings.map(({ km, y }) => {
        const w = String(km).length * 5 + 4;
        return (
          <React.Fragment key={`l${km}`}>
            <Rect x={cx - w / 2} y={y - 5} width={w} height={10} fill={BG} opacity={0.85} />
            <SvgText x={cx} y={y + 3} fill="#9AA8BA" fontSize={8} fontFamily={mono} textAnchor="middle">{km}</SvgText>
          </React.Fragment>
        );
      })}
      <SvgText x={W - 4} y={H - 5} fill="#778699" fontSize={8} fontFamily={mono} textAnchor="end">km</SvgText>
    </Svg>
  );
};

/**
 * 해 방향 옆모습 띠: 나(왼쪽)에서 해 쪽으로 거리별 구름을 옆에서 본 그림. 먼 곳에 구름 틈이 있으면 낮은 해의 빛이 그 틈으로 들어와
 * 가까운 구름의 밑면을 비춥니다(그림의 주황 선). 틈이 없으면 선이 없고 글이 그렇다고 말합니다. 하늘 위에 그리므로 화면 모드와 상관없이 어둡습니다.
 */
export const SunLineStrip: React.FC<{ map: SkyMap; language: Lang }> = ({ map, language }) => {
  const styles = useStyles();
  const line = map.sunLine ?? [];
  const W = 320, H = 84, X0 = 24, X1 = 300, GY = 70, BG = '#0F1625';
  const x = (km: number) => X0 + (km / map.maxKm) * (X1 - X0);
  const gap = sunLineGap(line);
  const pitch = line.length > 1 ? (x(line[line.length - 1].distKm) - x(line[0].distKm)) / (line.length - 1) : 30;
  const nearThick = line.find(p => p.cover >= 0.6);
  const aria = L3(language, '해 방향 거리별 구름 옆모습', 'Side view of clouds toward the sun by distance', '太陽方向の距離別の雲の横から見た図');
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={aria} style={{ borderRadius: 6 }}>
        <Rect x={0} y={0} width={W} height={H} fill={BG} />
        <Rect x={0} y={GY} width={W} height={H - GY} fill="#1D2A3D" />
        {line.map(p => (
          <Rect key={p.distKm} x={x(p.distKm) - pitch / 2} y={18} width={pitch} height={16} fill="#E2E8F0" opacity={Math.min(0.9, 0.08 + 0.85 * p.cover)} />
        ))}
        {gap && nearThick ? (
          <>
            <Line x1={W - 8} y1={GY - 4} x2={x(nearThick.distKm)} y2={34} stroke="#F97316" strokeWidth={1.6} />
            <Rect x={x(gap.fromKm) - pitch / 2} y={14} width={x(gap.toKm) - x(gap.fromKm) + pitch} height={24} fill="none" stroke="#4ADE80" strokeWidth={1.2} strokeDasharray="3 2" />
          </>
        ) : null}
        <Circle cx={W - 8} cy={GY - 4} r={5} fill="#FBBF24" />
        <Circle cx={X0} cy={GY - 3} r={3} fill="#38BDF8" />
        <SvgText x={X0} y={H - 3} fill="#94A3B8" fontSize={8} fontFamily={mono} textAnchor="middle">{L3(language, '나', 'You', '自分')}</SvgText>
        <SvgText x={W - 8} y={H - 3} fill="#94A3B8" fontSize={8} fontFamily={mono} textAnchor="end">{`${map.maxKm} km`}</SvgText>
      </Svg>
      <Text style={styles.hint}>
        {gap && nearThick
          ? L3(language, `해 쪽 ${gap.fromKm}–${gap.toKm} km 에 구름 틈이 있어요. 낮은 해의 빛이 그 틈으로 들어와 가까운 구름 밑면을 비춰요.`, `There is a gap ${gap.fromKm}–${gap.toKm} km toward the sun. Low sunlight comes through it and lights the underside of the nearer clouds.`, `太陽方向${gap.fromKm}〜${gap.toKm} kmに雲の切れ間があります。低い太陽の光がそこから入り、近くの雲の底を照らします。`)
          : L3(language, '해 쪽에 빛이 들어올 구름 틈이 없어요. 구름이 있으면 빛이 막혀 회색으로 보여요.', 'There is no gap toward the sun for light to come through. Cloud blocks the light and looks grey.', '太陽方向に光が入る切れ間がありません。雲があると光が遮られて灰色に見えます。')}
      </Text>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  card: { backgroundColor: color.panel, borderRadius: 10, padding: 10 },
  cardInset: { backgroundColor: color.fill, borderWidth: 1, borderColor: color.border },
  cardKey: { borderWidth: 1, borderColor: color.accentLine },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardRowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardMain: { flex: 1, minWidth: 0, gap: 6 },
  num: { width: 14, fontFamily: mono, fontSize: 11, color: color.textMute },
  cardTitle: { fontSize: 13, fontWeight: '700', color: color.text },
  cardTitleFlex: { flex: 1, fontSize: 13, fontWeight: '700', color: color.text },
  rowsLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },
  rowText: { fontFamily: mono, fontSize: 11, color: color.text },
  resultRows: { marginTop: 6, marginLeft: 24 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.border, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  barText: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: color.text },
  note: { fontSize: 11, color: color.textDim },
  hint: { fontSize: 11, color: color.textMute },
  resultText: { fontFamily: mono, fontSize: 16, fontWeight: '700', color: color.sun },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metricValue: { fontFamily: mono, fontSize: 13, fontWeight: '700', textAlign: 'right', maxWidth: 96 },
  tonePlain: { color: color.text },
  toneGood: { color: color.success },
  toneWarn: { color: color.warning },
  toneBad: { color: color.danger },
  toneMoon: { color: color.moon },
}));
