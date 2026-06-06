import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, Image, Dimensions, Platform } from 'react-native';
import { Trash2, Image as ImageIcon } from 'lucide-react-native';
import { auth } from '../config/firebase';

interface GalleryProps {
  theme: any;
  dynamicTheme: any;
  globalPhotos: any[];
  removeGlobalPhoto: (id: string) => Promise<void>;
}

export const Gallery: React.FC<GalleryProps> = ({
  theme,
  dynamicTheme,
  globalPhotos = [],
  removeGlobalPhoto
}) => {
  const { width } = Dimensions.get('window');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'mine'>('all');

  const displayedPhotos = galleryFilter === 'mine'
    ? globalPhotos.filter((p: any) => p.userId === auth.currentUser?.uid)
    : globalPhotos;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Sunset Gallery</Text>
        
        {/* Filter Container */}
        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={[styles.filterChip, galleryFilter === 'all' && [styles.activeFilterChip, { backgroundColor: theme.text }]]}
            onPress={() => setGalleryFilter('all')}
          >
            <Text style={[styles.filterChipText, { color: galleryFilter === 'all' ? theme.bg : theme.subText }]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, galleryFilter === 'mine' && [styles.activeFilterChip, { backgroundColor: theme.text }]]}
            onPress={() => setGalleryFilter('mine')}
          >
            <Text style={[styles.filterChipText, { color: galleryFilter === 'mine' ? theme.bg : theme.subText }]}>Mine</Text>
          </TouchableOpacity>
        </View>
      </View>

      {displayedPhotos.length === 0 ? (
        <View style={[styles.emptyState, { borderColor: theme.border }]}>
          <ImageIcon size={32} color={theme.subText} style={{ marginBottom: 10 }} />
          <Text style={{ color: theme.subText, fontSize: 14 }}>No sunset photos found.</Text>
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
              <View style={[styles.galleryItem, { width: itemWidth, backgroundColor: theme.card, borderColor: theme.border }]}>
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.galleryImage}
                />
                <View style={styles.galleryMeta}>
                  <Text numberOfLines={1} style={[styles.galleryTitle, { color: theme.text }]}>
                    {item.locationName}
                  </Text>
                  <Text numberOfLines={1} style={[styles.galleryDate, { color: theme.subText }]}>
                    {new Date(item.timestamp).toLocaleDateString()} • {item.userName}
                  </Text>
                </View>
                {item.userId === auth.currentUser?.uid && (
                  <TouchableOpacity
                    style={styles.photoDeleteBtn}
                    onPress={() => removeGlobalPhoto(item.id)}
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
});
