/**
 * SceneBar.tsx — 샌드박스 아래 패널의 **"장면 저장 · 저장한 장면" 줄**(docs/SANDBOX_MODE_PLAN.md 12.3, 목업 2번 "장면 저장 / 저장한 장면 / 모두 3").
 *
 *  - "장면 저장": 저장한 장면 시트를 엽니다(거기서 이름을 적고 저장합니다).
 *  - 저장한 장면 칩: 가장 최근 두 장면의 이름. 누르면 그 장면을 바로 엽니다.
 *  - "모두 N": 시트의 목록을 엽니다. 저장한 장면이 없으면 안내 글만 보입니다.
 *  - "이 장면 찍기": 저장하지 않은 지금 장면도 그대로 카메라로 넘깁니다(계획 12.3).
 *
 * 고른 대상이 있으면 객체 정보 패널(`ObjectInfoPanel`) 안에, 없으면 이 줄만 따로 아래에 뜹니다. 하늘 위에 떠 있는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BookmarkPlus, Camera } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import type { SavedScene } from '../../utils/savedScenes';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  language: Lang;
  /** 최신순 목록 */
  scenes: readonly SavedScene[];
  /** "장면 저장": 시트를 엽니다. */
  onSave: () => void;
  /** 칩: 그 장면을 바로 엽니다. */
  onOpen: (scene: SavedScene) => void;
  /** "모두 N": 시트의 목록을 엽니다. */
  onAll: () => void;
  /** "이 장면 찍기": 저장하지 않은 지금 장면도 그대로 카메라로 넘깁니다. 없으면 단추를 그리지 않습니다. */
  onShoot?: () => void;
  /** 어두운 바탕 상자로 감쌀지(패널 안에 넣을 때는 거짓). */
  boxed?: boolean;
}

/** 줄에 칩으로 보이는 최근 장면 수. */
export const SCENE_CHIPS_SHOWN = 2;

export const SceneBar: React.FC<Props> = ({ language, scenes, onSave, onOpen, onAll, onShoot, boxed = false }) => {
  const recent = scenes.slice(0, SCENE_CHIPS_SHOWN);
  return (
    <View style={[styles.row, boxed && styles.boxed]}>
      <OverlayButton onPress={onSave} accessibilityLabel={L3(language, '장면 저장', 'Save scene', 'シーンを保存')} style={styles.saveBtn}>
        <BookmarkPlus size={14} color={DARK.accent} />
        <Text style={styles.saveText}>{L3(language, '장면 저장', 'Save scene', 'シーン保存')}</Text>
      </OverlayButton>
      {onShoot && (
        <OverlayButton onPress={onShoot} accessibilityLabel={L3(language, '이 장면 찍기: 카메라로 넘기기', 'Shoot this scene: open the camera', 'このシーンを撮る: カメラへ')} style={styles.saveBtn}>
          <Camera size={14} color={DARK.accent} />
          <Text style={styles.saveText}>{L3(language, '이 장면 찍기', 'Shoot', '撮る')}</Text>
        </OverlayButton>
      )}
      {scenes.length === 0 ? (
        <Text style={styles.hint} numberOfLines={1}>{L3(language, '저장한 장면이 없어요', 'No saved scenes', '保存したシーンなし')}</Text>
      ) : (
        <>
          <Text style={styles.label}>{L3(language, '저장한 장면', 'Saved', '保存済み')}</Text>
          {recent.map(s => (
            <OverlayButton
              key={s.id}
              onPress={() => onOpen(s)}
              accessibilityLabel={`${L3(language, '장면 열기', 'Open scene', 'シーンを開く')}: ${s.name}`}
              style={styles.chip}
            >
              <Text style={styles.chipText} numberOfLines={1}>{s.name}</Text>
            </OverlayButton>
          ))}
          <OverlayButton
            onPress={onAll}
            accessibilityLabel={`${L3(language, '저장한 장면 모두 보기', 'See all saved scenes', '保存したシーンをすべて見る')} ${scenes.length}`}
            style={styles.allBtn}
          >
            <Text style={styles.chipText}>{`${L3(language, '모두', 'All', 'すべて')} ${scenes.length}`}</Text>
          </OverlayButton>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  boxed: {
    paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: DARK.overlay, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.sm,
  },
  saveBtn: { width: 'auto', minWidth: 84, height: 30, paddingHorizontal: 8, flexDirection: 'row', gap: 4, flexShrink: 0 },
  saveText: { fontSize: 11, fontWeight: '700', color: DARK.accent },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 0.6, color: DARK.textMute },
  hint: { fontFamily: mono, fontSize: 10, color: DARK.textDim, flexShrink: 1 },
  chip: { width: 'auto', maxWidth: 120, height: 28, paddingHorizontal: 8, flexShrink: 1 },
  allBtn: { width: 'auto', height: 28, paddingHorizontal: 8, flexShrink: 0 },
  chipText: { fontSize: 11, fontWeight: '700', color: DARK.text },
});
