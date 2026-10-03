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

const QUALITIES: VolumetricQuality[] = ['low', 'medium', 'high'];
const SCALES = [1, 0.5];

export const VolumetricProbe: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [status, setStatus] = useState('GL 준비 중');
  const [caps, setCaps] = useState<GLCapabilities | null>(null);
  const [genMs, setGenMs] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ ms: number; fps: number } | null>(null);
  const [presetIdx, setPresetIdx] = useState(0);
  const [quality, setQuality] = useState<VolumetricQuality>('low');
  const [scale, setScale] = useState(1);
  // 그림자 지도: 자동(해 12° 위만) · 켜기(해 고도 무관) / 해 쪽 2차 행진: 확장(≈7km) · 기본(300m)
  const [shadowOn, setShadowOn] = useState(false);
  const [longMarch, setLongMarch] = useState(true);

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

  useEffect(() => { sceneRef.current?.setPreset(VOLUMETRIC_PRESETS[presetIdx]); }, [presetIdx]);
  useEffect(() => { sceneRef.current?.setQuality(quality); }, [quality]);
  useEffect(() => { sceneRef.current?.setResolutionScale(scale); }, [scale]);
  useEffect(() => {
    sceneRef.current?.setOptions({ shadowMinSunDeg: shadowOn ? -90 : 12, sunMarch: longMarch ? [6, 250, 1.6] : null });
  }, [shadowOn, longMarch]);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      setCaps(readCapabilities(gl as unknown as WebGL2RenderingContext));
      const renderer = new Renderer({ gl });
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      renderer.setSize(w, h);
      setStatus('대기 표 생성 중 (기기 GPU)');
      const t0 = Date.now();
      const scene = await createVolumetricScene(renderer, w, h);
      if (!aliveRef.current) { scene.dispose(); return; }
      setGenMs(Date.now() - t0);
      scene.setPreset(VOLUMETRIC_PRESETS[presetIdx]);
      scene.setQuality(quality);
      scene.setResolutionScale(scale);
      sceneRef.current = scene;
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
  const preset = VOLUMETRIC_PRESETS[presetIdx];

  return (
    <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        <View style={styles.hud} pointerEvents="box-none">
          <Text style={styles.title}>볼륨 구름 시험 · {preset.label}</Text>
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
          {frame && (
            <Text style={styles.big}>{frame.ms.toFixed(1)} ms · {frame.fps.toFixed(0)} fps</Text>
          )}
          <View style={styles.row}>
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
