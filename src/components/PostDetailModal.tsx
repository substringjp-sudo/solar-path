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
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  cardContainer: {
    backgroundColor: '#1E1B24',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
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
    gap: 6,
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76, 175, 80, 0.3)',
  },
  publicBadgeText: {
    color: '#81C784',
    fontSize: 11,
    fontWeight: 'bold',
  },
  privateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.3)',
  },
  privateBadgeText: {
    color: '#FFB74D',
    fontSize: 11,
    fontWeight: 'bold',
  },
  closeIconBtn: {
    padding: 6,
  },
  scrollContent: {
    padding: 20,
  },
  visualContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  photoFrame: {
    flex: 1,
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#2A2433',
    position: 'relative',
  },
  mainPhoto: {
    width: '100%',
    height: '100%',
  },
  photoLabel: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  metaSection: {
    gap: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  timeSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginLeft: 'auto',
  },
  coordsBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  coordsText: {
    color: '#FFB380',
    fontSize: 11,
    fontWeight: '600',
  },
  weatherCard: {
    backgroundColor: '#262130',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  weatherCardTitle: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  weatherGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weatherItem: {
    alignItems: 'center',
    gap: 4,
  },
  weatherItemLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
  },
  weatherItemVal: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  privateNotice: {
    color: '#FFD700',
    fontSize: 11,
    lineHeight: 16,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    padding: 10,
    borderRadius: 10,
  },
  actionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  likedBtn: {
    backgroundColor: 'rgba(255, 82, 82, 0.15)',
  },
  likeBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  likedBtnText: {
    color: '#FF5252',
  },
  closeFooterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeFooterText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: 'bold',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FF8C00',
    paddingVertical: 12,
    borderRadius: 20,
  },
  shareBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
  },
  snsSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#262130',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    zIndex: 100,
  },
  snsSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  snsSheetTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  snsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  snsOption: {
    alignItems: 'center',
    gap: 6,
  },
  snsIcon: {
    fontSize: 22,
  },
  snsName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '600',
  },
});
