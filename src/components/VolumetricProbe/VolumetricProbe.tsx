/**
 * VolumetricProbe.tsx — 볼륨 구름 시험 화면(개발자 패널에서 엽니다, 문서 §123).
 *
 * takram 대기·볼륨 구름(volumetricScene.ts)을 expo-gl 위에서 돌려 **이 기기에서 되는지·얼마나 빠른지**를
 * 봅니다. 화면에 GPU 정보(float/half-float 렌더 지원, 3D 텍스처 최대 크기), 대기 표 생성 시간, 프레임 시간을
 * 띄웁니다. 오류가 나면 그대로 보여 줍니다 — 그것도 결과입니다.
 *
 * ⚠ 뒤의 하늘 화면도 계속 그려지므로 프레임 시간은 실제보다 조금 나쁘게 나옵니다(보수적).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import {
  createVolumetricScene,
  readCapabilities,
  VOLUMETRIC_PRESETS,
  type GLCapabilities,
  type VolumetricQuality,
  type VolumetricScene,
} from './volumetricScene';
import { buildLiveScene } from './liveScene';
import { useCelestialStore } from '../../store/useCelestialStore';
import type { CloudPathData } from '../../utils/weather';

const QUALITIES: VolumetricQuality[] = ['low', 'medium', 'high'];
const SCALES = [1, 0.5];

export const VolumetricProbe: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [status, setStatus] = useState('GL 준비 중');
  const [caps, setCaps] = useState<GLCapabilities | null>(null);
  const [genMs, setGenMs] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ ms: number; fps: number } | null>(null);
  // -1 = "지금 예보"(§126 D2): 스토어의 관측점·시각·캐시된 예보로 장면을 만듭니다.
  const [presetIdx, setPresetIdx] = useState(0);
  const [liveSummary, setLiveSummary] = useState<string | null>(null);
  const location = useCelestialStore(st => st.location);
  const currentTime = useCelestialStore(st => st.currentTime);
  const weatherCacheList = useCelestialStore(st => st.weatherCacheList);
  const applyScene = useCallback((sc: VolumetricScene, idx: number) => {
    if (idx >= 0) { sc.setPreset(VOLUMETRIC_PRESETS[idx]); setLiveSummary(null); return; }
    const lat = location?.coords.latitude ?? 37.5665, lon = location?.coords.longitude ?? 126.978;
    const heightM = location?.coords.altitude ?? 50;
    const d = currentTime;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cached = weatherCacheList.find(c => c.key.includes(dateStr) && Math.abs(c.latitude - lat) < 0.05 && Math.abs(c.longitude - lon) < 0.05);
    const pathData = (cached?.data as CloudPathData[] | undefined) ?? [];
    const live = buildLiveScene({ lat, lon, heightM, date: d, pathData });
    sc.setScene(live.input);
    const ls = sc.lastScene();
    setLiveSummary(`${live.summary}${ls ? ` · 노출 ${ls.exposure.toFixed(0)}` : ''}${live.forecast ? `\n${live.forecast.why}` : ''}`);
  }, [location, currentTime, weatherCacheList]);
  const [quality, setQuality] = useState<VolumetricQuality>('low');
  const [scale, setScale] = useState(1);
  // 그림자 지도: 자동(해 12° 위만) · 켜기(해 고도 무관) / 해 쪽 2차 행진: 확장(≈7km) · 기본(300m)
  const [shadowOn, setShadowOn] = useState(false);
  const [longMarch, setLongMarch] = useState(true);
  // 구름 종류별 모형(§124) — 켜면 적운·고적운 등 종류마다 다른 무늬·단면, 끄면 takram 기본(같은 잡음 덩어리).
  const [genusOn, setGenusOn] = useState(true);
  // §130 대기 흐름 구름 모형 — 켜면 흐름이 변형한 종류별 템플릿 + 수분장(연속 밀도 포함), 끄면 §124 정적 무늬.
  const [flowOn, setFlowOn] = useState(false);
  const [morphOn, setMorphOn] = useState(false);
  const [weatherMs, setWeatherMs] = useState<number | null>(null);

  const sceneRef = useRef<VolumetricScene | null>(null);
  const rafRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => { if (sceneRef.current) applyScene(sceneRef.current, presetIdx); }, [presetIdx, applyScene]);
  useEffect(() => { sceneRef.current?.setQuality(quality); }, [quality]);
  useEffect(() => { sceneRef.current?.setResolutionScale(scale); }, [scale]);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.setOptions({ shadowMinSunDeg: shadowOn ? -90 : 12, sunMarch: longMarch ? [6, 250, 1.6] : null, genus: genusOn, flow: flowOn, morph: morphOn });
    setWeatherMs(sc.weatherMs());
  }, [shadowOn, longMarch, genusOn, flowOn, morphOn]);
  useEffect(() => { if (sceneRef.current) setWeatherMs(sceneRef.current.weatherMs()); }, [presetIdx]);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      setCaps(readCapabilities(gl as unknown as WebGL2RenderingContext));
      const renderer = new Renderer({ gl });
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      renderer.setSize(w, h);
      setStatus('대기 표 생성 중 (기기 GPU)');
      const t0 = Date.now();
      // §178 조명 결함 고침(산란 자르기 · 조도 μs 로그 보간)은 앱 길에서 켬 — DEFAULT_VOLUMETRIC_OPTIONS 는 하네스 관례로 끔.
      const scene = await createVolumetricScene(renderer, w, h, { genus: genusOn, clampInscatter: true, irradianceLogMu: true });
      if (!aliveRef.current) { scene.dispose(); return; }
      setGenMs(Date.now() - t0);
      applyScene(scene, presetIdx);
      scene.setQuality(quality);
      scene.setResolutionScale(scale);
      sceneRef.current = scene;
      setWeatherMs(scene.weatherMs());
      setStatus('실행 중');

      let last = Date.now(), acc = 0, n = 0, lastReport = last;
      const loop = () => {
        if (!aliveRef.current) return;
        const now = Date.now();
        const dt = (now - last) / 1000;
        last = now;
        scene.render(dt);
        gl.endFrameEXP();
        acc += dt; n++;
        if (now - lastReport > 500 && n > 0) {
          setFrame({ ms: (acc / n) * 1000, fps: n / acc });
          acc = 0; n = 0; lastReport = now;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      setStatus('오류: ' + String((e as Error)?.message ?? e));
    }
    // 장면 설정은 첫 생성 때만 읽고, 이후 변경은 위 effect 들이 반영합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;
  const preset = presetIdx >= 0 ? VOLUMETRIC_PRESETS[presetIdx] : null;

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        <View style={styles.hud} pointerEvents="box-none">
          <Text style={styles.title}>볼륨 구름 시험 · {preset ? preset.label : '지금 예보'}</Text>
          {liveSummary && <Text style={styles.line}>{liveSummary}</Text>}
          <Text style={styles.line}>상태: {status}</Text>
          {caps && (
            <>
              <Text style={styles.line} numberOfLines={2}>GPU: {caps.renderer}</Text>
              <Text style={styles.line}>
                float 렌더 {caps.colorBufferFloat ? '○' : '×'} · half-float 렌더 {caps.colorBufferHalfFloat ? '○' : '×'} ·
                float 선형 {caps.floatLinear ? '○' : '×'} · 3D 텍스처 {caps.max3DTextureSize}
              </Text>
            </>
          )}
          {genMs != null && <Text style={styles.line}>대기 표 생성: {(genMs / 1000).toFixed(1)}초</Text>}
          {weatherMs != null && <Text style={styles.line}>날씨 무늬 생성: {weatherMs} ms ({genusOn ? '종류별' : '기본'})</Text>}
          {frame && (
            <Text style={styles.big}>{frame.ms.toFixed(1)} ms · {frame.fps.toFixed(0)} fps</Text>
          )}
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setPresetIdx(-1)} style={[styles.chip, presetIdx === -1 && styles.chipOn]}>
              <Text style={styles.chipText}>지금 예보</Text>
            </TouchableOpacity>
            {VOLUMETRIC_PRESETS.map((p, i) => (
              <TouchableOpacity key={p.key} onPress={() => setPresetIdx(i)} style={[styles.chip, i === presetIdx && styles.chipOn]}>
                <Text style={styles.chipText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row}>
            {QUALITIES.map(q => (
              <TouchableOpacity key={q} onPress={() => setQuality(q)} style={[styles.chip, q === quality && styles.chipOn]}>
                <Text style={styles.chipText}>{q}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setShadowOn(v => !v)} style={[styles.chip, shadowOn && styles.chipOn]}>
              <Text style={styles.chipText}>그림자 지도 {shadowOn ? '켜기' : '자동'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setGenusOn(v => !v)} style={[styles.chip, genusOn && styles.chipOn]}>
              <Text style={styles.chipText}>구름 종류 모형 {genusOn ? '켜기' : '끄기'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFlowOn(v => !v)} style={[styles.chip, flowOn && styles.chipOn]}>
              <Text style={styles.chipText}>대기 흐름 모형 {flowOn ? '켜기' : '끄기'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMorphOn(v => !v)} style={[styles.chip, morphOn && styles.chipOn]}>
              <Text style={styles.chipText}>연속 형태 모형 {morphOn ? '켜기' : '끄기'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLongMarch(v => !v)} style={[styles.chip, longMarch && styles.chipOn]}>
              <Text style={styles.chipText}>해 쪽 행진 {longMarch ? '확장' : '기본'}</Text>
            </TouchableOpacity>
            {SCALES.map(s => (
              <TouchableOpacity key={s} onPress={() => setScale(s)} style={[styles.chip, s === scale && styles.chipOn]}>
                <Text style={styles.chipText}>해상도 ×{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>닫기</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  hud: {
    position: 'absolute', left: 8, right: 8, top: 44, padding: 8, borderRadius: 8,
    backgroundColor: 'rgba(2,6,23,0.62)', gap: 3,
  },
  title: { fontSize: 13, fontWeight: '900', color: '#F1F5F9' },
  line: { fontSize: 11, color: '#CBD5E1' },
  big: { fontSize: 18, fontWeight: '900', color: '#34D399', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(148,163,184,0.25)' },
  chipOn: { backgroundColor: 'rgba(52,211,153,0.55)' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#F8FAFC' },
  close: {
    position: 'absolute', right: 12, bottom: 36, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    backgroundColor: 'rgba(2,6,23,0.7)',
  },
  closeText: { fontSize: 13, fontWeight: '800', color: '#F1F5F9' },
});
