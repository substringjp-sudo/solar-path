import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

const cache = new Map<string, string>();

/** 한국 주요 시/도 축약 매핑 */
const SHORT_REGION: Record<string, string> = {
  '서울특별시': '서울',
  '부산광역시': '부산',
  '대구광역시': '대구',
  '인천광역시': '인천',
  '광주광역시': '광주',
  '대전광역시': '대전',
  '울산광역시': '울산',
  '세종특별자치시': '세종',
  '제주특별자치도': '제주',
  '경기도': '경기',
  '강원특별자치도': '강원',
  '강원도': '강원',
  '충청북도': '충북',
  '충청남도': '충남',
  '전라북도': '전북',
  '전북특별자치도': '전북',
  '전라남도': '전남',
  '경상북도': '경북',
  '경상남도': '경남',
};

function formatAddress(addr: Location.LocationGeocodedAddress): string {
  const isKorea = addr.country === '대한민국' || addr.country === 'South Korea' || addr.isoCountryCode === 'KR';

  if (isKorea) {
    const rawRegion = addr.region || '';
    const region = SHORT_REGION[rawRegion] || rawRegion.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '');
    const city = (addr.city || addr.subregion || '').replace(/(시|군|구)$/, (m) => m === '구' ? '구' : '');
    const district = addr.district || '';

    // 서울 + 강남구 -> 서울 강남구
    if (region === '서울' && district) return `서울 ${district}`;
    // 경기 + 성남시 + 분당구 -> 성남 분당구
    if (city && district && district.endsWith('구')) return `${city} ${district}`;
    if (region && district) return `${region} ${district}`;
    if (city && district) return `${city} ${district}`;
    if (city) return city;
    if (district) return district;
    if (region) return region;
  }

  // 해외 (도시, 국가 코드 등)
  if (addr.city && addr.country) {
    return `${addr.city}`;
  }
  return addr.city || addr.district || addr.region || addr.country || '';
}

/**
 * 좌표(위도, 경도)를 친숙한 행정구역 이름으로 역지오코딩
 */
export async function getAdministrativeAreaName(lat: number, lon: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // 약 1km 격자 키
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) || null;
  }

  try {
    // 1. 네이티브 OS 지오코더 (iOS CoreLocation / Android Geocoder)
    if (Platform.OS !== 'web') {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (results && results.length > 0) {
        const name = formatAddress(results[0]);
        if (name) {
          cache.set(cacheKey, name);
          return name;
        }
      }
    } else {
      // 2. 웹(Web) 환경 무료 클라이언트 역지오코딩
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`);
      if (res.ok) {
        const data = await res.json();
        const city = data.city || data.locality || data.principalSubdivision;
        if (city) {
          cache.set(cacheKey, city);
          return city;
        }
      }
    }
  } catch (err) {
    if (__DEV__) console.log('[ReverseGeocode] Failed to reverse geocode:', err);
  }

  return null;
}

/**
 * 행정구역 이름 실시간 연동 React Hook
 */
export function useAdministrativeArea(lat?: number, lon?: number): string | null {
  const [areaName, setAreaName] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setAreaName(null);
      return;
    }
    let cancelled = false;
    getAdministrativeAreaName(lat, lon).then((name) => {
      if (!cancelled && name) setAreaName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  return areaName;
}
