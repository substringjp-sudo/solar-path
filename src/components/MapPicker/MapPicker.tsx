import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, TextInput, ScrollView, Dimensions, Alert, Platform, ActivityIndicator, Image, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import { MapPin, X, Navigation, LocateFixed, Save, Trash2, Star, Camera, Image as ImageIcon } from 'lucide-react-native';
import * as Location from 'expo-location';
import { auth } from '../../config/firebase';
import { getIsochroneInterval } from '../../utils/celestial';

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
  removeSavedLocation
}: any) => {
  const [windowHeight] = useState(Dimensions.get('window').height);
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: windowHeight,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, windowHeight]);

  const activeTab = 'location';
  const [latInput, setLatInput] = useState(location?.coords?.latitude?.toString() || '37.56');
  const [lonInput, setLonInput] = useState(location?.coords?.longitude?.toString() || '126.97');
  const [mapZoom, setMapZoom] = useState(10);
  const [showSunriseIso, setShowSunriseIso] = useState(true);
  const [showSunsetIso, setShowSunsetIso] = useState(true);
  const [timeFormat, setTimeFormat] = useState<'local' | 'utc'>('local');
  const [isMapReady, setIsMapReady] = useState(false);
  const [saveName, setSaveName] = useState('');
  const iframeRef = useRef<any>(null);

  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '';

  // Premium UI tokens for Map WebView
  const mapBg = isDay ? '#E8EDF2' : '#08080C';
  const popupBg = isDay ? '#FFFFFF' : '#14141C';
  const popupText = isDay ? '#1A1A1A' : '#FFFFFF';
  const popupBorder = isDay ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)';
  const accentColor = isDay ? '#4F46E5' : '#FFD700'; // Indigo for Light, Gold for Dark

  const isAndroid = Platform.OS === 'android';

  // Android Material 3 Design styles override
  const m3Style = {
    modalContent: {
      backgroundColor: isDay ? '#F3F4F6' : '#121216',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 0,
    },
    section: {
      backgroundColor: isDay ? '#FFFFFF' : '#1E1F28',
      borderRadius: 16,
      borderWidth: 0,
      elevation: 2,
    },
    input: {
      backgroundColor: isDay ? '#E5E7EB' : '#2C2D35',
      borderRadius: 8,
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: theme.accent,
      height: 48,
    },
    button: {
      borderRadius: 100, // Capsule buttons for M3
      height: 48,
      elevation: 3,
    },
    savedItem: {
      backgroundColor: isDay ? '#FFFFFF' : '#1E1F28',
      borderRadius: 12,
      borderWidth: 0,
      elevation: 1,
    },
    tabBar: {
      borderBottomWidth: 0,
      marginHorizontal: 4,
    },
    activeTabItem: {
      borderBottomWidth: 0,
      backgroundColor: isDay ? 'rgba(79, 70, 229, 0.1)' : 'rgba(255, 215, 0, 0.12)',
      borderRadius: 20,
    },
    tabItemText: {
      paddingVertical: 4,
      paddingHorizontal: 8,
    }
  };

  // iOS Liquid Glass Design styles override
  const glassStyle = {
    modalContent: {
      backgroundColor: isDay ? 'rgba(255, 255, 255, 0.78)' : 'rgba(10, 10, 16, 0.78)',
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      borderWidth: 1,
      borderColor: isDay ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
    },
    section: {
      backgroundColor: isDay ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255,255,255,0.03)',
      borderRadius: 24,
      borderWidth: 1,
      borderColor: isDay ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
    },
    input: {
      backgroundColor: isDay ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255,255,255,0.05)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDay ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)',
      height: 44,
    },
    button: {
      borderRadius: 16, // SF-style rounded rectangle
      height: 52,
    },
    savedItem: {
      backgroundColor: isDay ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255,255,255,0.03)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: isDay ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
    },
    tabBar: {
      borderBottomWidth: 1,
      marginHorizontal: 0,
    },
    activeTabItem: {
      borderBottomWidth: 2,
      borderRadius: 0,
    },
    tabItemText: {
      paddingVertical: 0,
      paddingHorizontal: 0,
    }
  };

  const dStyle = isAndroid ? m3Style : glassStyle;


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
      ${googleMapsApiKey ? `
      <script src="https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}"></script>
      <script src="https://unpkg.com/leaflet.gridlayer.googlemutant@latest/dist/Leaflet.GoogleMutant.js"></script>
      ` : ''}
      <script src="https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
      <script src="https://cdn.jsdelivr.net/gh/dj0001/Leaflet.timezones@master/L.timezones.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js"></script>
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
        // Point-in-Polygon (PIP) & BBox cache helper for precise timezone boundaries
        const tzCache = {};
        let featuresWithBBox = [];

        function isPointInPolygon(point, vs) {
          const x = point[1]; // longitude
          const y = point[0]; // latitude
          let inside = false;
          for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i][0], yi = vs[i][1];
            const xj = vs[j][0], yj = vs[j][1];
            const intersect = ((yi > y) !== (yj > y))
              && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        }

        function isPointInMultiPolygon(point, coords) {
          for (let i = 0; i < coords.length; i++) {
            const poly = coords[i];
            if (Array.isArray(poly[0][0])) {
              for (let j = 0; j < poly.length; j++) {
                if (isPointInPolygon(point, poly[j])) return true;
              }
            } else {
              if (isPointInPolygon(point, poly)) return true;
            }
          }
          return false;
        }

        function prepareBBox() {
          if (featuresWithBBox.length > 0 || !L.timezones || !L.timezones.geojsonFeature) return;
          featuresWithBBox = L.timezones.geojsonFeature.features.map(f => {
            let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
            const processCoords = (coords) => {
              if (typeof coords[0] === 'number') {
                const lng = coords[0], lat = coords[1];
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
              } else {
                coords.forEach(processCoords);
              }
            };
            processCoords(f.geometry.coordinates);
            return {
              feature: f,
              bbox: [minLng, minLat, maxLng, maxLat],
              zone: parseFloat(f.properties.zone)
            };
          });
        }

        function getTimezoneOffsetFromGeoJSON(lat, lng) {
          const key = Math.round(lat * 2) + ',' + Math.round(lng * 2);
          if (tzCache[key] !== undefined) return tzCache[key];
          
          prepareBBox();
          if (featuresWithBBox.length === 0) {
            return Math.floor((lng + 7.5) / 15);
          }
          
          const point = [lat, lng];
          for (let i = 0; i < featuresWithBBox.length; i++) {
            const item = featuresWithBBox[i];
            const bbox = item.bbox;
            if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) {
              continue;
            }
            if (isPointInMultiPolygon(point, item.feature.geometry.coordinates)) {
              tzCache[key] = item.zone;
              return item.zone;
            }
          }
          
          const fallback = Math.floor((lng + 7.5) / 15);
          tzCache[key] = fallback;
          return fallback;
        }

        function getIsochroneInterval(zoom) {
          if (zoom >= 10) return 5;
          if (zoom >= 8) return 10;
          if (zoom >= 6) return 15;
          return 30;
        }

        function calculateIsochrones(dateStr, type, zoom, isUtc) {
          const baseDate = new Date(dateStr);
          const interval = getIsochroneInterval(zoom);
          const lines = {};
          
          const lats = [];
          for (let lat = -65; lat <= 65; lat += 3) {
            lats.push(lat);
          }
          
          const targets = [];
          for (let min = 0; min < 1440; min += interval) {
            targets.push(min);
            lines[min] = [];
          }
          
          if (!window.SunCalc) return [];
          const startOfDayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
          
          for (let i = 0; i < lats.length; i++) {
            const lat = lats[i];
            const sunTimes = window.SunCalc.getTimes(startOfDayDate, lat, 0);
            const eventDate = type === 'sunrise' ? sunTimes.sunrise : sunTimes.sunset;
            
            if (!eventDate || isNaN(eventDate.getTime())) {
              continue;
            }
            
            const eventUtcStartOfDay = Date.UTC(
              eventDate.getUTCFullYear(),
              eventDate.getUTCMonth(),
              eventDate.getUTCDate()
            );
            const eventUtcMinutes = (eventDate.getTime() - eventUtcStartOfDay) / 60000;
            
            for (let t = 0; t < targets.length; t++) {
              const targetMin = targets[t];
              
              if (isUtc) {
                let lng = (eventUtcMinutes - targetMin) / 4;
                lng = ((lng + 180) % 360 + 360) % 360 - 180;
                lines[targetMin].push([lat, lng]);
              } else {
                for (let h = -12; h <= 12; h++) {
                  const tzOffsetMinutes = -h * 60;
                  let lng = (eventUtcMinutes - tzOffsetMinutes - targetMin) / 4;
                  let normalizedLng = ((lng + 180) % 360 + 360) % 360 - 180;
                  
                  const actualH = getTimezoneOffsetFromGeoJSON(lat, normalizedLng);
                  if (actualH === h) {
                    lines[targetMin].push([lat, normalizedLng]);
                  }
                }
              }
            }
          }
          
          return targets.map(min => {
            const hh = String(Math.floor(min / 60)).padStart(2, '0');
            const mm = String(min % 60).padStart(2, '0');
            const points = lines[min].sort((a, b) => a[0] - b[0]);
            return {
              timeLabel: hh + ':' + mm,
              points: points
            };
          }).filter(line => line.points.length > 1);
        }

        const map = L.map('map', {
          zoomControl: false
        }).setView([${location?.coords?.latitude || 37.56}, ${location?.coords?.longitude || 126.97}], 10);
        
        const googleStyles = ${isDay ? '[]' : JSON.stringify([
          { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
          { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b687a' }] },
          { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#4b687a' }] },
          { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
          { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
          { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
          { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
          { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
          { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
          { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c4591' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
          { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e5d6c' }] }
        ])};

        if (typeof L.gridLayer.googleMutant === 'function') {
          L.gridLayer.googleMutant({
            type: 'roadmap',
            styles: googleStyles
          }).addTo(map);
        } else {
          const tileUrl = ${isDay ? "'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'" : "'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'"};
          L.tileLayer(tileUrl, {
            attribution: '© OpenStreetMap contributors © CARTO'
          }).addTo(map);
        }
        
        // Layer group to hold isochrone polylines and text labels dynamically
        const isochroneLayer = L.layerGroup().addTo(map);

        let isTimezoneLayerAdded = false;

        function updateTimezoneLayer(show) {
          if (!L.timezones) return;
          
          if (show) {
            if (!isTimezoneLayerAdded) {
              L.timezones.setStyle({
                fillColor: '#FFD700',
                fillOpacity: 0.04,
                color: '#FFB300',
                weight: 1.5,
                opacity: 0.6
              });
              
              L.timezones.bindPopup(function (layer) {
                const props = layer.feature.properties;
                return '<div style="color: #000; font-family: sans-serif; font-size: 11px; padding: 4px; line-height: 14px;">' +
                       '<strong style="font-size: 13px; color: #E65100;">' + props.time_zone + '</strong><br/>' +
                       '<span style="font-weight: bold; color: #333;">대표 지역:</span> ' + (props.tz_name1st || 'N/A') + '<br/>' +
                       '<span style="color: #666;">적용 국가:</span> ' + (props.places || 'N/A') +
                       '</div>';
              });
              
              L.timezones.addTo(map);
              isTimezoneLayerAdded = true;
            }
          } else {
            if (isTimezoneLayerAdded) {
              map.removeLayer(L.timezones);
              isTimezoneLayerAdded = false;
            }
          }
        }

        function redrawMapLayers() {
          redrawIsochrones();
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

        window.handleMessage = (event) => {
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
            const dateStr = data.date;
            const zoom = data.zoom;
            const timeFormat = data.timeFormat || 'local';
            
            if (showSunrise) {
              currentSunriseIso = calculateIsochrones(dateStr, 'sunrise', zoom, timeFormat === 'utc');
            } else {
              currentSunriseIso = [];
            }
            
            if (showSunset) {
              currentSunsetIso = calculateIsochrones(dateStr, 'sunset', zoom, timeFormat === 'utc');
            } else {
              currentSunsetIso = [];
            }
            
            updateTimezoneLayer(timeFormat === 'utc');
            redrawIsochrones();
          }
        };

        window.addEventListener('message', window.handleMessage);
        document.addEventListener('message', window.handleMessage);
      </script>
    </body>
    </html>
  `;

  // Synchronize state changes to WebView/iframe isochrone layers
  useEffect(() => {
    const sendIsochrones = () => {
      if (!isMapReady) return;

      const date = currentTime || new Date();
      
      const message = {
        type: 'UPDATE_ISOCHRONES',
        showSunrise: showSunriseIso,
        showSunset: showSunsetIso,
        date: date.toISOString(),
        zoom: mapZoom,
        timeFormat
      };
      
      if (iframeRef.current) {
        if (Platform.OS === 'web') {
          iframeRef.current.contentWindow?.postMessage(message, '*');
        } else {
          // Robust message injection avoiding RN WebView message drops
          const runJS = `
            if (typeof window.handleMessage === 'function') {
              window.handleMessage({ data: ${JSON.stringify(message)} });
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

  return (
    <Modal visible={visible} animationType="fade" transparent={true}>
      <View style={styles.modalOverlay}>
        <Animated.View style={[
          styles.modalContent, 
          dStyle.modalContent,
          { transform: [{ translateY: slideAnim }] }
        ]}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.text }]}>Change Location</Text>
              <Text style={[styles.subtitle, { color: theme.subText }]}>Pick on map or use saved spots</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={24} color={theme.text} />
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
                      } else if (data.type === 'PHOTO_PIN_CLICK') {
                        setLatInput(data.lat.toFixed(6));
                        setLonInput(data.lng.toFixed(6));
                        onSelect({ coords: { latitude: data.lat, longitude: data.lng } });
                        onClose();
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
            <View style={[styles.section, dStyle.section]}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>PICKED COORDINATES</Text>
                <TouchableOpacity onPress={handleCurrentLocation} style={styles.currentLocLink}>
                  <LocateFixed size={12} color={theme.accent} />
                  <Text style={[styles.currentLocLinkText, { color: theme.accent }]}>My Location</Text>
                </TouchableOpacity>
              </View>
              
              {/* 콤팩트 위치 입력 & 장소 저장 통합 폼 */}
              <View style={styles.compactSaveForm}>
                <View style={styles.compactInputsContainer}>
                  {/* 위도 & 경도 나란히 배치 */}
                  <View style={styles.compactInputRow}>
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border, flex: 1 }, dStyle.input]}
                      value={latInput}
                      onChangeText={setLatInput}
                      placeholder="Latitude"
                      placeholderTextColor={theme.subText}
                      keyboardType="numeric"
                    />
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border, flex: 1, marginLeft: 8 }, dStyle.input]}
                      value={lonInput}
                      onChangeText={setLonInput}
                      placeholder="Longitude"
                      placeholderTextColor={theme.subText}
                      keyboardType="numeric"
                    />
                  </View>
                  
                  {/* 장소 이름 입력 필드 */}
                  <TextInput
                    style={[styles.nameInput, { color: theme.text, borderColor: theme.border, marginTop: 8 }, dStyle.input]}
                    placeholder="Enter place name"
                    placeholderTextColor={theme.subText}
                    value={saveName}
                    onChangeText={setSaveName}
                  />
                </View>

                {/* 저장 버튼 (아이콘만 포함된 정사각형) */}
                <TouchableOpacity
                  style={[
                    styles.saveBtnCompact, 
                    { backgroundColor: theme.accent }, 
                    dStyle.button, 
                    { width: isAndroid ? 48 : 44, height: isAndroid ? 48 : 44 }
                  ]}
                  onPress={handleSaveLocation}
                >
                  <Save size={16} color="#000" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity 
              onPress={handleManualSelect}
              style={[styles.confirmBtn, { backgroundColor: '#000000', marginTop: 24, marginBottom: 24, borderColor: theme.border, borderWidth: Platform.OS === 'ios' ? 1 : 0 }, dStyle.button]}
            >
              <Navigation size={20} color="#FFFFFF" />
              <Text style={[styles.confirmBtnText, { color: '#FFFFFF' }]}>Select This Location</Text>
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
                    <View key={loc.id} style={[styles.savedItem, dStyle.savedItem]}>
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
            <View style={{ height: 40 }} />
          </ScrollView>
        </Animated.View>
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
  input: { height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.2)' },
  nameInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.2)' },
  compactSaveForm: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  compactInputsContainer: {
    flex: 1,
  },
  compactInputRow: {
    flexDirection: 'row',
  },
  saveBtnCompact: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
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
  photoDeleteBtn: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  
  filterContainer: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterChipText: { fontSize: 11, fontWeight: '700' },
  
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  previewContainer: { width: '100%', maxWidth: 360, borderRadius: 28, borderWidth: 1, padding: 24, gap: 16, alignItems: 'center' },
  previewTitle: { fontSize: 18, fontWeight: '800' },
  previewImage: { width: '100%', height: 220, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.2)' },
  previewLocation: { fontSize: 12, opacity: 0.8 },
  previewBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  previewBtn: { height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  previewBtnTextPrimary: { fontSize: 14, fontWeight: '800', color: '#000' },
  previewBtnTextSecondary: { fontSize: 14, fontWeight: '700' },
  uploadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 12 },
  uploadingText: { fontSize: 13, fontWeight: '700' }
});

