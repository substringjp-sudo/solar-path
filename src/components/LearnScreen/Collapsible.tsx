/**
 * Collapsible.tsx — 학습 페이지의 접는 부품 둘(docs/SANDBOX_MODE_PLAN.md 13.2, 목업 21 · 22).
 *
 * 학습 페이지는 **항목마다 중요한 정보만 먼저 보이고, 부차적인 것은 접어 두었다가 누르면 펼칩니다**(사용자 결정 2026-11-20).
 *
 *  - `Collapsible` : 카드 하나. 머리 줄(화살표 · 제목 · 오른쪽 값)과 그 아래 `peek`(한 줄 이유)는 늘 보이고,
 *    머리 줄을 누르면 `children` 이 펼쳐집니다. 화살표가 오른쪽을 가리키면 접힘, 아래를 가리키면 펼침입니다.
 *  - `Fold` : 카드 밖에서 목록 끝에 붙는 "더 보기" 줄. 접혀 있으면 점선 단추 하나만, 펼치면 `children` 과 "접기" 단추.
 *
 * 밖에서 펼침을 정할 수도 있습니다(`open`). 값이 바뀔 때마다 그 값으로 맞추므로, 점수 숫자나 카드를 눌러 들어온 길에서
 * 해당 줄이 펼쳐진 채 시작할 수 있습니다. 손으로 접고 펼친 것은 `onOpenChange` 로 알려 줍니다.
 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import { PressScale } from '../ui';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { radius, space, type, TOUCH } from '../../theme/tokens';

interface CollapsibleProps {
  title: string;
  /** 머리 줄 오른쪽 값(접혀 있어도 보임). 문자열이거나 꾸민 노드(점수 같은 것). */
  right?: React.ReactNode;
  /** 머리 줄 아래 한 줄(접혀 있어도 보임) — 항목의 가장 중요한 이유 */
  peek?: React.ReactNode;
  /** 제목을 크게(과정의 주제 머리처럼 항목 머리일 때) */
  big?: boolean;
  /** 강조 테두리(들어온 길에서 가리킨 항목) */
  accent?: boolean;
  defaultOpen?: boolean;
  /** 주면 이 값으로 맞춥니다(값이 바뀔 때마다). 안 주면 손으로만. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export const Collapsible: React.FC<CollapsibleProps> = ({ title, right, peek, big, accent, defaultOpen = false, open, onOpenChange, children }) => {
  const color = useThemeColors();
  const styles = useStyles();
  const [isOpen, setOpen] = useState(open ?? defaultOpen);
  useEffect(() => { if (open != null) setOpen(open); }, [open]);
  const toggle = () => { const next = !isOpen; setOpen(next); onOpenChange?.(next); };
  return (
    <View style={[styles.card, accent && styles.accent]}>
      <PressScale
        style={styles.head}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={title}
        accessibilityHint={isOpen ? '누르면 접습니다' : '누르면 자세한 내용이 펼쳐집니다'}
      >
        {isOpen ? <ChevronDown size={14} color={color.accent} /> : <ChevronRight size={14} color={color.textMute} />}
        <Text style={big ? styles.titleBig : styles.title} numberOfLines={1}>{title}</Text>
        {typeof right === 'string' ? <Text style={styles.rightText} numberOfLines={1}>{right}</Text> : right}
      </PressScale>
      {typeof peek === 'string' ? <Text style={styles.peek}>{peek}</Text> : peek}
      {isOpen ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
};

interface FoldProps {
  /** 접혀 있을 때 단추의 글("일정 3개 더 보기") */
  label: string;
  /** 펼쳤을 때 맨 끝 단추의 글(기본 "접기") */
  closeLabel?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export const Fold: React.FC<FoldProps> = ({ label, closeLabel = '접기', defaultOpen = false, open, onOpenChange, children }) => {
  const color = useThemeColors();
  const styles = useStyles();
  const [isOpen, setOpen] = useState(open ?? defaultOpen);
  useEffect(() => { if (open != null) setOpen(open); }, [open]);
  const set = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  return (
    <View style={styles.foldWrap}>
      {isOpen ? children : null}
      <PressScale
        style={styles.foldBtn}
        onPress={() => set(!isOpen)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={isOpen ? closeLabel : label}
      >
        <Text style={styles.foldText}>{isOpen ? closeLabel : label}</Text>
        {isOpen ? <ChevronUp size={14} color={color.textDim} /> : <ChevronDown size={14} color={color.textDim} />}
      </PressScale>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  card: { backgroundColor: color.panel, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  accent: { borderWidth: 1, borderColor: color.accentLine },
  head: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...type.bodyStrong, flex: 1, color: color.text },
  titleBig: { ...type.title, flex: 1, color: color.text, fontSize: 16 },
  rightText: { ...type.body, color: color.textDim, flexShrink: 1, textAlign: 'right' },
  peek: { ...type.body, color: color.textDim },
  body: { gap: space.xs, paddingTop: space.xs },
  foldWrap: { gap: space.sm },
  foldBtn: {
    minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
    borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: color.borderStrong,
  },
  foldText: { ...type.body, color: color.textDim },
}));
