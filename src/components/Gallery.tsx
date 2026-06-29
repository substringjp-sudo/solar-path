import React, { useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, Image, Dimensions, Platform, Alert } from 'react-native';
import { Trash2, Image as ImageIcon } from 'lucide-react-native';
import { auth } from '../config/firebase';
import { useCelestialStore } from '../store/useCelestialStore';
import { t } from '../utils/i18n';

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
  const { language, currentUser, removeMyPhoto } = useCelestialStore();
  const { width } = Dimensions.get('window');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'mine'>('all');

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

    // '전체 사진' 탭에서는:
    return globalPhotos.filter((p: any) => {
      // 1. 내가 올린 사진은 항상 즉시 노출
      const isMyPhoto = p.userId === currentUid;
      if (isMyPhoto) return true;
      
      // 2. 다른 사람이 올린 사진은 신변/사생활 보호를 위해 1시간 뒤에 노출
      const oneHourElapsed = Date.now() - p.timestamp >= 3600000;
      return oneHourElapsed;
    });
  }, [globalPhotos, myPhotos, galleryFilter, currentUser]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{t('sunsetGallery', language)}</Text>
        
        {/* Filter Container */}
        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={[styles.filterChip, galleryFilter === 'all' && [styles.activeFilterChip, { backgroundColor: theme.text }]]}
            onPress={() => setGalleryFilter('all')}
          >
            <Text style={[styles.filterChipText, { color: galleryFilter === 'all' ? theme.bg : theme.subText }]}>{t('all', language)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, galleryFilter === 'mine' && [styles.activeFilterChip, { backgroundColor: theme.text }]]}
            onPress={() => setGalleryFilter('mine')}
          >
            <Text style={[styles.filterChipText, { color: galleryFilter === 'mine' ? theme.bg : theme.subText }]}>{t('mine', language)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {displayedPhotos.length === 0 ? (
        <View style={[styles.emptyState, { borderColor: theme.border }]}>
          <ImageIcon size={32} color={theme.subText} style={{ marginBottom: 10 }} />
          <Text style={{ color: theme.subText, fontSize: 14 }}>{t('noPhotos', language)}</Text>
        </View>
      ) : (
        <FlatList
          data={displayedPhotos}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const itemWidth = (width - 44) / 2; // 16px margins + 12px gap
            return (
              <View style={[
                styles.galleryItem, 
                { width: itemWidth, backgroundColor: theme.card, borderColor: theme.border },
                item.isPending && { opacity: 0.65 }
              ]}>
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.galleryImage}
                />
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
                    <Text numberOfLines={1} style={[styles.galleryGuide, { color: theme.accent || '#FFD700' }]}>
                      🧭 {getDirectionLabel(item.deviceAzimuth, language)} • {Math.round(item.devicePitch)}°
                    </Text>
                  )}
                </View>
                {(item.userId === auth.currentUser?.uid || item.isPending) && (
                  <TouchableOpacity
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
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  activeFilterChip: {
    borderColor: 'transparent',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 20,
    minHeight: 200,
  },
  listContent: {
    paddingBottom: 40,
    gap: 12,
  },
  galleryItem: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
    margin: 5,
  },
  galleryImage: {
    width: '100%',
    height: 120,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  galleryMeta: {
    padding: 10,
  },
  galleryTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  galleryDate: {
    fontSize: 9,
    opacity: 0.6,
    marginTop: 3,
  },
  galleryGuide: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  photoDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,111,97,0.3)',
  },
  pendingText: {
    color: '#FF6F61',
    fontSize: 8,
    fontWeight: '800',
  },
});
