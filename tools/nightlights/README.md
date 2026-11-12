# 밤 불빛 지도 (`assets/nightlights/lights_01deg.png`)

- 원본: NASA Black Marble 2016 (VIIRS 야간 합성), NASA GIBS WMS 층 `VIIRS_Black_Marble`. NASA 영상은 공개 자료(퍼블릭 도메인)입니다.
- 받은 방법: 0.05° 해상도로 네 조각(북서·북동·남서·남동, 각 3600×1800 PNG)을 받습니다.
  ```
  https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_Black_Marble&STYLES=&CRS=EPSG:4326&BBOX=<남,서,북,동>&WIDTH=3600&HEIGHT=1800&FORMAT=image/png
  ```
  파일 이름은 `q_<남>_<서>_<북>_<동>.png` (예: `q_0_-180_90_0.png`).
- 만들기: `python3 -I tools/nightlights/make.py <조각 폴더> assets/nightlights/lights_01deg.png`
  - 밝기 Y = 0.3R + 0.59G + 0.11B 에서 바탕(땅·바다 남회색, Y ≈ 15)을 빼고 표시 부호화를 풉니다: L = ((Y − 15)/240)^2.2.
  - 2×2 평균으로 0.1° 칸(3600×1800, 위도 90° → −90°, 경도 −180° → 180°).
  - 저장 값 v = 255·√(L / L_max). 앱은 L = (v/255)² 로 되돌립니다.
- 한계: 원본이 보기 좋게 눌러 놓은 그림이라 도심 한가운데는 포화(흰색)되어 있습니다. 상대 밝기로만 쓰고 절대 세기는 광공해 설정이 정합니다.
