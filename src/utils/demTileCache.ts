import { Platform, Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { demTileUrl } from './demTiles';

/** 디스크 캐시 디렉토리 (영구 보관을 위해 documentDirectory 사용) */
const CACHE_DIR = Platform.OS !== 'web' && FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}dem_tiles/`
  : null;

let dirEnsured = false;
async function ensureCacheDir(): Promise<void> {
  if (!CACHE_DIR || dirEnsured) return;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
    dirEnsured = true;
  } catch (err) {
    if (__DEV__) console.warn('[DemCache] Failed to create cache directory:', err);
  }
}

/** 앱에 내장된 전 지구 베이스 타일 (줌 0, 약 103KB) */
export const BASE_DEM_ASSET = require('../../assets/dem/base_terrarium_z0.png');

/**
 * 타일 로컬 URI 획득 (로컬 캐시 확인 -> 없으면 백그라운드 다운로드 후 캐싱 -> 실패 시 베이스 타일 폴백)
 */
export async function getDemTileUri(z: number, x: number, y: number): Promise<string> {
  const remoteUrl = demTileUrl(z, x, y);

  // 웹(Web) 환경은 브라우저 캐시에 위임
  if (Platform.OS === 'web' || !CACHE_DIR) {
    return remoteUrl;
  }

  await ensureCacheDir();
  const filename = `${z}_${x}_${y}.png`;
  const localUri = `${CACHE_DIR}${filename}`;

  try {
    // 1. 이미 로컬에 캐시된 파일이 있는지 확인
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists && info.size && info.size > 0) {
      return localUri;
    }

    // 2. 없으면 네트워크에서 다운로드하여 영구 저장
    const result = await FileSystem.downloadAsync(remoteUrl, localUri);
    if (result.status === 200) {
      return localUri;
    }
  } catch (err) {
    if (__DEV__) {
      console.log(`[DemCache] Offline or tile fetch failed for ${z}/${x}/${y}, using fallback`);
    }
  }

  // 3. 오프라인 또는 다운로드 실패 시: 번들된 베이스 타일의 URI 추출
  try {
    const source = Image.resolveAssetSource(BASE_DEM_ASSET);
    if (source && source.uri) {
      return source.uri;
    }
  } catch (fallbackErr) {
    if (__DEV__) console.warn('[DemCache] Base tile fallback failed:', fallbackErr);
  }

  return remoteUrl;
}

/**
 * 캐시 통계 조회 (타일 수, 총 용량 MB)
 */
export async function getDemTileCacheStats(): Promise<{ count: number; sizeBytes: number; sizeMB: string }> {
  if (Platform.OS === 'web' || !CACHE_DIR) {
    return { count: 0, sizeBytes: 0, sizeMB: '0.00' };
  }

  await ensureCacheDir();
  try {
    const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
    let totalSize = 0;
    for (const f of files) {
      const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${f}`);
      if (info.exists && info.size) totalSize += info.size;
    }
    return {
      count: files.length,
      sizeBytes: totalSize,
      sizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    };
  } catch (err) {
    return { count: 0, sizeBytes: 0, sizeMB: '0.00' };
  }
}

/**
 * 디스크 캐시 전체 비우기
 */
export async function clearDemDiskCache(): Promise<void> {
  if (Platform.OS === 'web' || !CACHE_DIR) return;
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    dirEnsured = false;
    await ensureCacheDir();
  } catch (err) {
    if (__DEV__) console.warn('[DemCache] Failed to clear disk cache:', err);
  }
}
