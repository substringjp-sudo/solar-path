/**
 * SceneSheet.tsx — **저장한 장면 시트**(docs/SANDBOX_MODE_PLAN.md 12.3, 목업 20 "저장한 장면"). 아래에서 올라오는 어두운 시트입니다.
 *
 *  - 맨 위 설명: "자리, 눈 높이, 보는 방향, 줌, 날짜와 시각, 고른 대상을 그대로 저장해요. 이 기기에만 있어요."
 *  - "지금 장면": 이름을 적고(비우면 "11.24 18:12 장면" 같은 기본 이름) "저장". 아래에 지금 장면의 요약(날짜와 시각 · 눈 높이 · 방위 · 줌)과 고른 대상이 한 줄로 보입니다.
 *  - 목록(최신순): 이름 / 요약 / 대상 또는 하늘 글("일몰 · 남서쪽 하늘"). 줄 끝의 "열기"가 그 장면으로 샌드박스를 엽니다. 더 보기(⋯)에 이름 바꾸기와 삭제.
 *    삭제는 줄 안에서 "지울까요?" 를 한 번 더 묻습니다(경고창 대신 — 어느 화면에서나 같게 동작하고 확인할 수 있습니다).
 *  - 저장 결과는 시트 안 글로 알립니다: 저장했어요 · 가득 찼어요(50 개) · 지금 장면을 못 읽었어요.
 *
 * 글(요약 · 하늘 글)은 `utils/savedScenes.ts` 가 만듭니다. 하늘 위에 떠 있는 것이라 화면 모드와 상관없이 어두운 재질을 씁니다.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, MoreHorizontal, X } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { SAVED_SCENE_MAX, SCENE_NAME_MAX, sceneNote, sceneSummary, sunNoteAt, type SavedScene } from '../../utils/savedScenes';

type Lang = 'ko' | 'en' | 'ja';

export type SaveResult = 'saved' | 'full' | 'unavailable';

interface Props {
  visible: boolean;
  language: Lang;
  /** 최신순 목록 */
  scenes: readonly SavedScene[];
  /** 지금 장면(저장 전 미리보기). 장면이 아직 안 올라와 읽을 수 없으면 null. */
  draft: SavedScene | null;
  nowMs: number;
  /** 장면의 시각을 읽을 시간대(시간) */
  tzHours: number;
  /** 이름을 받아 저장합니다(비어 있으면 기본 이름). */
  onSave: (name: string) => SaveResult;
  onOpen: (scene: SavedScene) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export const SceneSheet: React.FC<Props> = ({ visible, language, scenes, draft, nowMs, tzHours, onSave, onOpen, onRename, onRemove, onClose }) => {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<SaveResult | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const ctx = { nowMs, tzHours, lang: language };
  const rows = useMemo(
    () => scenes.map(s => ({ s, summary: sceneSummary(s, ctx), note: sceneNote(s, sunNoteAt(s.timeMs, s.latitude, s.longitude), language) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenes, nowMs, tzHours, language],
  );
  const draftSummary = draft ? sceneSummary(draft, ctx) : null;
  const draftNote = draft ? sceneNote(draft, sunNoteAt(draft.timeMs, draft.latitude, draft.longitude), language) : null;

  const closeAll = () => { setMenuId(null); setEditId(null); setConfirmId(null); setStatus(null); onClose(); };
  const save = () => {
    const r = onSave(name);
    setStatus(r);
    if (r === 'saved') setName('');
  };
  const startEdit = (s: SavedScene) => { setEditId(s.id); setEditText(s.name); setMenuId(null); setConfirmId(null); };
  const commitEdit = () => { if (editId) onRename(editId, editText); setEditId(null); };

  const statusText: Record<SaveResult, string> = {
    saved: L3(language, '저장했어요', 'Saved', '保存しました'),
    full: L3(language, `장면이 가득 찼어요(${SAVED_SCENE_MAX}개). 하나를 지우고 다시 저장해요.`, `The list is full (${SAVED_SCENE_MAX}). Delete one and try again.`, `いっぱいです(${SAVED_SCENE_MAX}件)。1つ削除してからもう一度保存してください。`),
    unavailable: L3(language, '지금 장면을 읽지 못했어요. 잠시 뒤에 다시 눌러 주세요.', "Couldn't read the current scene. Try again in a moment.", '現在のシーンを読めませんでした。少ししてからもう一度。'),
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeAll} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.scrim} onPress={closeAll} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{L3(language, '저장한 장면', 'Saved scenes', '保存したシーン')}</Text>
            <OverlayButton onPress={closeAll} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} style={styles.closeBtn}>
              <X size={14} color={DARK.text} />
            </OverlayButton>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.info}>
              {L3(
                language,
                '자리, 눈 높이, 보는 방향, 줌, 날짜와 시각, 고른 대상을 그대로 저장해요. 이 기기에만 있어요.',
                'Saves the place, eye height, view direction, zoom, date and time, and the picked target. Stays on this device only.',
                '場所・目の高さ・見る方向・ズーム・日時・選んだ対象をそのまま保存します。この端末にだけ保存されます。',
              )}
            </Text>

            <Text style={styles.label}>{L3(language, '지금 장면', 'Current scene', '今のシーン')}</Text>
            <View style={styles.card}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={draft?.name ?? L3(language, '이름', 'Name', '名前')}
                placeholderTextColor={DARK.textMute}
                maxLength={SCENE_NAME_MAX * 2}
                style={styles.input}
                accessibilityLabel={L3(language, '장면 이름', 'Scene name', 'シーン名')}
                onSubmitEditing={save}
                returnKeyType="done"
              />
              {draftSummary != null ? (
                <>
                  <Text style={styles.summary} numberOfLines={1}>{draftSummary}</Text>
                  {draftNote ? <Text style={styles.note} numberOfLines={1}>{draftNote}</Text> : null}
                </>
              ) : (
                <Text style={styles.summary}>{L3(language, '장면을 읽는 중…', 'Reading the scene…', 'シーンを読み取り中…')}</Text>
              )}
              <View style={styles.saveRow}>
                <Text style={[styles.status, status === 'saved' && { color: DARK.success }, (status === 'full' || status === 'unavailable') && { color: DARK.danger }]} numberOfLines={2}>
                  {status ? statusText[status] : ''}
                </Text>
                <OverlayButton active onPress={save} accessibilityLabel={L3(language, '저장', 'Save', '保存')} style={styles.saveBtn}>
                  <Text style={styles.saveText}>{L3(language, '저장', 'Save', '保存')}</Text>
                </OverlayButton>
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>{`${L3(language, '저장한 장면', 'Saved scenes', '保存したシーン')} · ${scenes.length}`}</Text>
            {rows.length === 0 && <Text style={styles.empty}>{L3(language, '저장한 장면이 아직 없어요', 'No saved scenes yet', '保存したシーンはまだありません')}</Text>}
            {rows.map(({ s, summary, note }) => (
              <View key={s.id} style={styles.row}>
                <View style={styles.rowTop}>
                  {editId === s.id ? (
                    <TextInput
                      value={editText}
                      onChangeText={setEditText}
                      autoFocus
                      maxLength={SCENE_NAME_MAX * 2}
                      style={[styles.input, styles.editInput]}
                      accessibilityLabel={L3(language, '새 이름', 'New name', '新しい名前')}
                      onSubmitEditing={commitEdit}
                      returnKeyType="done"
                    />
                  ) : (
                    <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                  )}
                  {editId === s.id ? (
                    <>
                      <OverlayButton active onPress={commitEdit} accessibilityLabel={L3(language, '확인', 'OK', 'OK')} style={styles.smallBtn}>
                        <Check size={14} color={DARK.accent} />
                      </OverlayButton>
                      <OverlayButton onPress={() => setEditId(null)} accessibilityLabel={L3(language, '취소', 'Cancel', 'キャンセル')} style={styles.smallBtn}>
                        <X size={14} color={DARK.text} />
                      </OverlayButton>
                    </>
                  ) : (
                    <>
                      <OverlayButton active onPress={() => onOpen(s)} accessibilityLabel={`${L3(language, '열기', 'Open', '開く')}: ${s.name}`} style={styles.openBtn}>
                        <Text style={styles.openText}>{L3(language, '열기', 'Open', '開く')}</Text>
                      </OverlayButton>
                      <OverlayButton
                        onPress={() => { setMenuId(menuId === s.id ? null : s.id); setConfirmId(null); }}
                        accessibilityLabel={`${L3(language, '더 보기', 'More', 'その他')}: ${s.name}`}
                        style={styles.smallBtn}
                      >
                        <MoreHorizontal size={14} color={DARK.text} />
                      </OverlayButton>
                    </>
                  )}
                </View>
                <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
                {note !== '' && <Text style={styles.note} numberOfLines={1}>{note}</Text>}
                {menuId === s.id && confirmId !== s.id && editId !== s.id && (
                  <View style={styles.menu}>
                    <OverlayButton onPress={() => startEdit(s)} accessibilityLabel={L3(language, '이름 바꾸기', 'Rename', '名前を変える')} style={styles.menuBtn}>
                      <Text style={styles.menuText}>{L3(language, '이름 바꾸기', 'Rename', '名前を変える')}</Text>
                    </OverlayButton>
                    <OverlayButton onPress={() => setConfirmId(s.id)} accessibilityLabel={L3(language, '삭제', 'Delete', '削除')} style={styles.menuBtn}>
                      <Text style={[styles.menuText, { color: DARK.danger }]}>{L3(language, '삭제', 'Delete', '削除')}</Text>
                    </OverlayButton>
                  </View>
                )}
                {confirmId === s.id && (
                  <View style={styles.menu}>
                    <Text style={styles.confirmText}>{L3(language, '지울까요?', 'Delete this scene?', '削除しますか?')}</Text>
                    <OverlayButton onPress={() => { onRemove(s.id); setConfirmId(null); setMenuId(null); }} accessibilityLabel={L3(language, '지우기', 'Delete', '削除する')} style={styles.menuBtn}>
                      <Text style={[styles.menuText, { color: DARK.danger }]}>{L3(language, '지우기', 'Delete', '削除する')}</Text>
                    </OverlayButton>
                    <OverlayButton onPress={() => { setConfirmId(null); setMenuId(null); }} accessibilityLabel={L3(language, '취소', 'Cancel', 'キャンセル')} style={styles.menuBtn}>
                      <Text style={styles.menuText}>{L3(language, '취소', 'Cancel', 'キャンセル')}</Text>
                    </OverlayButton>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: DARK.scrim },
  sheet: {
    maxHeight: '86%', backgroundColor: DARK.panel, borderColor: DARK.border, borderWidth: 1,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: '800', color: DARK.text },
  closeBtn: { width: 32, height: 32 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  info: { fontSize: 12, lineHeight: 17, color: DARK.textDim, marginBottom: 8 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 0.8, color: DARK.textMute },
  card: { gap: 8, padding: 10, backgroundColor: DARK.fill, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.md },
  input: {
    height: 38, paddingHorizontal: 10, fontSize: 14, color: DARK.text,
    backgroundColor: DARK.panelRaised, borderColor: DARK.borderStrong, borderWidth: 1, borderRadius: radius.sm,
  },
  editInput: { flex: 1, minWidth: 0, height: 34 },
  summary: { fontFamily: mono, fontSize: 11, color: DARK.textDim },
  note: { fontSize: 11, color: DARK.textMute },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, minWidth: 0, fontSize: 11, color: DARK.textDim },
  saveBtn: { width: 'auto', minWidth: 64, height: 34, paddingHorizontal: 14 },
  saveText: { fontSize: 13, fontWeight: '800', color: DARK.accent },
  empty: { fontSize: 12, color: DARK.textMute, paddingVertical: 12 },
  row: { gap: 3, padding: 10, backgroundColor: DARK.fill, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: DARK.text },
  openBtn: { width: 'auto', minWidth: 52, height: 30, paddingHorizontal: 10 },
  openText: { fontSize: 12, fontWeight: '800', color: DARK.accent },
  smallBtn: { width: 32, height: 30 },
  menu: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  menuBtn: { width: 'auto', minWidth: 72, height: 30, paddingHorizontal: 10 },
  menuText: { fontSize: 12, fontWeight: '700', color: DARK.text },
  confirmText: { fontSize: 12, color: DARK.textDim },
});
