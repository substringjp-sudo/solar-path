/**
 * LandSilhouette.tsx
 *
 * **타일을 끄고 육지 윤곽만 그리는 중간 띠.**
 *
 * ## 왜 있는가
 *
 * 2D 는 구글맵 타일(도로·지명)이고 3D 구는 육지 실루엣입니다. 줌으로 바로
 * 넘기면 그림체가 툭 바뀝니다. 그래서 구로 가기 전에 **먼저 타일을 끄고
 * 실루엣으로** 넘어갑니다. 그 축척(서울 기준 화면 폭 20°~33°)이면 도로도 지명도
 * 어차피 안 보이므로 **잃는 정보가 없고**, 그 뒤 구로 부푸는 것은 같은 그림체
 * 끼리의 변화가 됩니다.
 *
 * 문턱은 `mapProjection.ts` 가 정합니다 — 상수가 아니라 위도 함수입니다.
 *
 * ⚠ 지도와 **같은 도법**(메르카토르)으로 그립니다. 다른 도법을 쓰면 타일이
 * 꺼지는 순간 육지가 미끄러집니다.
 */
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import * as d3 from 'd3-geo';
import { WORLD_LAND } from '../../utils/worldLand';

interface Props {
  /** 지도의 현재 영역 — `onRegionChangeComplete` 가 주는 그대로. */
  region: { latitude: number; longitude: number; longitudeDelta: number };
  width: number;
  height: number;
  theme: any;
}

type Region = Props['region'];

/** 리렌더를 부모에게 번지지 않고 영역만 바꿉니다 — 하늘 탭의 줌이 프레임마다 부릅니다. */
export interface LandSilhouetteHandle {
  setRegion: (r: Region) => void;
}

export const LandSilhouette = React.forwardRef<LandSilhouetteHandle, Props>(({ region: regionProp, width, height, theme }, ref) => {
  // 손잡이로 받은 영역은 **그때의 prop 이 그대로인 동안만** 씁니다 — prop 이 바뀌면(지도 탭이
  // 새 영역을 넘기면) prop 이 이깁니다. 효과(useEffect)로 맞추면 한 프레임 늦습니다.
  const regionPropRef = useRef(regionProp);
  regionPropRef.current = regionProp;
  const [imperative, setImperative] = useState<{ r: Region; base: Region } | null>(null);
  const region = imperative && imperative.base === regionProp ? imperative.r : regionProp;
  // 손가락 이벤트가 한 프레임에 여러 번 와도 경로는 한 번만 다시 풉니다.
  const pending = useRef<Region | null>(null);
  const frame = useRef<number | null>(null);
  useImperativeHandle(ref, () => ({
    setRegion: (r: Region) => {
      pending.current = r;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (pending.current) setImperative({ r: pending.current, base: regionPropRef.current });
      });
    },
  }), []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const { landPath, graticulePath } = useMemo(() => {
    if (width <= 0 || height <= 0) return { landPath: '', graticulePath: '' };
    // 메르카토르 배율: 화면 폭 W 픽셀이 경도 `longitudeDelta` 도를 담습니다.
    const scale = width / (region.longitudeDelta * (Math.PI / 180));
    const projection = d3.geoMercator()
      .scale(scale)
      .center([region.longitude, region.latitude])
      .translate([width / 2, height / 2]);
    const geoPath = d3.geoPath().projection(projection as any);
    return {
      landPath: geoPath(WORLD_LAND) ?? '',
      graticulePath: geoPath(d3.geoGraticule().step([15, 15])()) ?? '',
    };
  }, [region.latitude, region.longitude, region.longitudeDelta, width, height]);

  if (!landPath) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={width} height={height}>
        {/* 바다 — 타일을 완전히 덮습니다. 반투명하면 도로가 비쳐 어지럽습니다. */}
        <Rect x={0} y={0} width={width} height={height} fill="#0B1220" />
        <Path d={graticulePath} fill="none" stroke="rgba(100,116,139,0.22)" strokeWidth={0.6} />
        <Path d={landPath} fill="#1C2637" stroke="rgba(148,163,184,0.55)" strokeWidth={0.7} />
      </Svg>
    </View>
  );
});
