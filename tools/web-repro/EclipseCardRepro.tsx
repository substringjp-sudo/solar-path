/**
 * EclipseCardRepro — 월식 이벤트 카드(`EclipseCard`)를 웹 하네스에서 눌러 보는 장면(2026-11-21).
 * 주소 # 뒤 JSON: { eclipsecard: 1, w, h, lang, lat, lon, tz, at (가장 깊은 때 기준 분, 기본 0), sky }. 식은 2025-03-14 개기식 고정.
 * 판정: tools/web-repro/verify-eclipse-card.js
 */
import React from 'react';
import { View } from 'react-native';
import { EclipseCard } from '../../src/components/AstroCamera/EclipseCard';
import { lunarEclipseAt } from '../../src/utils/lunarEclipse';
import { eclipseEventFor } from '../../src/utils/eclipseEvent';

const SKY: Record<string, string> = {
  haze: 'linear-gradient(180deg, #b8c0d6 0%, #d9dde6 45%, #e9e2d6 60%, #e9e2d6 100%)',
  night: 'linear-gradient(180deg, #070A12 0%, #0d1428 100%)',
};

export function EclipseCardRepro({ W, H, Q }: { W: number; H: number; Q: any }) {
  const lang = (Q.lang ?? 'ko') as 'ko' | 'en' | 'ja';
  const g = lunarEclipseAt(Date.UTC(2025, 2, 14, 6, 58, 41))!.greatestMs;
  const nowMs = g + (Q.at ?? 0) * 60000;
  const ev = eclipseEventFor(nowMs, Q.lat ?? 40.71, Q.lon ?? -74.0);
  return (
    <View testID="eclipse-root" style={[{ width: W, height: H, position: 'relative', overflow: 'hidden', backgroundColor: '#222' }, { backgroundImage: SKY[Q.sky ?? 'haze'] } as any]}>
      <View style={{ position: 'absolute', left: 12, right: 12, top: 60 }}>
        {ev ? <EclipseCard event={ev} language={lang} tzHours={Q.tz ?? -4} /> : null}
      </View>
    </View>
  );
}
