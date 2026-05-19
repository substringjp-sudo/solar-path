import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, TextInput, ScrollView, Dimensions, Alert, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { MapPin, X, Navigation, LocateFixed, Save, Trash2, Star, Camera } from 'lucide-react-native';
import * as Location from 'expo-location';
import { getCelestialIsochrones, getIsochroneInterval } from '../../utils/celestial';

const { width, height } = Dimensions.get('window');

export const MapPicker = ({ 
  visible, 
  onClose, 
  onSelect, 
  theme, 
  location, 
  currentTime, 
  isDay = false,
  savedLocations = [],
  addSavedLocation,
  removeSavedLocation,
  myPhotos = [],
  addMyPhoto,
  removeMyPhoto
}: any) => {
  const [activeTab, setActiveTab] = useState<'location' | 'photo'>('location');
  const [latInput, setLatInput] = useState(location?.coords?.latitude?.toString() || '37.56');
  const [lonInput, setLonInput] = useState(location?.coords?.longitude?.toString() || '126.97');
  const [mapZoom, setMapZoom] = useState(10);
  const [showSunriseIso, setShowSunriseIso] = useState(true);
  const [showSunsetIso, setShowSunsetIso] = useState(true);
  const [timeFormat, setTimeFormat] = useState<'local' | 'utc'>('local');
  const [isMapReady, setIsMapReady] = useState(false);
  const [saveName, setSaveName] = useState('');
  const iframeRef = useRef<any>(null);

  // Premium UI tokens for Map WebView
  const mapBg = isDay ? '#E8EDF2' : '#08080C';
  const popupBg = isDay ? '#FFFFFF' : '#14141C';
  const popupText = isDay ? '#1A1A1A' : '#FFFFFF';
  const popupBorder = isDay ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)';
  const accentColor = isDay ? '#4F46E5' : '#FFD700'; // Indigo for Light, Gold for Dark

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
      <script src="https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
      <style>
        body, html, #map { height: 100%; margin: 0; padding: 0; background: ${mapBg}; }
        .crosshair {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1000; pointer-events: none;
          display: flex; align-items: center; justify-content: center;
        }
        .leaflet-popup-content-wrapper, .leaflet-popup-tip {
          background: ${popupBg} !important;
          color: ${popupText} !important;
          border: 1px solid ${popupBorder};
          border-radius: 12px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.15) !important;
        }
        .isochrone-label {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
          background: ${isDay ? 'rgba(255, 255, 255, 0.92)' : 'rgba(10, 10, 18, 0.88)'};
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding: 4px 8px;
          border-radius: 6px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.35);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .isochrone-label-sunrise {
          color: #FFB300;
          border: 1px solid rgba(255, 179, 0, 0.4);
        }
        .isochrone-label-sunset {
          color: ${isDay ? '#6200EE' : '#D1C4E9'};
          border: 1px solid rgba(179, 157, 219, 0.4);
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <div class="crosshair" id="crosshair-element">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Outer target circle -->
          <circle cx="20" cy="20" r="8" stroke="${accentColor}" stroke-width="2.5" opacity="0.8" style="filter: drop-shadow(0px 1px 3px rgba(0,0,0,0.4));" />
          <!-- Center tracking dot -->
          <circle cx="20" cy="20" r="1.5" fill="${accentColor}" />
          <!-- Micro-reticle line ticks -->
          <line x1="20" y1="2" x2="20" y2="9" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" style="filter: drop-shadow(0px 1px 3px rgba(0,0,0,0.4));" />
          <line x1="20" y1="31" x2="20" y2="38" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" style="filter: drop-shadow(0px 1px 3px rgba(0,0,0,0.4));" />
          <line x1="2" y1="20" x2="9" y2="20" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" style="filter: drop-shadow(0px 1px 3px rgba(0,0,0,0.4));" />
          <line x1="31" y1="20" x2="38" y2="20" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" style="filter: drop-shadow(0px 1px 3px rgba(0,0,0,0.4));" />
        </svg>
      </div>
      <script>
        const map = L.map('map', {
          zoomControl: false
        }).setView([${location?.coords?.latitude || 37.56}, ${location?.coords?.longitude || 126.97}], 10);
        
        const tileUrl = ${isDay ? "'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'" : "'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'"};
        L.tileLayer(tileUrl, {
          attribution: '© OpenStreetMap contributors © CARTO'
        }).addTo(map);
        
        // Layer group to hold isochrone polylines and text labels dynamically
        const isochroneLayer = L.layerGroup().addTo(map);

        // Heatmap and user photos overlay configurations
        const globalHeatmapPoints = [
          // Seoul
          [37.5665, 126.9780, 0.8], [37.5615, 126.9830, 0.9], [37.5515, 126.9880, 0.75],
          [37.5284, 126.9331, 0.95], [37.5184, 126.9381, 0.9], [37.5254, 126.9231, 0.85],
          [37.5113, 127.0981, 0.8], [37.5123, 127.1001, 0.85],
          // Tokyo
          [35.6895, 139.6917, 0.8], [35.6586, 139.7454, 0.9], [35.6606, 139.7304, 0.75],
          // Paris
          [48.8584, 2.2945, 0.95], [48.8604, 2.2925, 0.9], [48.8564, 2.2985, 0.85],
          // New York
          [40.7128, -74.0060, 0.85], [40.7061, -73.9969, 0.95], [40.7071, -74.0120, 0.75],
          // London
          [51.5074, -0.1278, 0.8], [51.5007, -0.1246, 0.9], [51.5055, -0.0754, 0.85],
          // Sydney
          [-33.8568, 151.2153, 0.9], [-33.8588, 151.2133, 0.95],
          // Los Angeles
          [34.0522, -118.2437, 0.8], [34.1341, -118.2978, 0.9]
        ];

        let heatLayer = null;
        let myPhotosMarkers = [];
        let mapMode = 'location'; // 'location' or 'photo'
        let myPhotosData = [];

        function redrawMapLayers() {
          if (heatLayer) {
            map.removeLayer(heatLayer);
            heatLayer = null;
          }
          myPhotosMarkers.forEach(m => map.removeLayer(m));
          myPhotosMarkers = [];

          const crosshair = document.getElementById('crosshair-element');
          if (crosshair) {
            crosshair.style.display = (mapMode === 'location') ? 'flex' : 'none';
          }

          if (mapMode === 'photo') {
            // Hide isochrones on photo mode
            isochroneLayer.clearLayers();

            if (typeof L.heatLayer === 'function') {
              heatLayer = L.heatLayer(globalHeatmapPoints, {
                radius: 28,
                blur: 16,
                max: 1.0
              }).addTo(map);
            }

            myPhotosData.forEach(photo => {
              const marker = L.circleMarker([photo.latitude, photo.longitude], {
                radius: 9,
                color: '#FF6D00',
                fillColor: '#FFD700',
                fillOpacity: 0.9,
                weight: 3.5
              });

              const popupContent = '<div style="font-family: -apple-system, BlinkMacSystemFont, ' + "'Segoe UI', Roboto, sans-serif; width: 140px; text-align: center;\">" +
                '<img src="' + photo.imageUrl + '" style="width: 120px; height: 80px; object-fit: cover; border-radius: 8px; margin-bottom: 6px; border: 1px solid rgba(0,0,0,0.15);" />' +
                '<div style="font-size: 12px; font-weight: bold; color: ' + popupText + '; margin-bottom: 2px;">' + photo.locationName + '</div>' +
                '<div style="font-size: 9px; color: ' + (isDay ? '#555' : '#ccc') + ';">' + new Date(photo.timestamp).toLocaleDateString() + '</div>' +
                '</div>';
              marker.bindPopup(popupContent, { closeButton: false });
              marker.addTo(map);
              myPhotosMarkers.push(marker);
            });
          } else {
            // redraw isochrones if switched back to location mode
            redrawIsochrones();
          }
        }

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

        // Find the best point on the isochrone within viewport near the center latitude, avoiding the top-right control panel area.
        function findBestLabelPoint(points, centerLat, west, east) {
          let bestPt = null;
          let minLatDiff = Infinity;
          const padding = (east - west) * 0.05; // avoid edge clipping
          
          const mapSize = map.getSize();
          const mapWidth = mapSize.x;
          const mapHeight = mapSize.y;
          
          // First pass: try to find a point that is inside the viewport AND avoids the top-right controls area
          for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            const lat = pt[0];
            const lng = pt[1];
            
            // Check if the point falls inside visible screen bounds (with padding)
            if (lng >= (west + padding) && lng <= (east - padding)) {
              if (lat < -60 || lat > 60) continue; // skip polar regions
              
              // Project to 2D container pixels to check if it overlaps the top-right floating controls
              // Floating controls area: x > mapWidth - 250 && y < 220
              const containerPt = map.latLngToContainerPoint(L.latLng(lat, lng));
              if (containerPt.x > mapWidth - 250 && containerPt.y < 220) {
                continue; // Skip points hidden under the controls panel
              }
              
              const latDiff = Math.abs(lat - centerLat);
              if (latDiff < minLatDiff) {
                minLatDiff = latDiff;
                bestPt = pt;
              }
            }
          }
          
          // Fallback pass: if all points in viewport are inside the controls area, relax the controls restriction
          if (!bestPt) {
            minLatDiff = Infinity;
            for (let i = 0; i < points.length; i++) {
              const pt = points[i];
              const lat = pt[0];
              const lng = pt[1];
              
              if (lng >= (west + padding) && lng <= (east - padding)) {
                if (lat < -60 || lat > 60) continue;
                
                const latDiff = Math.abs(lat - centerLat);
                if (latDiff < minLatDiff) {
                  minLatDiff = latDiff;
                  bestPt = pt;
                }
              }
            }
          }
          
          return bestPt;
        }

        // Main rendering function that runs on update and move events
        function redrawIsochrones() {
          if (mapMode !== 'location') {
            isochroneLayer.clearLayers();
            return;
          }
          isochroneLayer.clearLayers();
          
          const center = map.getCenter();
          const bounds = map.getBounds();
          const west = bounds.getWest();
          const east = bounds.getEast();
          const centerLat = center.lat;
          
          // Calculate wraps to continuously render in copied worlds when panning east/west
          const minOffset = Math.floor((west - 180) / 360) - 1;
          const maxOffset = Math.ceil((east + 180) / 360) + 1;
          
          const labelsToDraw = [];
          
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
                  labelsToDraw.push({
                    lat: bestPt[0],
                    lng: bestPt[1],
                    text: line.timeLabel,
                    emoji: '🌅',
                    labelClass: 'isochrone-label-sunrise'
                  });
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
                  labelsToDraw.push({
                    lat: bestPt[0],
                    lng: bestPt[1],
                    text: line.timeLabel,
                    emoji: '🌇',
                    labelClass: 'isochrone-label-sunset'
                  });
                }
              }
            });
          }

          // 3. Resolve Label Collisions in 2D Screen Space
          if (labelsToDraw.length > 0) {
            // Projected screen size for collision calculations (76px width, 28px height)
            const width = 76;
            const height = 28;
            
            // Map labels to pixel coordinates in viewport
            const processedLabels = labelsToDraw.map(lbl => {
              const pixel = map.latLngToContainerPoint(L.latLng(lbl.lat, lbl.lng));
              return {
                ...lbl,
                x: pixel.x,
                y: pixel.y,
                width: width,
                height: height
              };
            });
            
            // Iteratively push overlapping labels vertically to resolve collision
            const iterations = 8;
            for (let iter = 0; iter < iterations; iter++) {
              let changed = false;
              for (let i = 0; i < processedLabels.length; i++) {
                for (let j = i + 1; j < processedLabels.length; j++) {
                  const a = processedLabels[i];
                  const b = processedLabels[j];
                  
                  const dx = Math.abs(a.x - b.x);
                  const dy = Math.abs(a.y - b.y);
                  
                  // Add a small extra margin (8px width, 6px height) for spacing
                  const minX = (a.width + b.width) / 2 + 8;
                  const minY = (a.height + b.height) / 2 + 6;
                  
                  if (dx < minX && dy < minY) {
                    const overlapY = minY - dy;
                    const push = overlapY / 2;
                    
                    if (a.y <= b.y) {
                      a.y -= push;
                      b.y += push;
                    } else {
                      a.y += push;
                      b.y -= push;
                    }
                    changed = true;
                  }
                }
              }
              if (!changed) break;
            }
            
            // Draw collision-resolved labels back onto the map
            processedLabels.forEach(lbl => {
              const finalLatLng = map.containerPointToLatLng(L.point(lbl.x, lbl.y));
              L.marker([finalLatLng.lat, finalLatLng.lng], {
                icon: L.divIcon({
                  className: 'isochrone-div-icon',
                  html: '<div class="isochrone-label ' + lbl.labelClass + '">' +
                        '<span style="font-size: 14px; margin-right: 2px;">' + lbl.emoji + '</span>' +
                        '<span>' + lbl.text + '</span>' +
                        '</div>',
                  iconSize: [lbl.width, lbl.height],
                  iconAnchor: [lbl.width / 2, lbl.height / 2]
                })
              }).addTo(isochroneLayer);
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
          } else if (data?.type === 'UPDATE_MAP_MODE') {
            mapMode = data.mode;
            myPhotosData = data.myPhotos || [];
            redrawMapLayers();
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

  // Synchronize map mode changes (location <-> photo) to WebView
  useEffect(() => {
    if (!isMapReady) return;

    const message = {
      type: 'UPDATE_MAP_MODE',
      mode: activeTab,
      myPhotos: myPhotos
    };

    if (iframeRef.current) {
      if (Platform.OS === 'web') {
        iframeRef.current.contentWindow?.postMessage(message, '*');
      } else {
        const runJS = `
          if (typeof handleMessage === 'function') {
            handleMessage({ data: ${JSON.stringify(message)} });
          }
          true;
        `;
        iframeRef.current.injectJavaScript(runJS);
      }
    }
  }, [activeTab, myPhotos, isMapReady, visible]);

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



  const handleManualSelect = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      onSelect({ coords: { latitude: lat, longitude: lon } });
      onClose();
    }
  };

  const handleSaveLocation = () => {
    if (!saveName.trim()) {
      Alert.alert('Notification', 'Please enter a name for the place.');
      return;
    }
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert('Error', 'Invalid coordinates.');
      return;
    }

    addSavedLocation(saveName.trim(), lat, lon);
    setSaveName('');
    Alert.alert('Success', `'${saveName.trim()}' has been saved successfully.`);
  };

  const handleSelectSaved = (saved: any) => {
    handleJumpToLocation(saved.latitude, saved.longitude);
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

  const sunsetImages = [
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1472214222541-d510753a4907?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=600&q=80'
  ];

  const handleCapturePhoto = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert('Error', 'Invalid coordinates.');
      return;
    }
    
    const locationName = `Sunset at ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    const randomImg = sunsetImages[Math.floor(Math.random() * sunsetImages.length)];
    
    addMyPhoto(randomImg, lat, lon, locationName);
    Alert.alert('Success', 'Sunset photo captured and pinned at this spot!');
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

          {/* 탭 네비게이션 */}
          <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'location' && [styles.activeTabItem, { borderBottomColor: theme.accent }]]}
              onPress={() => setActiveTab('location')}
            >
              <Text style={[styles.tabText, activeTab === 'location' ? { color: theme.accent } : { color: theme.subText }]}>
                Location
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'photo' && [styles.activeTabItem, { borderBottomColor: theme.accent }]]}
              onPress={() => setActiveTab('photo')}
            >
              <Text style={[styles.tabText, activeTab === 'photo' ? { color: theme.accent } : { color: theme.subText }]}>
                Photo
              </Text>
            </TouchableOpacity>
          </View>

          {/* Map Wrapper with Floating Overlay Controls */}
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
            {activeTab === 'location' && (
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
            )}
          </View>

          {/* Form and List Scroll Area */}
          <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
            {activeTab === 'location' ? (
              <>
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

                  {/* 즐겨찾기 저장 폼 */}
                  <View style={[styles.saveRow, { borderColor: theme.border }]}>
                    <TextInput
                      style={[styles.nameInput, { color: theme.text, borderColor: theme.border }]}
                      placeholder="Enter place name"
                      placeholderTextColor={theme.subText}
                      value={saveName}
                      onChangeText={setSaveName}
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, { backgroundColor: theme.accent }]}
                      onPress={handleSaveLocation}
                    >
                      <Save size={16} color="#000" />
                      <Text style={styles.saveBtnText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity 
                  onPress={handleManualSelect}
                  style={[styles.confirmBtn, { backgroundColor: theme.accent, marginTop: 24, marginBottom: 24 }]}
                >
                  <Navigation size={20} color="#000" />
                  <Text style={styles.confirmBtnText}>Select This Location</Text>
                </TouchableOpacity>

                {/* 저장된 즐겨찾기 목록 */}
                <View style={styles.savedSection}>
                  <Text style={[styles.sectionTitle, { color: theme.subText, marginBottom: 12 }]}>SAVED PLACES</Text>
                  {savedLocations.length === 0 ? (
                    <View style={[styles.emptyState, { borderColor: theme.border }]}>
                      <Star size={24} color={theme.subText} style={{ marginBottom: 6 }} />
                      <Text style={{ color: theme.subText, fontSize: 13 }}>No saved places.</Text>
                    </View>
                  ) : (
                    <View style={styles.savedList}>
                      {savedLocations.map((loc: any) => (
                        <View key={loc.id} style={[styles.savedItem, { borderColor: theme.border, backgroundColor: theme.glass }]}>
                          <TouchableOpacity
                            style={styles.savedItemContent}
                            onPress={() => handleSelectSaved(loc)}
                          >
                            <View style={[styles.savedItemIcon, { backgroundColor: theme.glass }]}>
                              <MapPin size={16} color={theme.accent} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.savedItemName, { color: theme.text }]}>{loc.name}</Text>
                              <Text style={[styles.savedItemCoords, { color: theme.subText }]}>
                                {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                              </Text>
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.deleteBtn}
                            onPress={() => removeSavedLocation(loc.id)}
                          >
                            <Trash2 size={16} color="#FF4444" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </>
            ) : (
              // Photo Tab Panel
              <>
                <View style={[styles.photoCapturePanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <Text style={[styles.photoCaptureTitle, { color: theme.subText }]}>Capture Sunset Spot</Text>
                  <Text style={[styles.photoCaptureDesc, { color: theme.text }]}>
                    Pin a beautiful sunset photo at the selected coordinates on the map.
                  </Text>
                  
                  <TouchableOpacity
                    style={[styles.captureBtn, { backgroundColor: theme.accent }]}
                    onPress={handleCapturePhoto}
                  >
                    <Camera size={18} color="#000" />
                    <Text style={{ color: '#000', fontWeight: '800', fontSize: 14 }}>Post Sunset Photo</Text>
                  </TouchableOpacity>
                </View>

                {/* 내가 찍은 사진 갤러리 */}
                <View style={styles.gallerySection}>
                  <Text style={[styles.sectionTitle, { color: theme.subText }]}>My Sunset Photos</Text>
                  {myPhotos.length === 0 ? (
                    <View style={[styles.emptyState, { borderColor: theme.border, marginTop: 12 }]}>
                      <Camera size={24} color={theme.subText} style={{ marginBottom: 6 }} />
                      <Text style={{ color: theme.subText, fontSize: 13 }}>No sunset photos captured yet.</Text>
                    </View>
                  ) : (
                    <View style={styles.galleryGrid}>
                      {myPhotos.map((photo: any) => (
                        <View key={photo.id} style={[styles.galleryItem, { borderColor: theme.border, backgroundColor: theme.glass }]}>
                          <iframe
                            src={photo.imageUrl}
                            style={styles.galleryImage as any}
                          />
                          <View style={styles.galleryMeta}>
                            <Text numberOfLines={1} style={[styles.galleryTitle, { color: theme.text }]}>
                              {photo.locationName}
                            </Text>
                            <Text style={[styles.galleryDate, { color: theme.subText }]}>
                              {new Date(photo.timestamp).toLocaleDateString()}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.photoDeleteBtn}
                            onPress={() => removeMyPhoto(photo.id)}
                          >
                            <Trash2 size={12} color="#FF6F61" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { height: height * 0.9, borderTopLeftRadius: 40, borderTopRightRadius: 40, paddingHorizontal: 24, paddingTop: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '900' },
  subtitle: { fontSize: 13, marginTop: 2, opacity: 0.8 },
  closeBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12 },
  
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, marginBottom: 16 },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTabItem: { borderBottomWidth: 2 },
  tabText: { fontSize: 14, fontWeight: '600' },

  mapWrapper: {
    position: 'relative',
    height: height * 0.38,
    minHeight: 280,
    maxHeight: 340,
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

  photoCapturePanel: { padding: 16, borderRadius: 24, borderWidth: 1, alignItems: 'center', gap: 12 },
  photoCaptureTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  photoCaptureDesc: { fontSize: 12, textAlign: 'center', opacity: 0.7, lineHeight: 18 },
  captureBtn: { flexDirection: 'row', height: 48, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center', gap: 8, justifyContent: 'center', width: '100%' },
  gallerySection: { marginTop: 24 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  galleryItem: { width: (width - 60) / 2, borderRadius: 16, overflow: 'hidden', borderWidth: 1, position: 'relative' },
  galleryImage: { width: '100%', height: 100, borderWidth: 0, backgroundColor: 'rgba(0,0,0,0.1)' },
  galleryMeta: { padding: 8 },
  galleryTitle: { fontSize: 12, fontWeight: '700' },
  galleryDate: { fontSize: 9, opacity: 0.6, marginTop: 2 },
  photoDeleteBtn: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }
});

