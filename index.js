import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { Image } from 'react-native';
import App from './App';
import { widgetTaskHandler } from './src/widgets/widgetTaskHandler';

// Hermes 엔진 대응: ES2017+ 표준과 달리 Hermes는 WeakMap.get/has(null/undefined) 등에
// "WeakMap key must be an Object" TypeError를 던집니다.
// three.js 등에서 depthTexture(null) 등을 캐시 조회할 때 크래시가 발생하는 문제를 방어합니다.
(function patchWeakCollectionsForHermes() {
  const isObject = (val) => val !== null && (typeof val === 'object' || typeof val === 'function');

  if (typeof WeakMap !== 'undefined' && WeakMap.prototype) {
    const origGet = WeakMap.prototype.get;
    const origHas = WeakMap.prototype.has;
    const origDelete = WeakMap.prototype.delete;
    const origSet = WeakMap.prototype.set;

    WeakMap.prototype.get = function (key) {
      if (!isObject(key)) return undefined;
      return origGet.call(this, key);
    };
    WeakMap.prototype.has = function (key) {
      if (!isObject(key)) return false;
      return origHas.call(this, key);
    };
    WeakMap.prototype.delete = function (key) {
      if (!isObject(key)) return false;
      return origDelete.call(this, key);
    };
    WeakMap.prototype.set = function (key, value) {
      if (!isObject(key)) return this;
      return origSet.call(this, key, value);
    };
  }

  if (typeof WeakSet !== 'undefined' && WeakSet.prototype) {
    const origWsHas = WeakSet.prototype.has;
    const origWsAdd = WeakSet.prototype.add;
    const origWsDelete = WeakSet.prototype.delete;

    WeakSet.prototype.has = function (value) {
      if (!isObject(value)) return false;
      return origWsHas.call(this, value);
    };
    WeakSet.prototype.delete = function (value) {
      if (!isObject(value)) return false;
      return origWsDelete.call(this, value);
    };
    WeakSet.prototype.add = function (value) {
      if (!isObject(value)) return this;
      return origWsAdd.call(this, value);
    };
  }
})();

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

