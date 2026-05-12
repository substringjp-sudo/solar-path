import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, TextInput, ScrollView, Dimensions, Alert, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { MapPin, X, Navigation, Globe, ChevronRight, LocateFixed, Save, Trash2, Map as MapIcon } from 'lucide-react-native';
import { useCelestialStore, SavedLocation } from '../../store/useCelestialStore';

const { width, height } = Dimensions.get('window');

export const MapPicker = ({ visible, onClose, onSelect, theme, location }: any) => {
  const { savedLocations, addSavedLocation, removeSavedLocation } = useCelestialStore();
  const [latInput, setLatInput] = useState(location?.coords?.latitude?.toString() || '37.56');
  const [lonInput, setLonInput] = useState(location?.coords?.longitude?.toString() || '126.97');
  const [locationName, setLocationName] = useState('');
  const iframeRef = useRef<any>(null);
  
  // Use a ref to store the initial HTML
  const mapHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body, html, #map { height: 100%; margin: 0; padding: 0; background: #000; }
        .crosshair {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -100%);
          z-index: 1000; pointer-events: none;
          font-size: 24px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <div class="crosshair">📍</div>
      <script>
        const map = L.map('map', {
          zoomControl: false
        }).setView([${location?.coords?.latitude || 37.56}, ${location?.coords?.longitude || 126.97}], 10);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(map);
        
        map.on('move', () => {
          const center = map.getCenter();
          const data = { type: 'MAP_MOVE', lat: center.lat, lng: center.lng };
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(data));
          } else {
            window.parent.postMessage(data, '*');
          }
        });

        const handleMessage = (event) => {
          let data;
          try {
            data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          } catch (e) {
            data = event.data;
          }
          if (data?.type === 'SET_VIEW') {
            map.setView([data.lat, data.lon], 13);
          }
        };

        window.addEventListener('message', handleMessage);
        document.addEventListener('message', handleMessage);
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    const handleMessage = (event: any) => {
      if (event.data?.type === 'MAP_MOVE') {
        setLatInput(event.data.lat.toFixed(6));
        setLonInput(event.data.lng.toFixed(6));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleJumpToLocation = (lat: number, lon: number) => {
    setLatInput(lat.toString());
    setLonInput(lon.toString());
    if (iframeRef.current) {
      if (Platform.OS === 'web') {
        iframeRef.current.contentWindow.postMessage({ type: 'SET_VIEW', lat, lon }, '*');
      } else {
        iframeRef.current.postMessage(JSON.stringify({ type: 'SET_VIEW', lat, lon }));
      }
    }
  };

  const handleSaveLocation = () => {
    if (!locationName.trim()) {
      Alert.alert('Error', 'Please enter a name for this location');
      return;
    }
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      addSavedLocation(locationName.trim(), lat, lon);
      setLocationName('');
      Alert.alert('Success', 'Location saved!');
    }
  };

  const handleManualSelect = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      onSelect({ coords: { latitude: lat, longitude: lon } });
      onClose();
    }
  };

  const handleCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          handleJumpToLocation(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.bg }]}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.text }]}>Change Location</Text>
              <Text style={[styles.subtitle, { color: theme.subText }]}>Pick on map or use saved spots</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={24} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={[styles.mapContainer, { borderColor: theme.border }]}>
              {Platform.OS === 'web' ? (
                <iframe
                  ref={iframeRef}
                  srcDoc={mapHtml}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 16 }}
                />
              ) : (
                <WebView
                  ref={iframeRef}
                  originWhitelist={['*']}
                  source={{ html: mapHtml }}
                  style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
                  userAgent="SolarPathApp/1.0 (Mobile; contact: solar-path-dev@example.com)"
                  onMessage={(event) => {
                    try {
                      const data = JSON.parse(event.nativeEvent.data);
                      if (data.type === 'MAP_MOVE') {
                        setLatInput(data.lat.toFixed(6));
                        setLonInput(data.lng.toFixed(6));
                      }
                    } catch (e) {
                      console.error("WebView message parse error:", e);
                    }
                  }}
                />
              )}
            </View>

            <View style={[styles.section, { backgroundColor: theme.glass, borderColor: theme.border, marginTop: 16 }]}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>PICKED COORDINATES</Text>
                <TouchableOpacity onPress={handleCurrentLocation} style={styles.currentLocLink}>
                  <LocateFixed size={12} color={theme.accent} />
                  <Text style={[styles.currentLocLinkText, { color: theme.accent }]}>My Location</Text>
                </TouchableOpacity>
              </View>
              
              <View style={styles.inputRow}>
                <View style={styles.coordBox}>
                   <Text style={styles.coordLabel}>Latitude</Text>
                   <TextInput
                     style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                     value={latInput}
                     onChangeText={setLatInput}
                     keyboardType="numeric"
                   />
                </View>
                <View style={styles.coordBox}>
                   <Text style={styles.coordLabel}>Longitude</Text>
                   <TextInput
                     style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                     value={lonInput}
                     onChangeText={setLonInput}
                     keyboardType="numeric"
                   />
                </View>
              </View>

              <View style={[styles.saveRow, { borderTopColor: theme.border }]}>
                <TextInput
                  style={[styles.nameInput, { color: theme.text, borderColor: theme.border }]}
                  placeholder="Location name (e.g. Home)"
                  placeholderTextColor="#666"
                  value={locationName}
                  onChangeText={setLocationName}
                />
                <TouchableOpacity 
                  onPress={handleSaveLocation}
                  style={[styles.saveBtn, { backgroundColor: theme.accent }]}
                >
                  <Save size={18} color="#000" />
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.savedSection}>
              <Text style={[styles.sectionTitle, { color: theme.subText, marginBottom: 12 }]}>SAVED PLACES</Text>
              {savedLocations.length === 0 ? (
                <View style={[styles.emptyState, { borderColor: theme.border }]}>
                  <MapIcon size={24} color={theme.subText} opacity={0.5} />
                  <Text style={{ color: theme.subText, fontSize: 12, marginTop: 8 }}>No saved locations yet</Text>
                </View>
              ) : (
                <View style={styles.savedList}>
                  {savedLocations.map((loc: SavedLocation) => (
                    <View key={loc.id} style={[styles.savedItem, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                      <TouchableOpacity 
                        style={styles.savedItemContent}
                        onPress={() => handleJumpToLocation(loc.latitude, loc.longitude)}
                      >
                        <View style={styles.savedItemIcon}>
                          <MapPin size={16} color={theme.accent} />
                        </View>
                        <View>
                          <Text style={[styles.savedItemName, { color: theme.text }]}>{loc.name}</Text>
                          <Text style={[styles.savedItemCoords, { color: theme.subText }]}>
                            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => removeSavedLocation(loc.id)}
                        style={styles.deleteBtn}
                      >
                        <Trash2 size={16} color="#ff4444" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity 
              onPress={handleManualSelect}
              style={[styles.confirmBtn, { backgroundColor: theme.accent, marginTop: 24, marginBottom: 40 }]}
            >
              <Navigation size={20} color="#000" />
              <Text style={styles.confirmBtnText}>Select This Location</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { height: height * 0.9, borderTopLeftRadius: 40, borderTopRightRadius: 40, paddingHorizontal: 24, paddingTop: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '900' },
  subtitle: { fontSize: 13, marginTop: 2, opacity: 0.8 },
  closeBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12 },
  body: { flex: 1 },
  mapContainer: { height: 300, borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
  section: { padding: 16, borderRadius: 24, borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  currentLocLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  currentLocLinkText: { fontSize: 11, fontWeight: '700' },
  inputRow: { flexDirection: 'row', gap: 12 },
  coordBox: { flex: 1, gap: 4 },
  coordLabel: { fontSize: 10, fontWeight: '700', color: '#888', marginLeft: 4 },
  input: { height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.2)' },
  saveRow: { flexDirection: 'row', marginTop: 16, paddingTop: 16, borderTopWidth: 1, gap: 10, alignItems: 'center' },
  nameInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.2)' },
  saveBtn: { flexDirection: 'row', height: 44, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', gap: 8 },
  saveBtnText: { fontWeight: '800', fontSize: 13, color: '#000' },
  savedSection: { marginTop: 24 },
  emptyState: { height: 100, borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  savedList: { gap: 10 },
  savedItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1 },
  savedItemContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedItemIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  savedItemName: { fontSize: 15, fontWeight: '700' },
  savedItemCoords: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  deleteBtn: { padding: 10 },
  confirmBtn: { flexDirection: 'row', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  confirmBtnText: { fontSize: 17, fontWeight: '900', color: '#000' },
});
