/**
 * SandboxShootPanel.tsx — 샌드박스 "촬영" 패널.
 * 상단 고정 탭 바(노을 · 천체 · 타임랩스) 아래에서 각 촬영 설정이 독립 스크롤됩니다.
 * 실제 카메라 진입은 하단 메인 셔터가 담당하므로 패널 안 중복 버튼은 두지 않습니다.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Moon, Sun, Timer } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { AstroSettingsPanel } from '../AstroCamera/AstroSettingsPanel';
import { AstroForecastBanner } from '../AstroCamera/AstroForecastBanner';
import { TimelapsePanel } from '../AstroCamera/TimelapsePanel';
import { ExposureCells } from '../AstroCamera/ExposureCells';
import { MiniFilterRingIcon, MiniLensBarrelIcon, type LensKind } from '../AstroCamera/CameraLensZoomSection';
import { GLASS, TEXT } from '../../theme/glassTokens';
import { color as DARK } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import type { AstroCameraCapabilities } from '../../../modules/astro-camera';
import type { AstroWindowAnalysis } from '../../utils/astroForecast';
import type { AstroSettingsState, AstroShotSummary } from '../../utils/astroCameraUi';
import type { ExposureAdvice, PhotoWbPreset } from '../../utils/exposureAdvice';
import type { TimelapsePlan } from '../../utils/timelapsePlan';
import {
  createDefaultGearBag,
  filmBackShortLabel,
  frontFilterShortLabel,
  hasActiveOpticalGear,
  lensMountShortLabel,
  toggleFrontFilter,
  type CameraGearBagState,
  type FilmBackMode,
  type FrontFilterId,
  type MonochromeOpticalFilter,
  type OpticalLensMount,
} from '../../utils/photoAlgorithms';

export type SandboxShootMode = 'photo' | 'astro' | 'timelapse';

const EV_STEPS = [-1.0, -0.5, 0, 0.5, 1.0] as const;
const LENS_ZOOM_PRESETS: ReadonlyArray<{ zoom: number; mm: string; kind: LensKind }> = [
  { zoom: 0.6, mm: '14mm', kind: 'ultrawide' },
  { zoom: 1, mm: '24mm', kind: 'wide' },
  { zoom: 2, mm: '48mm', kind: 'wide' },
  { zoom: 3, mm: '70mm', kind: 'tele' },
  { zoom: 5, mm: '120mm', kind: 'tele' },
  { zoom: 10, mm: '240mm', kind: 'supertele' },
];

interface Props {
  language: Language;
  mode: SandboxShootMode;
  onModeChange: (m: SandboxShootMode) => void;
  exposure: number;
  onExposureChange: (ev: number) => void;
  teleX?: number;
  onChangeTeleX?: (x: number) => void;
  onOpenCameraBag?: () => void;
  gearActive?: boolean;
  gearBadge?: string;
  gearBag?: CameraGearBagState;
  onChangeGearBag?: React.Dispatch<React.SetStateAction<CameraGearBagState>>;
  manualIso?: number | null;
  manualShutterS?: number | null;
  manualWb?: PhotoWbPreset | null;
  onChangeIso?: (iso: number | null) => void;
  onChangeShutter?: (shutterS: number | null) => void;
  onChangeWb?: (wb: PhotoWbPreset | null) => void;
  expoAdvice: ExposureAdvice | null;
  lensMm: string;
  lensText: string;
  astroSettings: AstroSettingsState;
  onAstroSettingsChange: React.Dispatch<React.SetStateAction<AstroSettingsState>>;
  astroSummary: AstroShotSummary;
  astroCaps: AstroCameraCapabilities;
  astroAnalysis: AstroWindowAnalysis | null;
  events: { sunrise: number | null; sunset: number | null };
  nowMs: number;
  tzHours: number;
  sunAltAt: (ms: number) => number;
  timelapsePlan: TimelapsePlan | null;
  onTimelapsePlanChange: (plan: TimelapsePlan) => void;
}

export const SandboxShootPanel: React.FC<Props> = ({
  language,
  mode,
  onModeChange,
  exposure,
  onExposureChange,
  teleX = 1,
  onChangeTeleX,
  onOpenCameraBag,
  gearActive = false,
  gearBadge,
  gearBag,
  onChangeGearBag,
  manualIso = null,
  manualShutterS = null,
  manualWb = null,
  onChangeIso,
  onChangeShutter,
  onChangeWb,
  expoAdvice,
  lensMm,
  lensText,
  astroSettings,
  onAstroSettingsChange,
  astroSummary,
  astroCaps,
  astroAnalysis,
  events,
  nowMs,
  tzHours,
  sunAltAt,
  timelapsePlan,
  onTimelapsePlanChange,
}) => {
  const tabs: Array<{ key: SandboxShootMode; label: string; icon: React.ReactNode }> = [
    { key: 'photo', label: L3(language, '일반', 'Normal', '通常'), icon: <Sun size={13} color={mode === 'photo' ? DARK.accent : TEXT} /> },
    { key: 'astro', label: L3(language, '천체', 'Astro', '天体'), icon: <Moon size={13} color={mode === 'astro' ? DARK.accent : TEXT} /> },
    { key: 'timelapse', label: L3(language, '타임랩스', 'Timelapse', 'タイムラプス'), icon: <Timer size={13} color={mode === 'timelapse' ? DARK.accent : TEXT} /> },
  ];

  const inlineGearSection = gearBag && onChangeGearBag ? (
    <View style={styles.gearCard}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>
          {L3(language, '광학 렌즈 마운트 · 필터 · 필름 (즉시 조절)', 'OPTICAL LENS · FILTER · FILM (LIVE TUNE)', '光学レンズ・フィルター・フィルム')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {hasActiveOpticalGear(gearBag) && (
            <GlassChip
              label={L3(language, '초기화', 'Reset', 'リセット')}
              onPress={() => onChangeGearBag(createDefaultGearBag())}
            />
          )}
          {onOpenCameraBag && (
            <GlassChip
              testID="sb-open-gear-bag"
              icon={<MiniFilterRingIcon active={gearActive} />}
              label={L3(language, '상세 가방', 'Full Bag', '詳細バッグ')}
              active={gearActive}
              onPress={onOpenCameraBag}
            />
          )}
        </View>
      </View>

      {/* 1. 렌즈 마운트 빠른 선택 */}
      <View style={styles.chipRow}>
        {(['standard', 'scheimpflug', 'dolly', 'anamorphic'] as OpticalLensMount[]).map(m => (
          <GlassChip
            key={m}
            label={lensMountShortLabel(m, language)}
            active={gearBag.lensMount === m}
            onPress={() => onChangeGearBag(s => ({ ...s, lensMount: m }))}
          />
        ))}
      </View>

      {/* 선택된 렌즈 마운트 설명 + 인라인 수치 조절 */}
      {gearBag.lensMount === 'scheimpflug' && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '초점 거리 능선만 선명하게 두고 위·아래를 대구경 보케로 흐립니다.',
              'Keeps the chosen distance plane sharp and blurs foreground & sky.',
              '指定距離の稜線にピントを合わせ、上下を大口径ボケでぼかします。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[300, 800, 1200, 2500, 5000].map(dist => (
              <GlassChip
                key={dist}
                label={dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`}
                mono
                active={gearBag.focusDistM === dist}
                onPress={() => onChangeGearBag(s => ({ ...s, focusDistM: dist }))}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            {[-12, 0, 8, 16].map(tp => (
              <GlassChip
                key={tp}
                label={`${L3(language, '틸트', 'Tilt', '傾')} ${tp > 0 ? '+' : ''}${tp}°`}
                mono
                active={gearBag.tiltPitchDeg === tp}
                onPress={() => onChangeGearBag(s => ({ ...s, tiltPitchDeg: tp }))}
              />
            ))}
            {([1.4, 2.0, 2.8, 4.0] as const).map(f => (
              <GlassChip
                key={f}
                label={`f/${f}`}
                mono
                active={gearBag.apertureF === f}
                onPress={() => onChangeGearBag(s => ({ ...s, apertureF: f }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.lensMount === 'dolly' && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '지평선을 기준으로 멀리 있는 산 능선과 해·달을 망원처럼 크게 끌어당깁니다.',
              'Magnifies distant ridges and sun/moon anchored along the horizon.',
              '地平線を基準に遠くの稜線や太陽・月を望遠圧縮して引き寄せます。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[1.25, 1.55, 1.85, 2.2].map(z => (
              <GlassChip
                key={z}
                label={`${z.toFixed(2)}×`}
                mono
                active={Math.abs(gearBag.dollyFarZoom - z) < 0.05}
                onPress={() => onChangeGearBag(s => ({ ...s, dollyFarZoom: z }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.lensMount === 'anamorphic' && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '2.39:1 시네마 레터박스와 함께 광원에서 수평 청록 플레어·선스타 갈래를 만듭니다.',
              '2.39:1 cinema letterbox with horizontal cyan streak flares and sunstar rays.',
              '2.39:1シネマ枠と水平シアンフレア・光条（サンスター）を生成します。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {([6, 8, 10] as const).map(b => (
              <GlassChip
                key={b}
                label={`${b}${L3(language, '갈래', '-ray', '本')}`}
                mono
                active={gearBag.sunstarBlades === b}
                onPress={() => onChangeGearBag(s => ({ ...s, sunstarBlades: b }))}
              />
            ))}
          </View>
        </View>
      )}

      {/* 2. 전면 원형 광학 필터 빠른 토글 (최대 2개) */}
      <Text style={styles.subLabel}>
        {L3(
          language,
          `원형 필터 (${gearBag.frontFilters.length}/2개 선택)`,
          `OPTICAL FILTERS (${gearBag.frontFilters.length}/2)`,
          `円形フィルター (${gearBag.frontFilters.length}/2)`,
        )}
      </Text>
      <View style={styles.chipRow}>
        {(['gnd', 'cpl', 'nd1000', 'dehaze', 'proMist', 'astroClear', 'ghostClean'] as FrontFilterId[]).map(fid => {
          const active = gearBag.frontFilters.includes(fid);
          return (
            <GlassChip
              key={fid}
              label={frontFilterShortLabel(fid, language)}
              active={active}
              onPress={() => onChangeGearBag(s => toggleFrontFilter(s, fid))}
            />
          );
        })}
      </View>

      {/* 장착된 필터별 설명 + 즉시 수치 조절 */}
      {gearBag.frontFilters.includes('gnd') && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '능선 GND: 산 능선 위 하늘만 감광해 노을 노출 오버를 막습니다.',
              'Contour GND: Darkens only the sky above the ridge to preserve sunset highlights.',
              '稜線GND: 稜線より上の空だけを減光し、夕焼けの白飛びを防ぎます。',
            )}
          </Text>
          <View style={styles.chipRow}>
            <GlassChip
              label={L3(language, '리버스(노을)', 'Reverse', 'リバース')}
              active={gearBag.gndMode === 'reverse'}
              onPress={() => onChangeGearBag(s => ({ ...s, gndMode: 'reverse' }))}
            />
            <GlassChip
              label={L3(language, '표준(주간)', 'Standard', '標準')}
              active={gearBag.gndMode === 'standard'}
              onPress={() => onChangeGearBag(s => ({ ...s, gndMode: 'standard' }))}
            />
            {[1.0, 1.8, 2.5, 3.5].map(ev => (
              <GlassChip
                key={ev}
                label={`-${ev.toFixed(1)}EV`}
                mono
                active={Math.abs(gearBag.gndStops - ev) < 0.15}
                onPress={() => onChangeGearBag(s => ({ ...s, gndStops: ev }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.frontFilters.includes('cpl') && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '레일리 CPL: 대기 산란광을 편광 차단해 하늘 색과 구름 대비를 깊게 만듭니다.',
              'Rayleigh CPL: Cuts polarized sky glare to deepen sky tone and cloud contrast.',
              'CPL偏光: 散乱光をカットし、空の深みと雲のコントラストを強めます。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[
              { v: 0.4, label: '40%' },
              { v: 0.78, label: '75%' },
              { v: 1.0, label: '100%' },
            ].map(p => (
              <GlassChip
                key={p.v}
                label={`CPL ${p.label}`}
                mono
                active={Math.abs(gearBag.cplStrength - p.v) < 0.12}
                onPress={() => onChangeGearBag(s => ({ ...s, cplStrength: p.v }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.frontFilters.includes('nd1000') && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              'ND1000: 지형은 고정한 채 구름만 고도별 바람 방향으로 장노출 적분합니다.',
              'ND1000: Blurs clouds along the 3D wind vector while keeping terrain sharp.',
              'ND1000: 地形を固定したまま雲だけを風向に沿って長露光で流します。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[6, 12, 20, 30].map(sec => (
              <GlassChip
                key={sec}
                label={`${sec}s`}
                mono
                active={gearBag.ndDurationSec === sec}
                onPress={() => onChangeGearBag(s => ({ ...s, ndDurationSec: sec }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.frontFilters.includes('dehaze') && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '연무·산수: (-)는 능선 거리별 수묵화 안개 층을 더하고, (+)는 연무를 걷어냅니다.',
              'Haze/Ink: (-) adds layered mountain ink-mist; (+) removes atmospheric haze.',
              '霞・山水: (-)は稜線ごとに水墨画の霞を重ね、(+)は霞を除去して鮮明にします。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[
              { v: -0.8, label: L3(language, '진한 산수화', 'Deep Ink', '濃山水') },
              { v: -0.4, label: L3(language, '은은한 안개', 'Soft Mist', '薄霞') },
              { v: 0.55, label: L3(language, '선명 Dehaze', 'Dehaze', '霞除去') },
              { v: 0.95, label: L3(language, '강한 Dehaze', 'Clear+', '強除去') },
            ].map(p => (
              <GlassChip
                key={p.v}
                label={p.label}
                active={Math.abs(gearBag.dehazeStrength - p.v) < 0.12}
                onPress={() => onChangeGearBag(s => ({ ...s, dehazeStrength: p.v }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.frontFilters.includes('proMist') && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              'Black Pro-Mist: 밝은 노을·구름·야경 하이라이트를 부드럽게 번지게 합니다.',
              'Black Pro-Mist: Creates soft cinematic halation glow around bright highlights.',
              'Black Pro-Mist: ハイライトの周囲に柔らかいシネマ風の光のにじみを作ります。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {([0.125, 0.25, 0.5, 1] as const).map(gr => (
              <GlassChip
                key={gr}
                label={gr === 1 ? 'Grade 1' : `1/${Math.round(1 / gr)}`}
                mono
                active={gearBag.proMistGrade === gr}
                onPress={() => onChangeGearBag(s => ({ ...s, proMistGrade: gr }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.frontFilters.includes('astroClear') && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '광해 컷: 지평선 근처의 노란 도심 나트륨등 광해를 줄이고 밤하늘 색을 살립니다.',
              'Astro-Clear: Suppresses low-altitude yellow sodium skyglow near the horizon.',
              '光害カット: 地平線付近の黄色い都市光害を抑え、夜空本来の色を取り戻します。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[
              { v: 0.45, label: '45%' },
              { v: 0.75, label: '75%' },
              { v: 1.0, label: '100%' },
            ].map(p => (
              <GlassChip
                key={p.v}
                label={p.label}
                mono
                active={Math.abs(gearBag.lightPollutionStrength - p.v) < 0.12}
                onPress={() => onChangeGearBag(s => ({ ...s, lightPollutionStrength: p.v }))}
              />
            ))}
          </View>
        </View>
      )}

      {/* 3. 필름 · 센서 백 빠른 선택 */}
      <Text style={styles.subLabel}>
        {L3(language, '필름 · 센서 백', 'FILM & SENSOR BACK', 'フィルム・センサーバック')}
      </Text>
      <View style={styles.chipRow}>
        {(['natural', 'sunsetWb', 'monoZone'] as FilmBackMode[]).map(fb => (
          <GlassChip
            key={fb}
            label={filmBackShortLabel(fb, language)}
            active={gearBag.filmBack === fb}
            onPress={() => onChangeGearBag(s => ({ ...s, filmBack: fb }))}
          />
        ))}
      </View>

      {gearBag.filmBack === 'sunsetWb' && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '노을 색 락: 황금·진홍빛 노을 색온도와 필름 하이라이트 롤오프를 강화합니다.',
              'Sunset WB Lock: Locks golden-crimson sunset warmth and filmic highlight roll-off.',
              '夕焼色ロック: 黄金〜深紅の夕焼け色温度とフィルム調の階調を強調します。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[
              { v: 0.45, label: '45%' },
              { v: 0.72, label: '75%' },
              { v: 1.0, label: '100%' },
            ].map(p => (
              <GlassChip
                key={p.v}
                label={p.label}
                mono
                active={Math.abs(gearBag.wbStrength - p.v) < 0.12}
                onPress={() => onChangeGearBag(s => ({ ...s, wbStrength: p.v }))}
              />
            ))}
          </View>
        </View>
      )}

      {gearBag.filmBack === 'monoZone' && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              'Zone 흑백: 컬러 필터로 파란 하늘을 어둡게 눌러 구름과 능선 대비를 극대화합니다.',
              'Zone B&W: Optical color filters darken blue sky to dramatize clouds and ridges.',
              'Zone白黒: カラーフィルターで青空を落とし、雲と稜線の陰影を際立たせます。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {([
              { id: 'red25A', label: 'Red 25A' },
              { id: 'orange21', label: 'Orange 21' },
              { id: 'yellow8', label: 'Yellow 8' },
              { id: 'deepSky', label: 'IR Deep' },
              { id: 'neutral', label: 'Neutral' },
            ] as ReadonlyArray<{ id: MonochromeOpticalFilter; label: string }>).map(mc => (
              <GlassChip
                key={mc.id}
                label={mc.label}
                mono
                active={gearBag.monoFilter === mc.id}
                onPress={() => onChangeGearBag(s => ({ ...s, monoFilter: mc.id }))}
              />
            ))}
          </View>
        </View>
      )}

      {/* 4. 3D 지형·건물 가이드 → 이미지 경계 추론 보정 */}
      <Text style={styles.subLabel}>
        {L3(
          language,
          '지형 가이드 → 이미지 경계 추론 보정',
          '3D GUIDE → IMAGE SKYLINE CALIBRATION',
          '地形ガイド → 画像境界推論補正',
        )}
      </Text>
      <View style={styles.chipRow}>
        <GlassChip
          label={L3(language, '경계 비교선 (점선=3D / 실선=추론)', 'Compare Lines (3D vs Image)', '境界比較線（点線=3D / 実線=推論）')}
          active={gearBag.showSkylineCompare || gearBag.frontFilters.includes('gnd')}
          onPress={() => onChangeGearBag(s => ({ ...s, showSkylineCompare: !s.showSkylineCompare }))}
        />
      </View>
      {(gearBag.showSkylineCompare ||
        gearBag.frontFilters.includes('gnd') ||
        gearBag.frontFilters.includes('nd1000') ||
        gearBag.frontFilters.includes('dehaze')) && (
        <View style={styles.tuneBox}>
          <Text style={styles.tuneDesc}>
            {L3(
              language,
              '3D 지형(노란 점선)을 시작 가이드로 삼아 탐색 폭 안에서 이미지의 실제 건물·능선 명암 경계(초록 실선)를 찾아 밀착합니다.',
              'Uses 3D terrain (yellow dashed) as a prior guide to snap onto actual building & ridge edges (green solid) in the image.',
              '3D地形（黄点線）をガイドに、画像内の建物や実際の稜線境界（緑実線）を推論して密着させます。',
            )}
          </Text>
          <View style={styles.chipRow}>
            {[
              { v: 0.22, label: L3(language, '이미지·건물 우선', 'Image/Bldg First', '画像・建物優先') },
              { v: 0.45, label: L3(language, '균형 추론', 'Balanced', 'バランス') },
              { v: 0.80, label: L3(language, '3D 지형 우선', '3D Guide First', '3D地形優先') },
            ].map(p => (
              <GlassChip
                key={p.v}
                label={p.label}
                active={Math.abs((gearBag.skylinePriorWeight ?? 0.45) - p.v) < 0.12}
                onPress={() => onChangeGearBag(s => ({ ...s, skylinePriorWeight: p.v }))}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            {[
              { v: 0.07, label: L3(language, '탐색 좁게 ±7%', 'Narrow ±7%', '探索狭 ±7%') },
              { v: 0.14, label: L3(language, '탐색 표준 ±14%', 'Std ±14%', '探索標準 ±14%') },
              { v: 0.22, label: L3(language, '탐색 넓게 ±22%', 'Wide ±22%', '探索広 ±22%') },
            ].map(p => (
              <GlassChip
                key={p.v}
                label={p.label}
                mono
                active={Math.abs((gearBag.skylineSearchNorm ?? 0.14) - p.v) < 0.03}
                onPress={() => onChangeGearBag(s => ({ ...s, skylineSearchNorm: p.v }))}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  ) : null;

  return (
    <View testID="sandbox-shoot-panel" style={styles.root}>
      {/* 고정 세그먼트 탭 바 (스크롤되지 않음) */}
      <View style={styles.tabBar} accessibilityRole="tablist">
        {tabs.map(tab => {
          const active = mode === tab.key;
          return (
            <Pressable
              key={tab.key}
              testID={`sb-shoot-${tab.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onModeChange(tab.key)}
              style={[styles.tabItem, active && styles.tabItemActive]}
            >
              {tab.icon}
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {tab.label}
              </Text>
              {active && <View style={styles.tabIndicator} />}
            </Pressable>
          );
        })}
      </View>

      {/* 탭 본문 (내부 스크롤) */}
      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {mode === 'photo' && (
          <View style={styles.section}>
            {(onChangeTeleX || onOpenCameraBag) && (
              <>
                <View style={styles.headerRow}>
                  <Text style={styles.label}>{L3(language, '렌즈 · 배율', 'LENS · ZOOM', 'レンズ · 倍率')}</Text>
                  {onOpenCameraBag && (
                    <GlassChip
                      testID="sb-open-gear-bag"
                      icon={<MiniFilterRingIcon active={gearActive} />}
                      label={gearBadge
                        ? `${L3(language, '광학 가방', 'Gear Bag', '光学バッグ')} · ${gearBadge}`
                        : L3(language, '광학 렌즈·필터 ▾', 'Optical Gear ▾', '光学レンズ・フィルター ▾')}
                      active={gearActive}
                      onPress={onOpenCameraBag}
                    />
                  )}
                </View>
                {onChangeTeleX && (
                  <View style={styles.chipRow}>
                    {LENS_ZOOM_PRESETS.map(p => {
                      const isSel = Math.abs(teleX - p.zoom) < 0.08;
                      return (
                        <GlassChip
                          key={p.zoom}
                          icon={<MiniLensBarrelIcon active={isSel} kind={p.kind} />}
                          label={`${p.zoom}x · ${p.mm}`}
                          mono
                          active={isSel}
                          onPress={() => onChangeTeleX(p.zoom)}
                        />
                      );
                    })}
                  </View>
                )}
              </>
            )}
            <Text style={styles.label}>{L3(language, '노출 보정 (EV)', 'EXPOSURE (EV)', '露出補正 (EV)')}</Text>
            <View style={styles.chipRow}>
              {EV_STEPS.map(ev => (
                <GlassChip
                  key={ev}
                  label={ev === 0 ? '0' : `${ev > 0 ? '+' : ''}${ev.toFixed(1)}`}
                  mono
                  active={Math.abs(exposure - ev) < 0.05}
                  onPress={() => onExposureChange(ev)}
                />
              ))}
            </View>
            {expoAdvice ? (
              <ExposureCells
                language={language}
                advice={expoAdvice}
                lensMm={lensMm}
                lensText={lensText}
                onPressLens={onOpenCameraBag}
                gearSummary={gearBadge}
                gearActive={gearActive}
                manualIso={manualIso}
                manualShutterS={manualShutterS}
                manualWb={manualWb}
                onChangeIso={onChangeIso}
                onChangeShutter={onChangeShutter}
                onChangeWb={onChangeWb}
              />
            ) : null}
            {inlineGearSection}
          </View>
        )}

        {mode === 'astro' && (
          <View style={styles.section}>
            {inlineGearSection ?? (onOpenCameraBag && (
              <View style={styles.headerRow}>
                <Text style={styles.label}>{L3(language, '확장 광학 · 필터', 'OPTICAL GEAR', '拡張光学・フィルター')}</Text>
                <GlassChip
                  testID="sb-astro-open-gear-bag"
                  icon={<MiniFilterRingIcon active={gearActive} />}
                  label={gearBadge
                    ? `${L3(language, '광학 가방', 'Gear Bag', '光学バッグ')} · ${gearBadge}`
                    : L3(language, '광학 렌즈·필터 ▾', 'Optical Gear ▾', '光学レンズ・フィルター ▾')}
                  active={gearActive}
                  onPress={onOpenCameraBag}
                />
              </View>
            ))}
            <AstroForecastBanner
              analysis={astroAnalysis}
              durationSec={astroSettings.durationSec}
              language={language}
            />
            <AstroSettingsPanel
              settings={astroSettings}
              onChange={onAstroSettingsChange}
              summary={astroSummary}
              caps={astroCaps}
              language={language}
            />
          </View>
        )}

        {mode === 'timelapse' && (
          <View style={styles.section}>
            {(timelapsePlan?.kind ?? 'plain') !== 'plain' && (
              <AstroForecastBanner
                analysis={astroAnalysis}
                durationSec={(timelapsePlan?.totalMin ?? 60) * 60}
                language={language}
              />
            )}
            <TimelapsePanel
              inline
              visible
              language={language}
              events={events}
              nowMs={nowMs}
              tzHours={tzHours}
              sunAltAt={sunAltAt}
              initialPlan={timelapsePlan}
              onPlanChange={onTimelapsePlanChange}
              onClose={() => {}}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { maxHeight: '100%' },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingTop: 4,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    position: 'relative',
  },
  tabItemActive: {
    backgroundColor: `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha * 0.7})`,
  },
  tabText: {
    color: TEXT,
    opacity: 0.72,
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    opacity: 1,
    color: TEXT,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: DARK.accent,
  },
  bodyScroll: { flexGrow: 0 },
  bodyContent: { padding: 12, gap: 10 },
  section: { gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { color: TEXT, opacity: 0.72, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  subLabel: { color: TEXT, opacity: 0.62, fontSize: 9.5, fontWeight: '600', letterSpacing: 0.4, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gearCard: {
    marginTop: 4,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(10, 15, 26, 0.45)',
    gap: 8,
  },
  tuneBox: {
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    gap: 6,
  },
  tuneDesc: {
    color: TEXT,
    opacity: 0.85,
    fontSize: 11,
    lineHeight: 15,
  },
});
