import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Dimensions, SafeAreaView, StatusBar, ActivityIndicator } from 'react-native';
import Svg, { Circle, Path, G, Line, Text as SvgText, Defs, RadialGradient, Stop } from 'react-native-svg';
import * as Location from 'expo-location';
import { Sun, Moon, Navigation, Info } from 'lucide-react-native';
import { format } from 'date-fns';
import { getSunPosition, getMoonPosition, getSunPath, getMoonPath, CelestialPosition } from './utils/celestial';

const { width } = Dimensions.get('window');
const CANVAS_SIZE = width * 0.85;
const CENTER = CANVAS_SIZE / 2;
const RADIUS = CANVAS_SIZE * 0.4;

const polarToCartesian = (azimuth: number, altitude: number) => {
  // Map altitude (0 to 90) to radius (RADIUS to 0)
  // Higher altitude = closer to center
  const r = RADIUS * (1 - altitude / 90);
  const theta = (azimuth - 90) * (Math.PI / 180);
  return {
    x: CENTER + r * Math.cos(theta),
    y: CENTER + r * Math.sin(theta),
  };
};

export default function SolarTracker() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
    })();

    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (errorMsg) return <View style={styles.centered}><Text style={styles.errorText}>{errorMsg}</Text></View>;
  if (!location) return <View style={styles.centered}><ActivityIndicator size="large" color="#FFD700" /></View>;

  const { latitude, longitude } = location.coords;
  const sunPos = getSunPosition(currentTime, latitude, longitude);
  const moonPos = getMoonPosition(currentTime, latitude, longitude);
  const sunPath = getSunPath(currentTime, latitude, longitude);

  const sunCoords = polarToCartesian(sunPos.azimuth, sunPos.altitude);
  const moonCoords = polarToCartesian(moonPos.azimuth, moonPos.altitude);

  const renderPath = (path: any[], color: string) => {
    if (path.length < 2) return null;
    let d = "";
    path.forEach((p, i) => {
      // Only render points above horizon
      if (p.altitude >= 0) {
        const coords = polarToCartesian(p.azimuth, p.altitude);
        d += (i === 0 ? "M" : "L") + `${coords.x} ${coords.y}`;
      }
    });
    return <Path d={d} stroke={color} strokeWidth="1" fill="none" strokeDasharray="4 4" opacity={0.6} />;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <View style={styles.header}>
        <Text style={styles.title}>Solar Path</Text>
        <Text style={styles.subtitle}>{format(currentTime, 'PPPP')}</Text>
        <Text style={styles.subtitle}>{format(currentTime, 'pp')}</Text>
      </View>

      <View style={styles.canvasContainer}>
        <Svg width={CANVAS_SIZE} height={CANVAS_SIZE} viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}>
          <Defs>
            <RadialGradient id="skyGrad" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor="#1a2a6c" stopOpacity="0.3" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="1" />
            </RadialGradient>
          </Defs>

          {/* Background */}
          <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#skyGrad)" stroke="#333" strokeWidth="1" />
          
          {/* Compass Rings */}
          {[30, 60].map(r => (
            <Circle key={r} cx={CENTER} cy={CENTER} r={RADIUS * (1 - r/90)} stroke="#222" strokeWidth="0.5" fill="none" />
          ))}

          {/* Compass Labels */}
          {['N', 'E', 'S', 'W'].map((label, i) => {
            const angle = i * 90;
            const coords = polarToCartesian(angle, -10);
            return (
              <SvgText
                key={label}
                x={coords.x}
                y={coords.y}
                fill="#666"
                fontSize="12"
                fontWeight="bold"
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {label}
              </SvgText>
            );
          })}

          {/* Sun Path */}
          {renderPath(sunPath, "#FFD700")}

          {/* Celestial Bodies */}
          {sunPos.altitude > 0 && (
            <G x={sunCoords.x - 12} y={sunCoords.y - 12}>
              <Circle cx={12} cy={12} r={12} fill="#FFD700" opacity={0.2} />
              <Sun size={24} color="#FFD700" fill="#FFD700" />
            </G>
          )}

          {moonPos.altitude > 0 && (
            <G x={moonCoords.x - 10} y={moonCoords.y - 10}>
              <Circle cx={10} cy={10} r={10} fill="#E0E0E0" opacity={0.2} />
              <Moon size={20} color="#E0E0E0" fill="#E0E0E0" />
            </G>
          )}
        </Svg>
      </View>

      <View style={styles.infoGrid}>
        <View style={styles.infoCard}>
          <Sun size={20} color="#FFD700" />
          <Text style={styles.cardLabel}>Sun Altitude</Text>
          <Text style={styles.cardValue}>{sunPos.altitude.toFixed(1)}°</Text>
        </View>
        <View style={styles.infoCard}>
          <Moon size={20} color="#E0E0E0" />
          <Text style={styles.cardLabel}>Moon Altitude</Text>
          <Text style={styles.cardValue}>{moonPos.altitude.toFixed(1)}°</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.locationContainer}>
          <Navigation size={14} color="#666" />
          <Text style={styles.locationText}>{latitude.toFixed(4)}, {longitude.toFixed(4)}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 4,
  },
  canvasContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  infoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    marginTop: 20,
  },
  infoCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    width: width * 0.42,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
  },
  cardLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
  },
  cardValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    width: '100%',
    alignItems: 'center',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  locationText: {
    color: '#666',
    fontSize: 12,
    marginLeft: 6,
  },
  errorText: {
    color: '#ff4444',
    textAlign: 'center',
    padding: 20,
  },
});
