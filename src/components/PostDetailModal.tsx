import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Image,
  ScrollView,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import {
  X,
  Heart,
  Share2,
  Lock,
  Globe,
  MapPin,
  CloudSun,
  Eye,
  Droplets,
  Sparkles, Flag, ThumbsUp, ThumbsDown } from 'lucide-react-native';
import { MyPhoto, useCelestialStore } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { shareToSns, SnsPlatform } from '../utils/snsShare';
import { L3 } from '../utils/i18n';
import { color, radius, mono } from '../theme/tokens';
import { PressScale } from './ui';
import { reportPhoto, REPORT_REASONS, type ReportReason } from '../utils/reportContent';

const { width: W } = Dimensions.get('window');

interface PostDetailModalProps {
  visible: boolean;
  photo: MyPhoto | null;
  onClose: () => void;
}

export const PostDetailModal: React.FC<PostDetailModalProps> = ({ visible, photo, onClose }) => {
  const [likesCount, setLikesCount] = useState(photo?.likesCount || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [showSnsSelector, setShowSnsSelector] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const [currentFeedback, setCurrentFeedback] = useState<'good' | 'bad' | null>(photo?.userFeedback || null);
  const hidePhoto = useCelestialStore((s) => s.hidePhoto);
  const blockUser = useCelestialStore((s) => s.blockUser);
  const setPhotoFeedback = useCelestialStore((s) => s.setPhotoFeedback);

  const togglePhotoVisibility = useCelestialStore((s) => s.togglePhotoVisibility);
  const language = useCelestialStore((s) => s.language);
  // ⚠ 예전 식은 끝에 `|| true` 가 붙어 **늘 참**이었습니다 — 남의 게시물에도 "공유하기"(누르면 전체
  //   공개로 바뀜)가 떴습니다(점검 2026-09-29). 서버 게시물은 userId 로 가리고, userId 가 없는
  //   것(이 기기의 내 사진)만 내 것으로 봅니다.
  const ownerId: string | undefined = (photo as any)?.userId;
  const isMyPhoto = !!photo && (ownerId ? ownerId === auth.currentUser?.uid : true);

  if (!photo) return null;

  const isPublic = !!photo.isPublic;
  const weather = photo.weatherInfo || {};
  // ⚠ 예전에는 값이 없으면 서울 좌표·운량 35%·시정 15km·습도 55%·'Vivid 붉은 노을' 을 채웠습니다.
  //   저장되는 기상 정보에는 운량·시정·품질 필드가 **아예 없어서** 늘 그 가짜 값이 나왔고, 습도는
  //   이미 % 인 값에 100 을 곱해 5000% 처럼 나왔습니다. 이제 실제로 저장된 값만 적고, 없으면 '—'.
  const obs = Array.isArray(weather.interpolatedWeatherData) ? weather.interpolatedWeatherData[0] : undefined;
  const fmtLat = (v?: number) => (typeof v === 'number' ? `${Math.abs(v).toFixed(3)}°${v >= 0 ? 'N' : 'S'}` : '—');
  const fmtLon = (v?: number) => (typeof v === 'number' ? `${Math.abs(v).toFixed(3)}°${v >= 0 ? 'E' : 'W'}` : '—');
  const latStr = fmtLat(photo.latitude);
  const lonStr = fmtLon(photo.longitude);
  const cloudPct = obs ? (obs.total ?? Math.max(obs.low ?? 0, obs.mid ?? 0, obs.high ?? 0)) : undefined;
  const visKm = typeof obs?.visibility === 'number' ? obs.visibility / 1000 : undefined;
  const humPct = typeof weather.humidity === 'number' ? weather.humidity : obs?.humidity;
  const locationLabel = photo.locationName || (typeof photo.latitude === 'number' ? `${latStr}, ${lonStr}` : L3(language, '위치 없음', 'No location', '位置なし'));
  const dateStr = photo.timestamp ? new Date(photo.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '';

  const handleLike = () => {
    setIsLiked((prev) => !prev);
    setLikesCount((prev) => (isLiked ? prev - 1 : prev + 1));
  };

  const handleSnsSelect = async (platform: SnsPlatform) => {
    setShowSnsSelector(false);
    const tweetText = L3(language,
      `🌇 BeforeGlow 노을 예보로 포착한 하늘 사진!\n📍 ${locationLabel}\n#BeforeGlow #노을예보 #sunset`,
      `🌇 A sky I caught with the BeforeGlow sunset forecast!\n📍 ${locationLabel}\n#BeforeGlow #sunset`,
      `🌇 BeforeGlowの夕焼け予報で捉えた空!\n📍 ${locationLabel}\n#BeforeGlow #夕焼け #sunset`);

    // 1. 선택한 SNS로 공유 딥링크 호출
    await shareToSns({
      platform,
      text: tweetText,
      imageUri: photo.imageUrl || photo.localUri,
    });

    // 2. 공유 완료 시 즉시 전체 공개(isPublic: true) 상태로 변경!
    if (!isPublic) {
      await togglePhotoVisibility(photo.id, true);
      Alert.alert(
        L3(language, '🌐 전체 공개로 바뀜', '🌐 Now public', '🌐 全体公開になりました'),
        L3(language, '공유하면서 게시물을 [전체 공개]로 바꿨습니다.', 'Sharing made this post public.', '共有に合わせて投稿を[全体公開]にしました。'),
      );
    }
  };

  const handleFeedback = async (feedback: 'good' | 'bad') => {
    const next = currentFeedback === feedback ? null : feedback;
    setCurrentFeedback(next);
    if (photo?.id) {
      await setPhotoFeedback(photo.id, next);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.cardContainer}>
          {/* Top Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {isPublic ? (
                <View style={styles.publicBadge}>
                  <Globe size={12} color={color.success} />
                  <Text style={styles.publicBadgeText}>{L3(language, '전체 공개 게시물', 'Public post', '全体公開の投稿')}</Text>
                </View>
              ) : (
                <View style={styles.privateBadge}>
                  <Lock size={12} color="#FF9800" />
                  <Text style={styles.privateBadgeText}>{L3(language, '🔒 비공개 (나만 봄)', '🔒 Private (only you)', '🔒 非公開(自分のみ)')}</Text>
                </View>
              )}
            </View>
            <PressScale onPress={onClose} style={styles.closeIconBtn}>
              <X size={20} color={color.text} />
            </PressScale>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Visual Comparison: Photo & 3D Simulation */}
            <View style={styles.visualContainer}>
              {(() => {
                const photoUri = typeof photo.imageUrl === 'string' ? photo.imageUrl : typeof photo.localUri === 'string' ? photo.localUri : '';
                return photoUri ? (
                  <View style={styles.photoFrame}>
                    <Image source={{ uri: photoUri }} style={styles.mainPhoto} resizeMode="cover" />
                    <Text style={styles.photoLabel}>📷 {L3(language, '촬영 사진', 'Photo', '撮影写真')}</Text>
                  </View>
                ) : null;
              })()}

              {(() => {
                const simUri = typeof photo.simulationImageUrl === 'string' ? photo.simulationImageUrl : typeof photo.simulationLocalUri === 'string' ? photo.simulationLocalUri : '';
                return simUri ? (
                  <View style={styles.photoFrame}>
                    <Image source={{ uri: simUri }} style={styles.mainPhoto} resizeMode="cover" />
                    <Text style={styles.photoLabel}>🌅 {L3(language, '3D 노을 시뮬레이션', '3D glow simulation', '3D夕焼けシミュレーション')}</Text>
                  </View>
                ) : null;
              })()}
            </View>

            {/* Metadata Section */}
            <View style={styles.metaSection}>
              {/* Location & Time */}
              <View style={styles.metaRow}>
                <MapPin size={16} color="#FFB380" />
                <Text style={styles.locationTitle}>{locationLabel}</Text>
                <Text style={styles.timeSub}>{dateStr}</Text>
              </View>

              {/* Coords */}
              <View style={styles.coordsBadge}>
                <Text style={styles.coordsText}>📍 {L3(language, '촬영 좌표', 'Taken at', '撮影座標')}: {latStr}, {lonStr}</Text>
              </View>

              {/* Weather Info */}
              <View style={styles.weatherCard}>
                <Text style={styles.weatherCardTitle}>🌤️ {L3(language, '촬영 당시 날씨', 'Weather at capture', '撮影時の天気')}</Text>
                <View style={styles.weatherGrid}>
                  <View style={styles.weatherItem}>
                    <CloudSun size={14} color="#88C0D0" />
                    <Text style={styles.weatherItemLabel}>{L3(language, '운량', 'Cloud', '雲量')}</Text>
                    <Text style={styles.weatherItemVal}>{cloudPct != null ? `${Math.round(cloudPct)}%` : '—'}</Text>
                  </View>

                  <View style={styles.weatherItem}>
                    <Eye size={14} color="#A3BE8C" />
                    <Text style={styles.weatherItemLabel}>{L3(language, '시정', 'Visibility', '視程')}</Text>
                    <Text style={styles.weatherItemVal}>{visKm != null ? `${visKm >= 10 ? Math.round(visKm) : visKm.toFixed(1)}km` : '—'}</Text>
                  </View>

                  <View style={styles.weatherItem}>
                    <Droplets size={14} color="#5E81AC" />
                    <Text style={styles.weatherItemLabel}>{L3(language, '습도', 'Humidity', '湿度')}</Text>
                    <Text style={styles.weatherItemVal}>{humPct != null ? `${Math.round(humPct)}%` : '—'}</Text>
                  </View>

                  <View style={styles.weatherItem}>
                    <Sparkles size={14} color="#EBCB8B" />
                    <Text style={styles.weatherItemLabel}>{L3(language, '노을 점수', 'Glow score', '夕焼けスコア')}</Text>
                    <Text style={styles.weatherItemVal}>{typeof photo.weatherScore === 'number' ? String(Math.round(photo.weatherScore)) : '—'}</Text>
                  </View>
                </View>
              </View>

              {/* Sky Forecast & Simulation Evaluation */}
              {isMyPhoto && (
                <View style={styles.feedbackCard}>
                  <View style={styles.feedbackCardHeader}>
                    <Sparkles size={14} color="#FFB380" />
                    <Text style={styles.feedbackCardTitle}>
                      {L3(language, '하늘 예측 정확도 평가', 'Sky Forecast Accuracy', '空の予測評価')}
                    </Text>
                  </View>
                  <Text style={styles.feedbackCardDesc}>
                    {L3(
                      language,
                      '실제 하늘과 시뮬레이션이 잘 맞았나요? 평가 데이터는 예측 적중률 보정에 활용됩니다.',
                      'Did the simulation match the real sky? Your feedback helps calibrate accuracy.',
                      'シミュレーションと実際の空は一致しましたか？'
                    )}
                  </Text>
                  <View style={styles.feedbackBtnRow}>
                    <PressScale
                      style={[
                        styles.feedbackBtn,
                        currentFeedback === 'good' && styles.feedbackBtnGoodActive,
                      ]}
                      onPress={() => handleFeedback('good')}
                    >
                      <ThumbsUp size={14} color={currentFeedback === 'good' ? '#fff' : color.textMute} />
                      <Text
                        style={[
                          styles.feedbackBtnText,
                          currentFeedback === 'good' && styles.feedbackBtnTextActive,
                        ]}
                      >
                        {L3(language, '잘 맞았어요 ☀️', 'Accurate ☀️', '合っていた ☀️')}
                      </Text>
                    </PressScale>

                    <PressScale
                      style={[
                        styles.feedbackBtn,
                        currentFeedback === 'bad' && styles.feedbackBtnBadActive,
                      ]}
                      onPress={() => handleFeedback('bad')}
                    >
                      <ThumbsDown size={14} color={currentFeedback === 'bad' ? '#fff' : color.textMute} />
                      <Text
                        style={[
                          styles.feedbackBtnText,
                          currentFeedback === 'bad' && styles.feedbackBtnTextActive,
                        ]}
                      >
                        {L3(language, '아쉬웠어요 ⛅', 'Inaccurate ⛅', '少し違った ⛅')}
                      </Text>
                    </PressScale>
                  </View>
                </View>
              )}

              {!isPublic && (
                <Text style={styles.privateNotice}>
                  {L3(language,
                    '💡 [공유하기]로 SNS에 보내면 게시물이 [전체 공개]로 바뀝니다.',
                    '💡 Sharing to social media makes this post public.',
                    '💡 [共有]でSNSに送ると投稿が[全体公開]になります。')}
                </Text>
              )}
            </View>
          </ScrollView>

          {/* Bottom Action Controls */}
          <View style={styles.actionFooter}>
            <PressScale style={[styles.likeBtn, isLiked && styles.likedBtn]} onPress={handleLike}>
              <Heart size={18} color={isLiked ? color.danger : color.text} fill={isLiked ? color.danger : 'transparent'} />
              <Text style={[styles.likeBtnText, isLiked && styles.likedBtnText]}>{likesCount}</Text>
            </PressScale>

            <PressScale style={styles.closeFooterBtn} onPress={onClose}>
              <Text style={styles.closeFooterText}>{L3(language, '닫기', 'Close', '閉じる')}</Text>
            </PressScale>

            {/* 남의 게시물 — 신고·차단(Play 사용자 제작 콘텐츠 정책, 출시 점검 2026-09-30) */}
            {!isMyPhoto && ownerId && (
              <PressScale style={styles.reportBtn} onPress={() => { setReportState('idle'); setShowReport(true); }} accessibilityLabel={L3(language, '신고', 'Report', '報告')}>
                <Flag size={16} color={color.danger} />
              </PressScale>
            )}

            {/* 내 게시물일 때만 공유하기 버튼 노출 */}
            {isMyPhoto && (
              <PressScale style={styles.shareBtn} onPress={() => setShowSnsSelector(true)}>
                <Share2 size={16} color="#000" />
                <Text style={styles.shareBtnText}>{L3(language, '공유하기', 'Share', '共有')}</Text>
              </PressScale>
            )}
          </View>

          {/* 신고 시트 — 이유를 고르면 신고가 남고 이 사진은 바로 가려집니다. 사용자 차단은 따로. */}
          {showReport && ownerId && (
            <View style={styles.snsSheet}>
              <View style={styles.snsSheetHeader}>
                <Text style={styles.snsSheetTitle}>{L3(language, '이 사진 신고하기', 'Report this photo', 'この写真を報告')}</Text>
                <PressScale onPress={() => setShowReport(false)}>
                  <X size={18} color={color.text} />
                </PressScale>
              </View>
              {reportState === 'done' ? (
                <Text style={styles.reportNote}>{L3(language, '신고를 받았습니다. 검토 후 조치합니다. 이 사진은 이제 보이지 않습니다.', 'Thanks — we will review it. This photo is now hidden for you.', '報告を受け付けました。確認して対応します。この写真は表示されなくなります。')}</Text>
              ) : (
                <>
                  {REPORT_REASONS.map((r: ReportReason) => (
                    <PressScale
                      key={r}
                      style={styles.reportOption}
                      disabled={reportState === 'sending'}
                      onPress={async () => {
                        setReportState('sending');
                        const ok = await reportPhoto(photo.id, ownerId, r);
                        if (ok) { setReportState('done'); hidePhoto(photo.id); } else setReportState('failed');
                      }}
                    >
                      <Text style={styles.reportOptionText}>{
                        r === 'inappropriate' ? L3(language, '부적절하거나 불쾌한 사진', 'Inappropriate or offensive', '不適切・不快な写真')
                        : r === 'spam' ? L3(language, '스팸·광고', 'Spam or advertising', 'スパム・広告')
                        : r === 'privacy' ? L3(language, '개인정보·얼굴이 드러남', 'Shows personal info or faces', '個人情報・顔が写っている')
                        : L3(language, '기타', 'Something else', 'その他')
                      }</Text>
                    </PressScale>
                  ))}
                  {reportState === 'failed' && (
                    <Text style={[styles.reportNote, { color: color.danger }]}>{L3(language, '보내지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', 'Could not send. Check your connection and try again.', '送信できませんでした。接続を確認して再度お試しください。')}</Text>
                  )}
                </>
              )}
              <PressScale
                style={[styles.reportOption, { borderBottomWidth: 0 }]}
                onPress={() => { blockUser(ownerId); setShowReport(false); onClose(); }}
              >
                <Text style={[styles.reportOptionText, { color: color.danger }]}>{L3(language, '이 사용자의 사진 모두 숨기기(차단)', 'Block this user (hide all their photos)', 'このユーザーをブロック（写真をすべて非表示）')}</Text>
              </PressScale>
            </View>
          )}

          {/* SNS Platform Selector Sheet */}
          {showSnsSelector && (
            <View style={styles.snsSheet}>
              <View style={styles.snsSheetHeader}>
                <Text style={styles.snsSheetTitle}>{L3(language, '𝕏 · SNS로 공유하고 공개하기', 'Share to 𝕏 & social (makes it public)', '𝕏・SNSで共有して公開')}</Text>
                <PressScale onPress={() => setShowSnsSelector(false)}>
                  <X size={18} color={color.text} />
                </PressScale>
              </View>

              <View style={styles.snsGrid}>
                <PressScale style={styles.snsOption} onPress={() => handleSnsSelect('twitter')}>
                  <Text style={styles.snsIcon}>𝕏</Text>
                  <Text style={styles.snsName}>X</Text>
                </PressScale>

                <PressScale style={styles.snsOption} onPress={() => handleSnsSelect('instagram')}>
                  <Text style={styles.snsIcon}>📸</Text>
                  <Text style={styles.snsName}>Instagram</Text>
                </PressScale>

                <PressScale style={styles.snsOption} onPress={() => handleSnsSelect('threads')}>
                  <Text style={styles.snsIcon}>🧵</Text>
                  <Text style={styles.snsName}>Threads</Text>
                </PressScale>

                <PressScale style={styles.snsOption} onPress={() => handleSnsSelect('kakao')}>
                  <Text style={styles.snsIcon}>🟡</Text>
                  <Text style={styles.snsName}>{L3(language, '카카오톡', 'KakaoTalk', 'カカオトーク')}</Text>
                </PressScale>

                <PressScale style={styles.snsOption} onPress={() => handleSnsSelect('facebook')}>
                  <Text style={styles.snsIcon}>🔵</Text>
                  <Text style={styles.snsName}>Facebook</Text>
                </PressScale>

                <PressScale style={styles.snsOption} onPress={() => handleSnsSelect('native')}>
                  <Text style={styles.snsIcon}>📱</Text>
                  <Text style={styles.snsName}>{L3(language, '더보기', 'More', 'その他')}</Text>
                </PressScale>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'flex-end',
  },
  cardContainer: {
    backgroundColor: '#0A0E17',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: color.border,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  publicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
  },
  publicBadgeText: {
    color: color.success,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.2,
  },
  privateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  privateBadgeText: {
    color: color.sun,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.2,
  },
  closeIconBtn: {
    padding: 6,
  },
  scrollContent: {
    padding: 16,
  },
  visualContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  photoFrame: {
    flex: 1,
    height: 180,
    borderRadius: radius.xs,
    overflow: 'hidden',
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.border,
    position: 'relative',
  },
  mainPhoto: {
    width: '100%',
    height: '100%',
  },
  photoLabel: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(8, 11, 17, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 0.5,
    borderColor: color.borderStrong,
    color: color.text,
    fontSize: 9,
    fontWeight: '800',
    fontFamily: mono,
  },
  metaSection: {
    gap: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationTitle: {
    color: color.text,
    fontSize: 16,
    fontWeight: '800',
  },
  timeSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginLeft: 'auto',
    fontFamily: mono,
  },
  coordsBadge: {
    backgroundColor: color.fill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    alignSelf: 'flex-start',
  },
  coordsText: {
    color: color.accent,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: mono,
  },
  weatherCard: {
    backgroundColor: color.panel,
    borderRadius: radius.xs,
    padding: 12,
    borderWidth: 1,
    borderColor: color.border,
  },
  weatherCardTitle: {
    color: color.textDim,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  weatherGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weatherItem: {
    alignItems: 'center',
    gap: 3,
  },
  weatherItemLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontFamily: mono,
  },
  weatherItemVal: {
    color: color.text,
    fontSize: 13,
    fontWeight: '900',
    fontFamily: mono,
  },
  privateNotice: {
    color: color.sun,
    fontSize: 11,
    lineHeight: 15,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    padding: 8,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  actionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: color.fill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
  },
  likedBtn: {
    backgroundColor: color.dangerSoft,
    borderColor: 'rgba(255, 82, 82, 0.4)',
  },
  likeBtnText: {
    color: color.text,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
  },
  likedBtnText: {
    color: color.danger,
  },
  closeFooterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xs,
    backgroundColor: color.fill,
    borderWidth: 1,
    borderColor: color.border,
  },
  closeFooterText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: color.accent,
    paddingVertical: 10,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  shareBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  snsSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0A0E17',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: color.border,
    padding: 18,
    zIndex: 100,
  },
  snsSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  snsSheetTitle: {
    color: color.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  snsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reportBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.dangerSoft,
  },
  reportOption: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  reportOptionText: {
    color: color.text,
    fontSize: 14,
  },
  reportNote: {
    color: color.textDim,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 10,
  },
  snsOption: {
    alignItems: 'center',
    gap: 5,
  },
  snsIcon: {
    fontSize: 22,
  },
  snsName: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
  },
  feedbackCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 179, 128, 0.25)',
    padding: 12,
    gap: 8,
  },
  feedbackCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedbackCardTitle: {
    color: '#FFB380',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  feedbackCardDesc: {
    color: color.textDim,
    fontSize: 11,
    lineHeight: 15,
  },
  feedbackBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  feedbackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
    backgroundColor: color.fill,
    borderWidth: 1,
    borderColor: color.border,
  },
  feedbackBtnGoodActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderColor: '#10B981',
  },
  feedbackBtnBadActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderColor: '#EF4444',
  },
  feedbackBtnText: {
    color: color.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  feedbackBtnTextActive: {
    color: color.text,
    fontWeight: '800',
  },
});
