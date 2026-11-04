// 하네스(브라우저) 묶기용 react-native 대체. demTiles.ts → demTileCache.ts 가 top-level 에서 부릅니다.
// Platform.OS 가 'web' 이면 getDemTileUri 는 demTileUrl 을 그대로 돌려줍니다(앱의 웹 경로와 같음).
export const Platform = { OS: 'web' };
export const Image = { resolveAssetSource: () => null };
