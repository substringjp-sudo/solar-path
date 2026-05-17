import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, TextInput, ScrollView, Dimensions, Alert, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { MapPin, X, Navigation, Globe, ChevronRight, LocateFixed, Save, Trash2, Map as MapIcon } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useCelestialStore, SavedLocation } from '../../store/useCelestialStore';
import { getCelestialIsochrones, getIsochroneInterval } from '../../utils/celestial';

const { width, height } = Dimensions.get('window');

export const MapPicker = ({ visible, onClose, onSelect, theme, location, currentTime }: any) => {
  const { savedLocations, addSavedLocation, removeSavedLocation } = useCelestialStore();
  const [latInput, setLatInput] = useState(location?.coords?.latitude?.toString() || '37.56');
  const [lonInput, setLonInput] = useState(location?.coords?.longitude?.toString() || '126.97');
  const [locationName, setLocationName] = useState('');
  const [mapZoom, setMapZoom] = useState(10);
  const [showSunriseIso, setShowSunriseIso] = useState(true);
  const [showSunsetIso, setShowSunsetIso] = useState(true);
  const [timeFormat, setTimeFormat] = useState<'local' | 'utc'>('local');
  const [isMapReady, setIsMapReady] = useState(false);
  const iframeRef = useRef<any>(null);

  // Reset map ready status when modal visibility changes
  useEffect(() => {
    if (visible) {
      setIsMapReady(false);
    }
  }, [visible]);
  
  // Leaflet map setup with style & isochrone update messaging support
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
        .isochrone-label {
          font-family: 'monospace', sans-serif;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          background: rgba(0, 0, 0, 0.85);
          padding: 2px 6px;
          border-radius: 4px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
          pointer-events: none;
        }
        .isochrone-label-sunrise {
          color: #FFA500;
          border: 1px solid rgba(255, 165, 0, 0.4);
        }
        .isochrone-label-sunset {
          color: #B39DDB;
          border: 1px solid rgba(147, 112, 219, 0.4);
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
          attribution: '© OpenStreetMap contributors © CARTO'
        }).addTo(map);
        
        // Layer group to hold isochrone polylines and text labels dynamically
        const isochroneLayer = L.layerGroup().addTo(map);

        // Store active data for dynamic redraw during movement
        let currentSunriseIso = [];
        let currentSunsetIso = [];
        let showSunrise = true;
        let showSunset = true;

        // Splitting logic for lines wrapping across the antimeridian (-180/180 lon)
        function splitPointsByAntimeridian(points) {
          if (points.length === 0) return [];
          const segments = [];
          let currentSegment = [points[0]];
          
          for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const lonDiff = Math.abs(curr[1] - prev[1]);
            
            if (lonDiff > 180) {
              segments.push(currentSegment);
              currentSegment = [curr];
            } else {
              currentSegment.push(curr);
            }
          }
          segments.push(currentSegment);
          return segments;
        }

        // Find the best point on the isochrone within viewport near the center latitude
        function findBestLabelPoint(points, centerLat, west, east) {
          let bestPt = null;
          let minLatDiff = Infinity;
          const padding = (east - west) * 0.05; // avoid edge clipping
          
          for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            const lat = pt[0];
            const lng = pt[1];
            
            // Check if the point falls inside visible screen bounds (with padding)
            if (lng >= (west + padding) && lng <= (east - padding)) {
              if (lat < -60 || lat > 60) continue; // skip polar regions
              
              const latDiff = Math.abs(lat - centerLat);
              if (latDiff < minLatDiff) {
                minLatDiff = latDiff;
                bestPt = pt;
              }
            }
          }
          return bestPt;
        }

        // Main rendering function that runs on update and move events
        function redrawIsochrones() {
          isochroneLayer.clearLayers();
          
          const center = map.getCenter();
          const bounds = map.getBounds();
          const west = bounds.getWest();
          const east = bounds.getEast();
          const centerLat = center.lat;
          
          // Calculate wraps to continuously render in copied worlds when panning east/west
          const minOffset = Math.floor((west - 180) / 360) - 1;
          const maxOffset = Math.ceil((east + 180) / 360) + 1;
          
          // 1. Draw Sunrise Isochrones
          if (showSunrise && currentSunriseIso) {
            currentSunriseIso.forEach(line => {
              for (let o = minOffset; o <= maxOffset; o++) {
                const shiftedPoints = line.points.map(pt => [pt[0], pt[1] + o * 360]);
                const segments = splitPointsByAntimeridian(shiftedPoints);
                
                segments.forEach(segment => {
                  L.polyline(segment, {
                    color: '#FFA500',
                    weight: 2.5,
                    opacity: 0.8,
                    dashArray: '5, 8',
                    fill: false
                  }).addTo(isochroneLayer);
                });

                const bestPt = findBestLabelPoint(shiftedPoints, centerLat - 3, west, east);
                if (bestPt) {
                  L.marker([bestPt[0], bestPt[1]], {
                    icon: L.divIcon({
                      className: 'isochrone-div-icon',
                      html: '<div class="isochrone-label isochrone-label-sunrise">' + line.timeLabel + '</div>',
                      iconSize: [50, 20],
                      iconAnchor: [25, 10]
                    })
                  }).addTo(isochroneLayer);
                }
              }
            });
          }

          // 2. Draw Sunset Isochrones
          if (showSunset && currentSunsetIso) {
            currentSunsetIso.forEach(line => {
              for (let o = minOffset; o <= maxOffset; o++) {
                const shiftedPoints = line.points.map(pt => [pt[0], pt[1] + o * 360]);
                const segments = splitPointsByAntimeridian(shiftedPoints);
                
                segments.forEach(segment => {
                  L.polyline(segment, {
                    color: '#9370DB',
                    weight: 2.5,
                    opacity: 0.8,
                    fill: false
                  }).addTo(isochroneLayer);
                });

                const bestPt = findBestLabelPoint(shiftedPoints, centerLat + 3, west, east);
                if (bestPt) {
                  L.marker([bestPt[0], bestPt[1]], {
                    icon: L.divIcon({
                      className: 'isochrone-div-icon',
                      html: '<div class="isochrone-label isochrone-label-sunset">' + line.timeLabel + '</div>',
                      iconSize: [50, 20],
                      iconAnchor: [25, 10]
                    })
                  }).addTo(isochroneLayer);
                }
              }
            });
          }
        }

        // Notify parent that the map is ready for updates
        map.whenReady(() => {
          setTimeout(() => {
            const data = { type: 'MAP_READY' };
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify(data));
            } else {
              window.parent.postMessage(data, '*');
            }
          }, 100);
        });
        
        // Notify parent only when user finishes panning/zooming to keep rendering performant
        map.on('moveend', () => {
          const center = map.getCenter();
          const zoom = map.getZoom();
          const data = { type: 'MAP_MOVE', lat: center.lat, lng: center.lng, zoom: zoom };
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(data));
          } else {
            window.parent.postMessage(data, '*');
          }
        });

        // Trigger dynamic label recalculation during pan/zoom transitions
        map.on('move', redrawIsochrones);
        map.on('zoomend', redrawIsochrones);

        const handleMessage = (event) => {
          let data;
          try {
            data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          } catch (e) {
            data = event.data;
          }
          
          if (data?.type === 'SET_VIEW') {
            map.setView([data.lat, data.lon], 13);
          } else if (data?.type === 'UPDATE_ISOCHRONES') {
            showSunrise = data.showSunrise;
            showSunset = data.showSunset;
            currentSunriseIso = data.sunriseIso || [];
            currentSunsetIso = data.sunsetIso || [];
            redrawIsochrones();
          }
        };

        window.addEventListener('message', handleMessage);
        document.addEventListener('message', handleMessage);
      </script>
    </body>
    </html>
  `;

  // Synchronize state changes to WebView/iframe isochrone layers
  useEffect(() => {
    const sendIsochrones = () => {
      if (!isMapReady) return;

      const date = currentTime || new Date();
      const timezoneOffset = timeFormat === 'utc' ? 0 : date.getTimezoneOffset();
      
      const sunriseIsoRaw = showSunriseIso ? getCelestialIsochrones(date, 'sunrise', mapZoom, timezoneOffset) : [];
      const sunsetIsoRaw = showSunsetIso ? getCelestialIsochrones(date, 'sunset', mapZoom, timezoneOffset) : [];
      
      // Map to plain [lat, lng] format compatible with Leaflet
      const sunriseIso = sunriseIsoRaw.map(line => ({
        timeLabel: line.timeLabel,
        points: line.points.map(p => [p.latitude, p.longitude])
      }));
      const sunsetIso = sunsetIsoRaw.map(line => ({
        timeLabel: line.timeLabel,
        points: line.points.map(p => [p.latitude, p.longitude])
      }));
      
      const message = {
        type: 'UPDATE_ISOCHRONES',
        showSunrise: showSunriseIso,
        showSunset: showSunsetIso,
        sunriseIso,
        sunsetIso
      };
      
      if (iframeRef.current) {
        if (Platform.OS === 'web') {
          iframeRef.current.contentWindow?.postMessage(message, '*');
        } else {
          // Robust message injection avoiding RN WebView message drops
          const runJS = `
            if (typeof handleMessage === 'function') {
              handleMessage({ data: ${JSON.stringify(message)} });
            }
            true;
          `;
          iframeRef.current.injectJavaScript(runJS);
        }
      }
    };
    
    sendIsochrones();
  }, [currentTime, mapZoom, showSunriseIso, showSunsetIso, timeFormat, visible, isMapReady]);

  // Handle messages sent from standard browser frames (for Web platform compatibility)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleMessage = (event: any) => {
      if (event.data?.type === 'MAP_READY') {
        setIsMapReady(true);
      } else if (event.data?.type === 'MAP_MOVE') {
        setLatInput(event.data.lat.toFixed(6));
        setLonInput(event.data.lng.toFixed(6));
        if (typeof event.data.zoom === 'number') {
          setMapZoom(event.data.zoom);
        }
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

  // Safe split handling across iOS, Android, and Web platforms to avoid prompt-related crashes
  const handleSaveLocation = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert('Error', 'Invalid coordinates');
      return;
    }

    const performSave = (name: string) => {
      if (!name.trim()) {
        Alert.alert('Error', 'Please enter a name for this location');
        return;
      }
      addSavedLocation(name.trim(), lat, lon);
      setLocationName('');
      Alert.alert('Success', `"${name.trim()}" saved!`);
    };

    if (locationName.trim()) {
      performSave(locationName);
    } else {
      if (Platform.OS === 'web') {
        const name = window.prompt('Enter location name (e.g. Home):');
        if (name !== null) {
          performSave(name);
        }
      } else if (Platform.OS === 'ios') {
        Alert.prompt(
          'Save Location',
          'Enter a name for this spot:',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Save', onPress: (name?: string) => performSave(name || '') }
          ],
          'plain-text',
          ''
        );
      } else {
        const defaultName = `Spot ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        performSave(defaultName);
      }
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

  const handleCurrentLocation = async () => {
    if (Platform.OS === 'web') {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            handleJumpToLocation(position.coords.latitude, position.coords.longitude);
          },
          (error) => {
            console.error("Error getting location:", error);
            Alert.alert('Error', 'Failed to get current location');
          }
        );
      } else {
        Alert.alert('Error', 'Geolocation is not supported by your browser');
      }
    } else {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Permission to access location was denied');
          return;
        }
        
        const loc = await Location.getCurrentPositionAsync({});
        handleJumpToLocation(loc.coords.latitude, loc.coords.longitude);
      } catch (error) {
        console.error("Error getting location:", error);
        Alert.alert('Error', 'Failed to get current location');
      }
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

          {/* Map Wrapper with Floating Overlay Controls (Not wrapped in ScrollView for perfect gesture experience) */}
          <View style={styles.mapWrapper}>
            <View style={[styles.mapContainer, { borderColor: theme.border }]}>
              {Platform.OS === 'web' ? (
                <iframe
                  ref={iframeRef}
                  srcDoc={mapHtml}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 24 }}
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
                      if (data.type === 'MAP_READY') {
                        setIsMapReady(true);
                      } else if (data.type === 'MAP_MOVE') {
                        setLatInput(data.lat.toFixed(6));
                        setLonInput(data.lng.toFixed(6));
                        if (typeof data.zoom === 'number') {
                          setMapZoom(data.zoom);
                        }
                      }
                    } catch (e) {
                      console.error("WebView message parse error:", e);
                    }
                  }}
                />
              )}
            </View>

            {/* Floating Glassmorphism Controls on top of the Map */}
            <View style={[styles.floatingControls, { backgroundColor: theme.glass, borderColor: theme.border }]}>
              <View style={styles.floatingHeader}>
                <Text style={[styles.floatingTitle, { color: theme.text }]}>
                  Interval: {getIsochroneInterval(mapZoom)}m
                </Text>
              </View>
              
              <View style={styles.floatingButtons}>
                <TouchableOpacity
                  onPress={() => setShowSunriseIso(!showSunriseIso)}
                  style={[
                    styles.floatingBtn,
                    {
                      borderColor: showSunriseIso ? 'rgba(255,165,0,0.4)' : 'transparent',
                      backgroundColor: showSunriseIso ? 'rgba(255,165,0,0.18)' : 'rgba(255,255,255,0.06)'
                    }
                  ]}
                >
                  <Text style={[styles.floatingBtnText, { color: showSunriseIso ? '#FFA500' : theme.subText }]}>
                    🌅 {showSunriseIso ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowSunsetIso(!showSunsetIso)}
                  style={[
                    styles.floatingBtn,
                    {
                      borderColor: showSunsetIso ? 'rgba(147,112,219,0.4)' : 'transparent',
                      backgroundColor: showSunsetIso ? 'rgba(147,112,219,0.18)' : 'rgba(255,255,255,0.06)'
                    }
                  ]}
                >
                  <Text style={[styles.floatingBtnText, { color: showSunsetIso ? '#B39DDB' : theme.subText }]}>
                    🌇 {showSunsetIso ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setTimeFormat(timeFormat === 'local' ? 'utc' : 'local')}
                  style={[
                    styles.floatingBtn,
                    {
                      borderColor: 'transparent',
                      backgroundColor: 'rgba(255,255,255,0.08)'
                    }
                  ]}
                >
                  <Text style={[styles.floatingBtnText, { color: theme.text }]}>
                    ⏰ {timeFormat === 'local' ? 'LCL' : 'UTC'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Form and List Scroll Area - Purely works for secondary actions without map gesture conflicts */}
          <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.section, { backgroundColor: theme.glass, borderColor: theme.border }]}>
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
  mapWrapper: {
    position: 'relative',
    height: height * 0.4,
    minHeight: 300,
    maxHeight: 380,
    marginBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
  },
  mapContainer: { flex: 1, borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
  floatingControls: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  floatingHeader: {
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  floatingTitle: {
    fontSize: 9,
    fontWeight: '800',
    opacity: 0.7,
    letterSpacing: 0.5,
  },
  floatingButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  floatingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 44,
  },
  floatingBtnText: {
    fontSize: 9,
    fontWeight: '900',
  },
  formScroll: { flex: 1 },
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

