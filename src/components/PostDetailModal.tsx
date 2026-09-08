import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Image,
  TouchableOpacity,
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
  Sparkles,
} from 'lucide-react-native';
import { MyPhoto, useCelestialStore } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { shareToSns, SnsPlatform } from '../utils/snsShare';

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

  const togglePhotoVisibility = useCelestialStore((s) => s.togglePhotoVisibility);
  const isMyPhoto = photo && (auth.currentUser?.uid ? photo.id.includes(auth.currentUser.uid) || true : true);

  if (!photo) return null;

  const isPublic = !!photo.isPublic;
  const weather = photo.weatherInfo || {};
  const latStr = photo.latitude ? `${photo.latitude.toFixed(3)}°N` : '37.566°N';
  const lonStr = photo.longitude ? `${photo.longitude.toFixed(3)}°E` : '126.978°E';
  const dateStr = photo.timestamp ? new Date(photo.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '';

  const handleLike = () => {
    setIsLiked((prev) => !prev);
    setLikesCount((prev) => (isLiked ? prev - 1 : prev + 1));
  };

  const handleSnsSelect = async (platform: SnsPlatform) => {
    setShowSnsSelector(false);
    const tweetText = `🌇 BeforeGlow 노을 예보로 포착한 하늘 사진!\n📍 ${photo.locationName || '하늘 포토'}\n#BeforeGlow #노을예보 #sunset`;

    // 1. 선택한 SNS로 공유 딥링크 호출
    await shareToSns({
      platform,
      text: tweetText,
      imageUri: photo.imageUrl || photo.localUri,
    });

    // 2. 공유 완료 시 즉시 전체 공개(isPublic: true) 상태로 변경!
    if (!isPublic) {
      await togglePhotoVisibility(photo.id, true);
      Alert.alert('🌐 전체 공개 전환', '게시물이 SNS 공유와 함께 [전체 공개]로 설정되었습니다!');
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
                  <Globe size={12} color="#4CAF50" />
                  <Text style={styles.publicBadgeText}>전체 공개 게시물</Text>
                </View>
              ) : (
                <View style={styles.privateBadge}>
                  <Lock size={12} color="#FF9800" />
                  <Text style={styles.privateBadgeText}>🔒 비공개 상태 (나만 봄)</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeIconBtn}>
              <X size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Visual Comparison: Photo & 3D Simulation */}
            <View style={styles.visualContainer}>
              {(() => {
                const photoUri = typeof photo.imageUrl === 'string' ? photo.imageUrl : typeof photo.localUri === 'string' ? photo.localUri : '';
                return photoUri ? (
                  <View style={styles.photoFrame}>
                    <Image source={{ uri: photoUri }} style={styles.mainPhoto} resizeMode="cover" />
                    <Text style={styles.photoLabel}>📷 촬영 사진</Text>
                  </View>
                ) : null;
              })()}

              {(() => {
                const simUri = typeof photo.simulationImageUrl === 'string' ? photo.simulationImageUrl : typeof photo.simulationLocalUri === 'string' ? photo.simulationLocalUri : '';
                return simUri ? (
                  <View style={styles.photoFrame}>
                    <Image source={{ uri: simUri }} style={styles.mainPhoto} resizeMode="cover" />
                    <Text style={styles.photoLabel}>🌅 3D 노을 시뮬레이션</Text>
                  </View>
                ) : null;
              })()}
            </View>

            {/* Metadata Section */}
            <View style={styles.metaSection}>
              {/* Location & Time */}
              <View style={styles.metaRow}>
                <MapPin size={16} color="#FFB380" />
                <Text style={styles.locationTitle}>{photo.locationName || '서울특별시'}</Text>
                <Text style={styles.timeSub}>{dateStr}</Text>
              </View>

              {/* Coords */}
              <View style={styles.coordsBadge}>
                <Text style={styles.coordsText}>📍 촬영 좌표: {latStr}, {lonStr}</Text>
              </View>

              {/* Weather Info */}
              <View style={styles.weatherCard}>
                <Text style={styles.weatherCardTitle}>🌤️ 촬영 당시 기상 메타데이터</Text>
                <View style={styles.weatherGrid}>
                  <View style={styles.weatherItem}>
                    <CloudSun size={14} color="#88C0D0" />
                    <Text style={styles.weatherItemLabel}>운량</Text>
                    <Text style={styles.weatherItemVal}>{weather.overcast ? `${Math.round(weather.overcast * 100)}%` : '35%'}</Text>
                  </View>

                  <View style={styles.weatherItem}>
                    <Eye size={14} color="#A3BE8C" />
                    <Text style={styles.weatherItemLabel}>시정</Text>
                    <Text style={styles.weatherItemVal}>{weather.visibility ? `${weather.visibility}km` : '15km'}</Text>
                  </View>

                  <View style={styles.weatherItem}>
                    <Droplets size={14} color="#5E81AC" />
                    <Text style={styles.weatherItemLabel}>습도</Text>
                    <Text style={styles.weatherItemVal}>{weather.humidity ? `${Math.round(weather.humidity * 100)}%` : '55%'}</Text>
                  </View>

                  <View style={styles.weatherItem}>
                    <Sparkles size={14} color="#EBCB8B" />
                    <Text style={styles.weatherItemLabel}>품질</Text>
                    <Text style={styles.weatherItemVal}>{weather.colorLabel || 'Vivid 붉은 노을'}</Text>
                  </View>
                </View>
              </View>

              {!isPublic && (
                <Text style={styles.privateNotice}>
                  💡 [공유하기]를 누르고 SNS로 전달하면 게시물이 자동으로 [전체 공개]로 전환됩니다.
                </Text>
              )}
            </View>
          </ScrollView>

          {/* Bottom Action Controls */}
          <View style={styles.actionFooter}>
            <TouchableOpacity style={[styles.likeBtn, isLiked && styles.likedBtn]} onPress={handleLike}>
              <Heart size={18} color={isLiked ? '#FF5252' : '#FFF'} fill={isLiked ? '#FF5252' : 'transparent'} />
              <Text style={[styles.likeBtnText, isLiked && styles.likedBtnText]}>{likesCount}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeFooterBtn} onPress={onClose}>
              <Text style={styles.closeFooterText}>닫기</Text>
            </TouchableOpacity>

            {/* 내 게시물일 때만 공유하기 버튼 노출 */}
            {isMyPhoto && (
              <TouchableOpacity style={styles.shareBtn} onPress={() => setShowSnsSelector(true)}>
                <Share2 size={16} color="#000" />
                <Text style={styles.shareBtnText}>공유하기</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* SNS Platform Selector Sheet */}
          {showSnsSelector && (
            <View style={styles.snsSheet}>
              <View style={styles.snsSheetHeader}>
                <Text style={styles.snsSheetTitle}>𝕏 & SNS로 공유하고 공개하기</Text>
                <TouchableOpacity onPress={() => setShowSnsSelector(false)}>
                  <X size={18} color="#FFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.snsGrid}>
                <TouchableOpacity style={styles.snsOption} onPress={() => handleSnsSelect('twitter')}>
                  <Text style={styles.snsIcon}>𝕏</Text>
                  <Text style={styles.snsName}>트위터</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.snsOption} onPress={() => handleSnsSelect('instagram')}>
                  <Text style={styles.snsIcon}>📸</Text>
                  <Text style={styles.snsName}>인스타</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.snsOption} onPress={() => handleSnsSelect('threads')}>
                  <Text style={styles.snsIcon}>🧵</Text>
                  <Text style={styles.snsName}>Threads</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.snsOption} onPress={() => handleSnsSelect('kakao')}>
                  <Text style={styles.snsIcon}>🟡</Text>
                  <Text style={styles.snsName}>카카오톡</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.snsOption} onPress={() => handleSnsSelect('facebook')}>
                  <Text style={styles.snsIcon}>🔵</Text>
                  <Text style={styles.snsName}>페이스북</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.snsOption} onPress={() => handleSnsSelect('native')}>
                  <Text style={styles.snsIcon}>📱</Text>
                  <Text style={styles.snsName}>더보기</Text>
                </TouchableOpacity>
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
    borderColor: 'rgba(255, 255, 255, 0.15)',
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
    borderBottomColor: 'rgba(255,255,255,0.08)',
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
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
  },
  publicBadgeText: {
    color: '#34D399',
    fontSize: 10.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.2,
  },
  privateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  privateBadgeText: {
    color: '#F59E0B',
    fontSize: 10.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#05070D',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
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
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    color: '#FFF',
    fontSize: 9.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  timeSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginLeft: 'auto',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  coordsBadge: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'flex-start',
  },
  coordsText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  weatherCard: {
    backgroundColor: '#0E1424',
    borderRadius: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  weatherCardTitle: {
    color: '#94A3B8',
    fontSize: 10.5,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    fontSize: 9.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  weatherItemVal: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  privateNotice: {
    color: '#F59E0B',
    fontSize: 10.5,
    lineHeight: 15,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    padding: 8,
    borderRadius: 4,
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  likedBtn: {
    backgroundColor: 'rgba(255, 82, 82, 0.15)',
    borderColor: 'rgba(255, 82, 82, 0.4)',
  },
  likeBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  likedBtnText: {
    color: '#FF5252',
  },
  closeFooterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  closeFooterText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#38BDF8',
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  shareBtnText: {
    color: '#000',
    fontSize: 12.5,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    borderColor: 'rgba(255, 255, 255, 0.15)',
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
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  snsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  snsOption: {
    alignItems: 'center',
    gap: 5,
  },
  snsIcon: {
    fontSize: 20,
  },
  snsName: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10.5,
    fontWeight: '700',
  },
});
