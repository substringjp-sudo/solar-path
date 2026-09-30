import { Linking, Alert, Share, Platform } from 'react-native';
import { L3 } from './i18n';
import { useCelestialStore } from '../store/useCelestialStore';

const lang = () => useCelestialStore.getState().language;

export type SnsPlatform = 'twitter' | 'instagram' | 'threads' | 'kakao' | 'facebook' | 'native';

export interface SnsShareParams {
  platform: SnsPlatform;
  text: string;
  imageUri?: string; // 로컬 또는 CDN 이미지 URI
  locationName?: string;
}

/**
 * Zero-API 기반 통합 SNS 공유 파이프라인
 */
export async function shareToSns(params: SnsShareParams): Promise<boolean> {
  const { platform, text, imageUri, locationName } = params;
  const encodedText = encodeURIComponent(text);

  try {
    switch (platform) {
      case 'twitter': {
        const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
        await Linking.openURL(twitterUrl);
        return true;
      }
      case 'threads': {
        const threadsUrl = `https://threads.net/intent/post?text=${encodedText}`;
        await Linking.openURL(threadsUrl);
        return true;
      }
      case 'facebook': {
        const fbUrl = `https://www.facebook.com/sharer/sharer.php?quote=${encodedText}`;
        await Linking.openURL(fbUrl);
        return true;
      }
      case 'instagram': {
        // 인스타그램 스토리 / 피드 파이프라인
        const instaUrl = 'instagram://app';
        const canOpenInsta = await Linking.canOpenURL(instaUrl);
        if (canOpenInsta) {
          await Linking.openURL(instaUrl);
        } else {
          Alert.alert(L3(lang(), '인스타그램 공유', 'Share to Instagram', 'Instagramで共有'), L3(lang(), '스마트폰에 인스타그램 앱이 설치되어 있어야 합니다.', 'The Instagram app needs to be installed.', 'Instagramアプリがインストールされている必要があります。'));
        }
        return true;
      }
      case 'kakao': {
        // 카카오톡 딥링크 파이프라인
        const kakaoUrl = `kakaolink://send?text=${encodedText}`;
        const canOpenKakao = await Linking.canOpenURL(kakaoUrl);
        if (canOpenKakao) {
          await Linking.openURL(kakaoUrl);
        } else {
          // 카카오톡 미설치 시 시스템 네이티브 공유로 폴백
          await Share.share({
            message: text,
            url: imageUri,
          });
        }
        return true;
      }
      case 'native':
      default: {
        await Share.share({
          message: text,
          url: imageUri,
        });
        return true;
      }
    }
  } catch (err) {
    console.warn('[shareToSns] Share failed for platform:', platform, err);
    Alert.alert(L3(lang(), '공유 실패', 'Could not share', '共有できませんでした'), L3(lang(), '선택한 SNS 앱을 열 수 없습니다.', 'The selected app could not be opened.', '選んだアプリを開けませんでした。'));
    return false;
  }
}
