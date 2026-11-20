/**
 * calcTopic.ts — 학습 페이지의 "결과가 나온 과정"이 주제마다 단계 카드를 만드는 길.
 *
 * 주제 다섯(노을 점수 · 해 뜨는 시각 · 해 지는 시각 · 별 보기 · 구름 모양)마다 `calcSteps.ts` 의 맞는 만드는 함수를 부릅니다.
 * 처음에는 `CalcStepsView`(왜 그런가요 창) 안의 `useMemo` 였고, 학습 페이지가 다섯 주제를 한꺼번에 접는 줄로 보이면서 따로 꺼냈습니다.
 *
 *  - 입력이 없는 주제는 **null** 입니다(노을 점수 · 별 보기 · 구름 모양). 자료가 없는 것을 숨기거나 맑다고 지어내지 않습니다.
 *  - 해 뜨는 · 지는 시각은 날짜와 장소만 있으면 됩니다. 수평선 프로필(땅 스카이라인)이 없으면 평평한 수평선으로 셉니다.
 *  - 시각 글꼴(`fmtTime`)은 부르는 쪽이 정합니다. 학습 페이지는 관측지 시간대로 적습니다(기기 시간대와 다를 수 있음).
 *
 * 판정: `tools/shader-preview/verify-learn-sections.js` 의 [7]
 */
import {
  buildCloudShapeCards,
  buildStarCards,
  buildSunHorizonCards,
  buildSunsetScoreCards,
  type BuildCloudShapeArgs,
  type BuildStarArgs,
  type BuildSunsetScoreArgs,
  type StepCard,
} from './calcSteps';
import { skylineAngleDeg, type HorizonProfile } from './horizon';
import type { LearnTopic } from './learnSections';

type Lang = 'ko' | 'en' | 'ja';

/** 한 주제의 결과: 제목 · 단계 카드 · 맺음말(+ 어느 사건의 것인지). */
export interface TopicResult {
  title: string;
  cards: StepCard[];
  footnote: string;
  /** "일몰 17:42" 처럼 어느 출몰의 점수인지(노을 점수 · 별 보기에만) */
  eventLabel?: string | null;
}

export interface TopicInputs {
  language: Lang;
  /** 해 뜨고 지는 시각을 풀 날짜(고른 날) */
  date: Date;
  latitude: number;
  longitude: number;
  fmtTime: (ms: number) => string;
  /** 눈에서 본 땅 프로필. 없으면 평평한 수평선. */
  horizon?: HorizonProfile | null;
  scoreInput?: Pick<BuildSunsetScoreArgs, 'prediction' | 'ring' | 'time' | 'eventMs' | 'sunAzDeg' | 'kind'> | null;
  starArgs?: Omit<BuildStarArgs, 'language' | 'fmtTime'> | null;
  cloudArgs?: Omit<BuildCloudShapeArgs, 'language'> | null;
  /** 앱의 판정 단어(좋음 · 훌륭함 …). 없으면 영어 판정 이름 그대로. */
  qualityWord?: (quality: string) => string;
}

export function buildTopicResult(topic: LearnTopic, a: TopicInputs): TopicResult | null {
  const { language, fmtTime } = a;
  if (topic === 'score') {
    return a.scoreInput ? buildSunsetScoreCards({ ...a.scoreInput, language, fmtTime, qualityWord: a.qualityWord ?? ((q) => q) }) : null;
  }
  if (topic === 'stars') {
    return a.starArgs ? buildStarCards({ ...a.starArgs, language, fmtTime }) : null;
  }
  if (topic === 'cloud') {
    return a.cloudArgs ? buildCloudShapeCards({ ...a.cloudArgs, language }) : null;
  }
  const profile = a.horizon ?? null;
  const skyline = profile ? (az: number) => { const v = skylineAngleDeg(profile, az); return v > -89 ? v : null; } : null;
  return buildSunHorizonCards({
    kind: topic === 'sunrise' ? 'rise' : 'set',
    date: a.date, lat: a.latitude, lon: a.longitude, language, skyline, profile, fmtTime,
  });
}
