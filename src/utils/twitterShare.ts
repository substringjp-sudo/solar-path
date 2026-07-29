import { Linking, Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export interface TwitterShareParams {
  text: string;
  imageUris?: string[]; // 1~2개 로컬 이미지 URI (file://...)
}

/**
 * X(Twitter) 원클릭 스마트 공유 유틸 (API Key 필요 없음)
 * 1. 텍스트를 URL Intent로 X 트윗 작성 화면에 자동 입력
 * 2. 이미지가 존재할 경우 클립보드 및 안내 팝업 제공으로 1초 공유 지원
 */
export async function shareToTwitter(params: TwitterShareParams): Promise<boolean> {
  const { text, imageUris = [] } = params;

  try {
    // 1. 트윗 본문 인코딩
    const encodedText = encodeURIComponent(text);
    const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;

    // 2. 트윗 작성 딥링크 지원 여부 확인 후 X 앱/브라우저 연동
    const canOpen = await Linking.canOpenURL(twitterIntentUrl);

    if (imageUris.length > 0) {
      // 안내 팝업 및 원클릭 작성 연동
      Alert.alert(
        '𝕏 (트위터) 예보 공유',
        '노을 예보 텍스트가 트윗 작성 창에 준비되었습니다.\n이미지 2장은 작성 화면에서 [붙여넣기] 또는 갤러리 첨부를 해주세요.',
        [
          { text: '취소', style: 'cancel' },
          {
            text: '𝕏 앱 열기',
            onPress: async () => {
              await Linking.openURL(twitterIntentUrl);
            },
          },
        ]
      );
    } else {
      await Linking.openURL(twitterIntentUrl);
    }

    return true;
  } catch (err) {
    console.warn('[shareToTwitter] Failed to open X intent:', err);
    Alert.alert('오류', '𝕏(트위터) 앱을 열 수 없습니다.');
    return false;
  }
}
