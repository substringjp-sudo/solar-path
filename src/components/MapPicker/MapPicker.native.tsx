import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Dimensions } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import { X, Navigation, LocateFixed } from 'lucide-react-native';

export const MapPicker = ({ visible, onClose, onSelect, theme, location }: any) => {
  const { width, height } = Dimensions.get('window');
  const initialRegion = {
    latitude: location?.coords?.latitude || 37.78825,
    longitude: location?.coords?.longitude || -122.4324,
    latitudeDelta: 10,
    longitudeDelta: 10,
  };

  const [selectedCoords, setSelectedCoords] = React.useState({
    latitude: initialRegion.latitude,
    longitude: initialRegion.longitude
  });

  const handleMapPress = (e: any) => {
    setSelectedCoords(e.nativeEvent.coordinate);
  };

  const handleCurrentLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      
      const loc = await Location.getCurrentPositionAsync({});
      setSelectedCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude
      });
    } catch (error) {
      console.error("Error getting location:", error);
    }
  };

  const handleConfirm = () => {
    onSelect({ coords: selectedCoords });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={[styles.container, { backgroundColor: theme.bg }]}>
        <MapView
          style={styles.map}
          initialRegion={initialRegion}
          onPress={handleMapPress}
        >
          <UrlTile 
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
          />
          <Marker coordinate={selectedCoords} pinColor={theme.accent} />
        </MapView>

        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={[styles.circleBtn, { backgroundColor: theme.bg }]}>
            <X size={24} color={theme.text} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            onPress={handleCurrentLocation} 
            style={[styles.currentLocBtn, { backgroundColor: theme.accent }]}
          >
            <LocateFixed size={20} color="#000" />
            <Text style={styles.currentLocText}>My Location</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity 
            onPress={handleConfirm}
            style={[styles.confirmBtn, { backgroundColor: theme.text }]}
          >
            <Navigation size={20} color={theme.bg} />
            <Text style={[styles.confirmText, { color: theme.bg }]}>Confirm Selection</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  header: { position: 'absolute', top: 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  circleBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  currentLocBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, gap: 8, elevation: 5 },
  currentLocText: { fontSize: 14, fontWeight: '800', color: '#000' },
  footer: { position: 'absolute', bottom: 40, left: 20, right: 20 },
  confirmBtn: { flexDirection: 'row', height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', gap: 12, elevation: 8 },
  confirmText: { fontSize: 16, fontWeight: '800' },
});
