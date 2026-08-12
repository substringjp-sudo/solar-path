import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { Image } from 'react-native';
import App from './App';
import { widgetTaskHandler } from './src/widgets/widgetTaskHandler';

// Image.getSize 인자 타입 예외 방어 래퍼 (HostFunction Expected argument 0 to be a string, got object 에러 방지)
if (Image && typeof Image.getSize === 'function') {
  const originalGetSize = Image.getSize;
  Image.getSize = function (uri, success, failure) {
    let safeUri = uri;
    if (uri && typeof uri === 'object' && typeof uri.uri === 'string') {
      safeUri = uri.uri;
    } else if (typeof uri !== 'string') {
      safeUri = String(uri || '');
    }
    return originalGetSize.call(Image, safeUri, success, failure);
  };
}

registerWidgetTaskHandler(widgetTaskHandler);
registerRootComponent(App);

