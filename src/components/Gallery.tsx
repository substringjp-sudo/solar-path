import React, { useState, useMemo } from 'react';
import { StyleSheet, View, Text, FlatList, Image, Dimensions, Platform, Alert } from 'react-native';
import { Trash2, Image as ImageIcon, Share2 } from 'lucide-react-native';
import { shareToTwitter } from '../utils/twitterShare';
import { auth } from '../config/firebase';
import { MyPhoto, useCelestialStore } from '../store/useCelestialStore';
import { t, L3 } from '../utils/i18n';
import { PostDetailModal } from './PostDetailModal';
import { color, radius, mono } from '../theme/tokens';
import { PressScale } from './ui';
import { makeStyles, useThemeColors } from '../theme/useTheme';

const getDirectionLabel = (azimuth: number, lang: 'ko' | 'en' | 'ja'): string => {
  const koDirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const enDirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const jaDirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const index = Math.round(azimuth / 45) % 8;
  if (lang === 'ko') return koDirs[index];
  if (lang === 'ja') return jaDirs[index];
  return enDirs[index];
};

interface GalleryProps {
  theme: any;
  dynamicTheme: any;
  globalPhotos: any[];
  myPhotos?: any[];
  removeGlobalPhoto: (id: string) => Promise<void>;
}

export const Gallery: React.FC<GalleryProps> = ({
  theme,
  dynamicTheme,
  globalPhotos = [],
  myPhotos = [],
  removeGlobalPhoto
}) => {
  const color = useThemeColors(); const styles = useStyles();
  const { language, currentUser, removeMyPhoto } = useCelestialStore();
  const { width } = Dimensions.get('window');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'mine'>('all');
  const [selectedPhotoForDetail, setSelectedPhotoForDetail] = useState<MyPhoto | null>(null);

  const displayedPhotos = useMemo(() => {
    const currentUid = auth.currentUser?.uid || currentUser?.uid;

    if (galleryFilter === 'mine') {
      // '내가 찍은 사진' 탭에서는:
      // 1) 로컬 기기의 myPhotos 리스트와 
      // 2) globalPhotos 중 내 userId가 일치하는 사진들을 
      // id 기준으로 중복 제거하여 합친 후 최신순으로 정렬
      const localPhotos = myPhotos || [];
      const myGlobalPhotos = globalPhotos.filter((p: any) => p.userId === currentUid);
      
      const mergedMap = new Map();
      localPhotos.forEach(p => mergedMap.set(p.id, p));
      myGlobalPhotos.forEach(p => mergedMap.set(p.id, p));
      
      return Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    // '전체 사진' 탭에서는 서버에서 전역 동기화된 유저들의 업로드 사진을 표시
    return globalPhotos;
  }, [globalPhotos, myPhotos, galleryFilter, currentUser]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{t('sunsetGallery', language)}</Text>
        
        {/* Filter Container */}
        <View style={styles.filterContainer}>
          <PressScale
            style={[styles.filterChip, galleryFilter === 'all' && styles.activeFilterChip]}
            onPress={() => setGalleryFilter('all')}
          >
            <Text style={[styles.filterChipText, { color: galleryFilter === 'all' ? color.accent : theme.subText }]}>{t('all', language)}</Text>
          </PressScale>
          <PressScale
            style={[styles.filterChip, galleryFilter === 'mine' && styles.activeFilterChip]}
            onPress={() => setGalleryFilter('mine')}
          >
            <Text style={[styles.filterChipText, { color: galleryFilter === 'mine' ? color.accent : theme.subText }]}>{t('mine', language)}</Text>
          </PressScale>
        </View>
      </View>

      {displayedPhotos.length === 0 ? (
        <View style={[styles.emptyState, { borderColor: theme.border }]}>
          <ImageIcon size={32} color={theme.subText} style={{ marginBottom: 10 }} />
          <Text style={{ color: theme.subText, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{t('noPhotos', language)}</Text>
        </View>
      ) : (
        <FlatList
          data={displayedPhotos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
              const itemWidth = (width - 44) / 2;
              const photoUri = typeof item.imageUrl === 'string' ? item.imageUrl : typeof item.localUri === 'string' ? item.localUri : typeof item.uri === 'string' ? item.uri : '';
              return (
                <PressScale
                  style={[
                    styles.galleryItem, 
                    { width: itemWidth, backgroundColor: theme.card, borderColor: theme.border },
                    item.isPending && { opacity: 0.65 }
                  ]}
                  onPress={() => setSelectedPhotoForDetail(item)}
                >
                  {photoUri ? (
                    <Image
                      source={{ uri: photoUri }}
                      style={styles.galleryImage}
                    />
                  ) : (
                    <View style={[styles.galleryImage, { justifyContent: 'center', alignItems: 'center' }]}>
                      <ImageIcon size={24} color={theme.subText} />
                    </View>
                  )}
                  {item.isPending && (
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingText}>{t('uploadPending', language)}</Text>
                    </View>
                  )}
                  <View style={styles.galleryMeta}>
                    <Text numberOfLines={1} style={[styles.galleryTitle, { color: theme.text }]}>
                      {item.locationName}
                    </Text>
                    <Text numberOfLines={1} style={[styles.galleryDate, { color: theme.subText }]}>
                      {new Date(item.timestamp).toLocaleDateString()} • {item.userName || 'Me'}
                    </Text>
                    {item.deviceAzimuth !== undefined && item.devicePitch !== undefined && (
                      <Text numberOfLines={1} style={[styles.galleryGuide, { color: theme.accent || color.sun }]}>
                        🧭 {getDirectionLabel(item.deviceAzimuth, language)} • {Math.round(item.devicePitch)}°
                      </Text>
                    )}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 10 }}>
                    <PressScale
                      style={styles.photoShareBtn}
                      onPress={() => {
                        // 언어별 공유 문구(점검 2026-09-29). ⚠ 예전에는 item.location 을 읽었는데 사진에는
                        //   locationName 만 있어 늘 '하늘 포토' 가 붙었습니다.
                        const place = item.locationName || item.location || L3(language, '하늘 사진', 'Sky photo', '空の写真');
                        const tweetText = L3(language,
                          `🌇 BeforeGlow 노을 예보로 포착한 하늘 사진!\n📍 ${place}\n#BeforeGlow #노을 #sunset`,
                          `🌇 A sky I caught with the BeforeGlow sunset forecast!\n📍 ${place}\n#BeforeGlow #sunset`,
                          `🌇 BeforeGlowの夕焼け予報で捉えた空!\n📍 ${place}\n#BeforeGlow #夕焼け #sunset`);
                        shareToTwitter({
                          text: tweetText,
                          imageUris: photoUri ? [photoUri] : [],
                        });
                      }}
                    >
                      <Share2 size={12} color={color.accent} />
                    </PressScale>

                    {(item.userId === auth.currentUser?.uid || item.isPending) && (
                      <PressScale
                        style={styles.photoDeleteBtn}
                        onPress={() => {
                          Alert.alert(
                            t('deletePhotoConfirmTitle', language),
                            t('deletePhotoConfirmMsg', language),
                            [
                              { text: t('cancel', language), style: 'cancel' },
                              { 
                                text: t('delete', language), 
                                style: 'destructive',
                                onPress: () => removeMyPhoto(item.id)
                              }
                            ]
                          );
                        }}
                      >
                        <Trash2 size={12} color="#FF6F61" />
                      </PressScale>
                    )}
                  </View>
                </PressScale>
              );
          }}
        />
      )}

      {/* 게시물 상세 미리보기 & 멀티 SNS 공유 모달 */}
      <PostDetailModal
        visible={!!selectedPhotoForDetail}
        photo={selectedPhotoForDetail}
        onClose={() => setSelectedPhotoForDetail(null)}
      />
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.xs,
    backgroundColor: color.fill,
    borderWidth: 1,
    borderColor: color.border,
  },
  activeFilterChip: {
    backgroundColor: color.accentSoft,
    borderColor: color.accentLine,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 20,
    minHeight: 200,
  },
  listContent: {
    paddingBottom: 40,
    gap: 10,
  },
  galleryItem: {
    borderRadius: radius.xs,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
    margin: 4,
  },
  galleryImage: {
    width: '100%',
    height: 120,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  galleryMeta: {
    padding: 8,
  },
  galleryTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  galleryDate: {
    fontSize: 9,
    opacity: 0.65,
    marginTop: 2,
    fontFamily: mono,
  },
  galleryGuide: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
    fontFamily: mono,
    letterSpacing: 0.2,
  },
  photoShareBtn: {
    backgroundColor: color.accentSoft,
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  photoDeleteBtn: {
    backgroundColor: color.dangerSoft,
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.dangerSoft,
  },
  pendingBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: 'rgba(255,111,97,0.4)',
  },
  pendingText: {
    color: '#FF6F61',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.4,
  },
}));
