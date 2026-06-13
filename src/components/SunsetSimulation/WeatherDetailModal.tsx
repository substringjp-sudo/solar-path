import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView,
  Dimensions, Platform, FlatList, Animated, Linking
} from 'react-native';
import { X, Cloud, Compass, Globe, Info, ExternalLink } from 'lucide-react-native';
import Svg, { Path, Circle, Text as SvgText, G } from 'react-native-svg';
import { CloudPathData, CloudData } from '../../utils/weather';
import { formatLocalTime, getLocalTimeAtLocation } from '../../utils/timezone';
import { useCelestialStore } from '../../store/useCelestialStore';
import { CLOUD_TEMPLATES, CloudPresetName } from './Visualizer';
import { t, Language } from '../../utils/i18n';

interface CloudBookEntry {
  name: CloudPresetName;
  displayName: string;
  altitudeType: 'high' | 'mid' | 'low';
  altitudeRange: string;
  summary: string;
  origin: string;
  sunsetEffect: string;
  physics: {
    thickness: string;
    scattering: string;
    shadow: string;
  };
}

const CLOUD_BOOK_DATA_KO: CloudBookEntry[] = [
  {
    name: 'Cirrus',
    displayName: '권운 (새털구름)',
    altitudeType: 'high',
    altitudeRange: '6km 이상',
    summary: '빙결정으로 이루어진 희고 가는 실이나 깃털 모양의 구름입니다.',
    origin: '상층의 건조한 바람과 한랭한 기온 상태에서 수증기가 직접 빙결정으로 승화하여 생겨납니다.',
    sunsetEffect: '태양이 지평선 아래로 내려간 뒤에도 가장 오랫동안 햇빛을 받아 불타는 듯한 선홍빛 노을을 넓게 퍼뜨립니다.',
    physics: {
      thickness: '매우 얇음 (두께 4%)',
      scattering: '최상 (투과율 95%)',
      shadow: '거의 없음 (대비 5%)'
    }
  },
  {
    name: 'Cirrocumulus',
    displayName: '권적운 (비늘구름)',
    altitudeType: 'high',
    altitudeRange: '6km 이상',
    summary: '작은 조개껍데기나 물고기 비늘 모양의 흰 구름 조각들이 떼를 지어 덮은 구름입니다.',
    origin: '상층 대기 불안정으로 약한 대류 현상이 생겨 수증기가 국소적으로 뭉쳐 얼어붙으며 정렬됩니다.',
    sunsetEffect: '노을빛을 받아 미세하게 쪼개진 림 라이트와 다채로운 색조 변화가 하늘을 대단히 수려하게 장식합니다.',
    physics: {
      thickness: '얇음 (두께 16%)',
      scattering: '높음 (투과율 80%)',
      shadow: '약함 (대비 20%)'
    }
  },
  {
    name: 'Cirrostratus',
    displayName: '권층운 (햇무리구름)',
    altitudeType: 'high',
    altitudeRange: '6km 이상',
    summary: '온 하늘을 하얀 베일처럼 넓게 뒤덮어 햇무리나 달무리를 만드는 얇은 안개성 구름입니다.',
    origin: '온난전선 전면에서 넓은 대기 상층이 완만하게 상승하면서 얇고 평평한 얼음 입자 층이 만들어집니다.',
    sunsetEffect: '하늘 전체에 부드러운 붉은색 파스텔 톤 필터를 씌운 듯 넓게 퍼지는 은은한 그라데이션 노을을 선사합니다.',
    physics: {
      thickness: '매우 얇음 (두께 12%)',
      scattering: '매우 높음 (투과율 85%)',
      shadow: '거의 없음 (대비 15%)'
    }
  },
  {
    name: 'Altocumulus',
    displayName: '고적운 (양떼구름)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km',
    summary: '양 떼가 밭이랑에 모여 있는 것 같은 둥글둥글한 구름 뭉치들의 배열입니다.',
    origin: '중층 대기가 국소적으로 불안정해 대류 기류가 형성되며 수증기가 중형 크기 물방울로 응결됩니다.',
    sunsetEffect: '노을빛이 구름 덩어리 사이로 여과되어 웅장한 빛내림(Crepuscular rays)과 강렬한 외곽 불꽃 테두리를 연출합니다.',
    physics: {
      thickness: '보통 (두께 40%)',
      scattering: '보통 (투과율 70%)',
      shadow: '보통 (대비 40%)'
    }
  },
  {
    name: 'Altostratus',
    displayName: '고층운 (차일구름)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km',
    summary: '하늘 전체에 장막을 치듯 균일한 짙은 회청색을 드리우는 넓은 평면 구름입니다.',
    origin: '광범위한 중층 대기층이 서서히 대규모 상승하면서 대기 전반에 물방울과 얼음 알갱이가 응결되어 발달합니다.',
    sunsetEffect: '태양의 직접광을 강하게 가려 흐리게 만들며, 몽환적이고 다소 차분한 회보라색~어두운 적색 톤을 유도합니다.',
    physics: {
      thickness: '다소 두꺼움 (두께 55%)',
      scattering: '낮음 (투과율 60%)',
      shadow: '다소 짙음 (대비 50%)'
    }
  },
  {
    name: 'Nimbostratus',
    displayName: '난층운 (비구름)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km (하층까지 확장)',
    summary: '하늘 전체를 짙은 회색으로 덮어 지속적인 비나 눈을 내리게 하는 두껍고 어두운 구름입니다.',
    origin: '저기압이나 활성화된 전선 주위에서 매우 두터운 기류가 강력하게 장시간 강제 상승할 때 생성됩니다.',
    sunsetEffect: '대부분의 햇빛을 흡수 차단하여 노을의 붉은 광선이 거의 보이지 않고 하늘이 어두운 잿빛으로 탁해집니다.',
    physics: {
      thickness: '두꺼움 (두께 75%)',
      scattering: '매우 낮음 (투과율 30%)',
      shadow: '짙음 (대비 80%)'
    }
  },
  {
    name: 'Stratocumulus',
    displayName: '층적운 (물결뭉게구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하',
    summary: '낮게 깔린 크고 둥그스름한 덩어리들이 서로 밀집해 물결 모양 층을 이루는 구름입니다.',
    origin: '저고도의 바람과 기류의 복잡한 섭동이나 상승 기류 상단의 억제로 구름층이 수평으로 퍼져 발달합니다.',
    sunsetEffect: '구름 아랫부분에 깊은 회색 그림자가 지는 동시에, 갈라진 틈 사이로 주황색 노을빛이 강하게 대비되는 입체감을 만듭니다.',
    physics: {
      thickness: '두꺼움 (두께 80%)',
      scattering: '낮음 (투과율 40%)',
      shadow: '매우 짙음 (대비 82%)'
    }
  },
  {
    name: 'Stratus',
    displayName: '층운 (안개구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하',
    summary: '지표면 가까이에 안개처럼 아주 낮고 균일하게 형성된 얇은 판상의 구름층입니다.',
    origin: '밤 사이 지표면의 복사 냉각 혹은 온난다습한 공기가 차가운 대지나 해면과 접촉하여 서서히 식어 생겨납니다.',
    sunsetEffect: '지평선 주변을 뿌옇게 가로막으며 노을의 강렬한 노란빛이 대기 속에서 넓고 부드럽게 산란되도록 만듭니다.',
    physics: {
      thickness: '보통 (두께 30~65%)',
      scattering: '보통 (투과율 50~70%)',
      shadow: '보통 (대비 30~60%)'
    }
  },
  {
    name: 'Cumulus',
    displayName: '적운 (뭉게구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하',
    summary: '하늘 높이 탐스럽게 뭉게뭉게 피어오른 맑은 날의 대표적인 하얀 솜사탕 구름입니다.',
    origin: '태양열에 의해 불균일하게 가열된 지표면 공기가 상승 기류를 타고 오르며 물방울로 뭉쳐 자라납니다.',
    sunsetEffect: '둥글게 발달한 외곽을 따라 아주 눈부신 황금빛 림 라이트와 짙은 주황빛 음영 대비가 극도의 입체감을 완성합니다.',
    physics: {
      thickness: '두꺼움 (두께 70%)',
      scattering: '낮음 (투과율 45%)',
      shadow: '짙음 (대비 72%)'
    }
  },
  {
    name: 'Cumulonimbus',
    displayName: '적란운 (소나기구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하 (최대 12km 상공)',
    summary: '소나기와 뇌우를 동반하며 하늘 높이 탑이나 모루 형태로 거대하게 솟구친 먹구름 산입니다.',
    origin: '대기가 극도로 불안정하여 초강력 상승 기류가 응결된 물방울과 빙결정을 성층권 하부 경계선까지 수직으로 폭발시키듯 밀어올려 생성됩니다.',
    sunsetEffect: '태양빛을 철저히 막는 거대한 암흑 벽이 되지만, 가장 높은 구름 꼭대기 모루 끝자락은 찬란히 불타는 장관을 연출합니다.',
    physics: {
      thickness: '최대 (두께 100%)',
      scattering: '최저 (투과율 20%)',
      shadow: '최대 (대비 98%)'
    }
  }
];

const CLOUD_BOOK_DATA_EN: CloudBookEntry[] = [
  {
    name: 'Cirrus',
    displayName: 'Cirrus (Mares\' tails)',
    altitudeType: 'high',
    altitudeRange: 'Above 6km',
    summary: 'Thin, wispy strands of ice crystal clouds resembling feathers.',
    origin: 'Water vapor directly sublimates into ice crystals under dry wind and cold temperatures in high altitude.',
    sunsetEffect: 'Receives sunlight for the longest time even after the sun sinks below the horizon, spreading brilliant scarlet hues.',
    physics: {
      thickness: 'Very Thin (Thickness 4%)',
      scattering: 'Excellent (Transmittance 95%)',
      shadow: 'Almost None (Contrast 5%)'
    }
  },
  {
    name: 'Cirrocumulus',
    displayName: 'Cirrocumulus',
    altitudeType: 'high',
    altitudeRange: 'Above 6km',
    summary: 'Small, white patches of clouds that resemble ripples or scales.',
    origin: 'Weak convection due to atmospheric instability in high altitude causes water vapor to cluster and freeze.',
    sunsetEffect: 'Creates delicate glowing outlines and rich color transitions across the sky.',
    physics: {
      thickness: 'Thin (Thickness 16%)',
      scattering: 'High (Transmittance 80%)',
      shadow: 'Weak (Contrast 20%)'
    }
  },
  {
    name: 'Cirrostratus',
    displayName: 'Cirrostratus (Halo clouds)',
    altitudeType: 'high',
    altitudeRange: 'Above 6km',
    summary: 'Thin, whitish sheet-like veil of clouds covering the sky, producing halos around the sun or moon.',
    origin: 'A large, thin layer of ice crystals is formed as upper atmosphere rises gently in front of a warm front.',
    sunsetEffect: 'Produces a soft, pastel-toned gradient sunset across the entire sky.',
    physics: {
      thickness: 'Very Thin (Thickness 12%)',
      scattering: 'Very High (Transmittance 85%)',
      shadow: 'Almost None (Contrast 15%)'
    }
  },
  {
    name: 'Altocumulus',
    displayName: 'Altocumulus (Mackerel sky)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km',
    summary: 'Rolls or patches of puffy, medium-sized cloud elements arranged in layers.',
    origin: 'Local instability in mid-level atmosphere forms convective currents, condensing water vapor into water droplets.',
    sunsetEffect: 'Sunlight filters through clouds to create dramatic light beams (Crepuscular rays) and bright glowing edges.',
    physics: {
      thickness: 'Medium (Thickness 40%)',
      scattering: 'Medium (Transmittance 70%)',
      shadow: 'Medium (Contrast 40%)'
    }
  },
  {
    name: 'Altostratus',
    displayName: 'Altostratus',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km',
    summary: 'Grayish or bluish sheet or layer of flat, uniform clouds covering a wide area.',
    origin: 'Slow, widespread lifting of a large air mass in mid-level atmosphere condenses water droplets and ice particles.',
    sunsetEffect: 'Blocks direct sunlight, leading to deep, dreamy grey-violet or dark red sunsets.',
    physics: {
      thickness: 'Slightly Thick (Thickness 55%)',
      scattering: 'Low (Transmittance 60%)',
      shadow: 'Moderate (Contrast 50%)'
    }
  },
  {
    name: 'Nimbostratus',
    displayName: 'Nimbostratus (Rain clouds)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km (extends lower)',
    summary: 'Thick, dark grey cloud layer that covers the sky and produces continuous rain or snow.',
    origin: 'Strong, long-lasting forced ascent of thick air masses near low-pressure systems or fronts.',
    sunsetEffect: 'Absorbs most light, making sunsets dull and rendering the sky dark grey.',
    physics: {
      thickness: 'Thick (Thickness 75%)',
      scattering: 'Very Low (Transmittance 30%)',
      shadow: 'Dark (Contrast 80%)'
    }
  },
  {
    name: 'Stratocumulus',
    displayName: 'Stratocumulus',
    altitudeType: 'low',
    altitudeRange: 'Below 2km',
    summary: 'Low, lumpy grey cloud layers that form ripples or waves with occasional breaks.',
    origin: 'Turbulence in lower boundary layer or capping inversions spread clouds horizontally.',
    sunsetEffect: 'Creates deep grey shadows under cloud bases with brilliant orange hues breaking through the gaps.',
    physics: {
      thickness: 'Thick (Thickness 80%)',
      scattering: 'Low (Transmittance 40%)',
      shadow: 'Very Dark (Contrast 82%)'
    }
  },
  {
    name: 'Stratus',
    displayName: 'Stratus (Fog-like clouds)',
    altitudeType: 'low',
    altitudeRange: 'Below 2km',
    summary: 'A low, featureless, uniform grayish layer of clouds that resembles fog.',
    origin: 'Radiational cooling of the ground overnight or warm moist air flowing over cold surface.',
    sunsetEffect: 'Shrouds the horizon, scattering yellow sunset glow into a soft, diffused blanket.',
    physics: {
      thickness: 'Medium (Thickness 30~65%)',
      scattering: 'Medium (Transmittance 50~70%)',
      shadow: 'Medium (Contrast 30~60%)'
    }
  },
  {
    name: 'Cumulus',
    displayName: 'Cumulus (Fair-weather clouds)',
    altitudeType: 'low',
    altitudeRange: 'Below 2km',
    summary: 'Fluffy, cotton-like clouds with distinct outlines and flat bases.',
    origin: 'Localized thermals rising from solar-heated ground condense into water droplets.',
    sunsetEffect: 'Creates brilliant golden linings and sharp orange shading contrasts around puffy cloud edges.',
    physics: {
      thickness: 'Thick (Thickness 70%)',
      scattering: 'Low (Transmittance 45%)',
      shadow: 'Dark (Contrast 72%)'
    }
  },
  {
    name: 'Cumulonimbus',
    displayName: 'Cumulonimbus (Thunderheads)',
    altitudeType: 'low',
    altitudeRange: 'Below 2km (extends to 12km)',
    summary: 'Massive, towering clouds associated with thunderstorms and heavy rain.',
    origin: 'Extremely unstable atmosphere forces strong updrafts, pushing clouds vertically to the tropopause.',
    sunsetEffect: 'Acts as a dark wall blocking most light, but the anvil tops high up glow with intense fire-like colors.',
    physics: {
      thickness: 'Maximum (Thickness 100%)',
      scattering: 'Lowest (Transmittance 20%)',
      shadow: 'Maximum (Contrast 98%)'
    }
  }
];

const RadarGridInfoGraphic = ({ theme }: { theme: any }) => {
  const { language } = useCelestialStore();
  return (
    <View style={[styles.artCard, { backgroundColor: 'rgba(5, 5, 10, 0.45)', borderColor: theme.border }]}>
      <Svg width="180" height="110" viewBox="0 0 180 110">
        {/* 부채꼴 빔 영역 배경 */}
        <Path d="M 90,102 L 35,12 A 78,78 0 0,1 145,12 Z" fill="rgba(255, 255, 255, 0.015)" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="1" />
        
        {/* 거리 동심원 반경 보조선 */}
        <Path d="M 77,88.5 A 15,15 0 0,1 103,88.5" fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.8" strokeDasharray="2,2" />
        <Path d="M 60,71 A 38,38 0 0,1 120,71" fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.8" strokeDasharray="2,2" />
        <Path d="M 45,52 A 58,58 0 0,1 135,52" fill="none" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.8" strokeDasharray="2,2" />
        
        {/* 각도 축선 (-10도, 0도, +10도) */}
        <Path d="M 90,102 L 90,8" fill="none" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="0.8" strokeDasharray="1,2" />
        <Path d="M 90,102 L 62,17" fill="none" stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.6" strokeDasharray="1,2" />
        <Path d="M 90,102 L 118,17" fill="none" stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.6" strokeDasharray="1,2" />
        
        {/* 거리 텍스트 라벨 */}
        <SvgText x="92" y="90" fontSize="6" fill="rgba(255,255,255,0.4)" fontWeight="bold">10km</SvgText>
        <SvgText x="92" y="73" fontSize="6" fill="rgba(255,255,255,0.4)" fontWeight="bold">130km</SvgText>
        <SvgText x="92" y="54" fontSize="6" fill="rgba(255,255,255,0.4)" fontWeight="bold">280km</SvgText>
        <SvgText x="92" y="16" fontSize="6" fill="rgba(255,255,255,0.4)" fontWeight="bold">380km</SvgText>
        
        {/* 각도 텍스트 라벨 */}
        <SvgText x="20" y="12" fontSize="6" fill="rgba(255,255,255,0.45)">-20{'\u00B0'}</SvgText>
        <SvgText x="87" y="6" fontSize="6" fill="rgba(255,255,255,0.45)">0{'\u00B0'}</SvgText>
        <SvgText x="148" y="12" fontSize="6" fill="rgba(255,255,255,0.45)">+20{'\u00B0'}</SvgText>
        
        {/* 고층운 (핑크 도트) */}
        <Circle cx="55" cy="32" r="2.2" fill="#FF69B4" />
        <Circle cx="125" cy="32" r="2.2" fill="#FF69B4" />
        {/* 중층운 (보라 도트) */}
        <Circle cx="70" cy="56" r="2.2" fill="#9370DB" />
        <Circle cx="110" cy="56" r="2.2" fill="#9370DB" />
        {/* 저층운 (블루 도트) */}
        <Circle cx="81" cy="80" r="2.2" fill="#4682B4" />
        <Circle cx="99" cy="80" r="2.2" fill="#4682B4" />
        
        {/* Observer 위치 (관측자) */}
        <Circle cx="90" cy="102" r="4.5" fill="#FF8C00" />
        <SvgText x="98" y="104" fontSize="7" fill="#FF8C00" fontWeight="bold">{language === 'ko' ? '관측자' : 'Observer'}</SvgText>
      </Svg>
    </View>
  );
};

const RayleighInfoGraphic = ({ theme }: { theme: any }) => {
  const { language } = useCelestialStore();
  return (
    <View style={[styles.artCard, { backgroundColor: 'rgba(5, 5, 10, 0.45)', borderColor: theme.border }]}>
      <Svg width="260" height="110" viewBox="0 0 260 110">
        {/* 지구 표면 (두껍고 어두운 둥근 선) */}
        <Path d="M -20,135 A 140,140 0 0,1 280,135" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
        
        {/* 반투명 대기 대역 */}
        <Path d="M -20,115 A 140,140 0 0,1 280,115" fill="none" stroke="rgba(70, 130, 180, 0.15)" strokeWidth="20" />
        
        {/* 대기 공기 분자 */}
        <Circle cx="70" cy="95" r="1" fill="rgba(255,255,255,0.5)" />
        <Circle cx="120" cy="86" r="1.2" fill="rgba(255,255,255,0.5)" />
        <Circle cx="170" cy="90" r="1" fill="rgba(255,255,255,0.5)" />
        <Circle cx="95" cy="82" r="1" fill="rgba(255,255,255,0.5)" />
        <Circle cx="145" cy="84" r="1" fill="rgba(255,255,255,0.5)" />
        
        {/* 1. 낮 시간대 (짧은 대기 통과) */}
        <G>
          {/* 낮 태양 */}
          <Circle cx="70" cy="30" r="7" fill="#FFD700" />
          <SvgText x="56" y="16" fontSize="6.5" fill="#FFD700" fontWeight="bold">{t('dayAltVertical', language)}</SvgText>
          
          {/* 수직 대기 통과 광선 */}
          <Path d="M 70,39 L 70,82" fill="none" stroke="#1E90FF" strokeWidth="1.5" />
          {/* 짧은 파장 파란빛 산란 묘사 */}
          <Path d="M 70,55 L 56,62" fill="none" stroke="#1E90FF" strokeWidth="1" />
          <Path d="M 70,55 L 84,62" fill="none" stroke="#1E90FF" strokeWidth="1" />
          <Path d="M 70,68 L 60,78" fill="none" stroke="#1E90FF" strokeWidth="0.8" />
          <Path d="M 70,68 L 80,78" fill="none" stroke="#1E90FF" strokeWidth="0.8" />
          
          <SvgText x="86" y="58" fontSize="5.5" fill="#1E90FF">{t('rayleighScatterBlue', language)}</SvgText>
        </G>
        
        {/* 2. 저녁 노을 시간대 (비스듬히 긴 대기 경로 통과) */}
        <G>
          {/* 지평선 부근 붉은 태양 */}
          <Circle cx="230" cy="84" r="6" fill="#FF4500" />
          <SvgText x="205" y="70" fontSize="6.5" fill="#FF4500" fontWeight="bold">{t('sunsetAltDeep', language)}</SvgText>
          
          {/* 긴 광선 경로 */}
          <Path d="M 222,85 L 120,102" fill="none" stroke="#FF4500" strokeWidth="1.8" />
          
          {/* 중간 경로에서 파란빛은 모두 산란되어 소멸하는 모습 */}
          <Path d="M 210,87 L 216,95" fill="none" stroke="rgba(30,144,255,0.7)" strokeWidth="0.8" />
          <Path d="M 190,90 L 198,99" fill="none" stroke="rgba(30,144,255,0.4)" strokeWidth="0.8" />
          <Path d="M 170,93 L 178,102" fill="none" stroke="rgba(30,144,255,0.15)" strokeWidth="0.8" />
          
          {/* 관측자 위치 (지구 표면) */}
          <Circle cx="120" cy="102" r="2.2" fill="#FF8C00" />
          <SvgText x="106" y="112" fontSize="6" fill="#FF8C00" fontWeight="bold">{t('observerText', language)}</SvgText>
          <SvgText x="130" y="99" fontSize="5.5" fill="#FF4500">{t('rayleighOnlyRed', language)}</SvgText>
        </G>
      </Svg>
    </View>
  );
};

const MieInfoGraphic = ({ theme }: { theme: any }) => {
  const { language } = useCelestialStore();
  return (
    <View style={[styles.artCard, { backgroundColor: 'rgba(5, 5, 10, 0.45)', borderColor: theme.border }]}>
      <Svg width="260" height="110" viewBox="0 0 260 110">
        {/* 대형 먼지/수증기 입자 (중앙에 배치) */}
        <Circle cx="110" cy="55" r="16" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <Circle cx="106" cy="51" r="14" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2" />
        <Circle cx="110" cy="55" r="7" fill="rgba(255, 255, 255, 0.08)" />
        <SvgText x="92" y="24" fontSize="6.5" fill="#FFF" fontWeight="bold">{t('mieAerosolParticle', language)}</SvgText>
        
        {/* 입사 태양 광선 (왼쪽에서 입사) */}
        <Path d="M 30,42 L 92,42" fill="none" stroke="#FFA500" strokeWidth="1.5" />
        <Path d="M 25,55 L 94,55" fill="none" stroke="#FFA500" strokeWidth="1.5" />
        <Path d="M 30,68 L 92,68" fill="none" stroke="#FFA500" strokeWidth="1.5" />
        
        <SvgText x="28" y="32" fontSize="6.5" fill="#FFA500" fontWeight="bold">{t('mieSunlightEntry', language)}</SvgText>
        
        {/* 미에 산란 (전방 좁은 원뿔 형태로 강하게 집중 산란하는 모습 묘사) */}
        <Path d="M 126,55 L 190,20 A 48,48 0 0,1 190,90 Z" fill="rgba(255, 222, 173, 0.12)" stroke="rgba(255, 222, 173, 0.3)" strokeWidth="0.8" />
        
        <Path d="M 126,55 L 180,32" fill="none" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="1" />
        <Path d="M 126,55 L 195,55" fill="none" stroke="rgba(255, 255, 255, 0.85)" strokeWidth="1.5" />
        <Path d="M 126,55 L 180,78" fill="none" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="1" />
        
        {/* 입자 외곽 발광 테두리 강조 (Mie 림 라이트 묘사) */}
        <Path d="M 110,39 A 16,16 0 0,1 126,55 A 16,16 0 0,1 110,71" fill="none" stroke="#FFF" strokeWidth="2.5" opacity="0.9" />
        
        <SvgText x="156" y="93" fontSize="6.5" fill="#FFF">{t('mieForwardScatter', language)}</SvgText>
        <SvgText x="156" y="101" fontSize="5.5" fill="#FFF" opacity="0.6">{t('mieRimLightDesc', language)}</SvgText>
      </Svg>
    </View>
  );
};

interface WeatherDetailModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  pathData: CloudPathData[];
  interpolatedWeather: CloudData[];
  currentTime: Date;
  weatherSource: 'standard' | 'ultra-short' | 'cache' | 'fallback';
}

export const WeatherDetailModal: React.FC<WeatherDetailModalProps> = ({
  visible, onClose, theme, pathData, interpolatedWeather, currentTime, weatherSource
}) => {
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

  const { width: W, height: H } = Dimensions.get('window');
  const { timezoneOffsetHours, language } = useCelestialStore();
  const [activeTab, setActiveTab] = useState<'grid' | 'list'>('grid');
  const [activeAltitude, setActiveAltitude] = useState<'all' | 'low' | 'mid' | 'high'>('all');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [guideSubTab, setGuideSubTab] = useState<'basic' | 'encyclopedia' | 'portal'>('basic');
  const [expandedCloud, setExpandedCloud] = useState<string | null>(null);

  const angles = [-20, -10, 0, 10, 20];
  const distances = [380, 280, 200, 130, 70, 30, 10]; // Top to bottom (Far to Near)

  // 1. 5x7 그리드 매트릭스 변환
  const gridMatrix = useMemo(() => {
    if (!interpolatedWeather || interpolatedWeather.length < 36) return [];
    
    // interpolatedWeather의 첫 번째는 observer(0km)
    // 그 다음은 5개 각도 * 7개 거리 순
    const matrix: any[][] = [];
    
    distances.forEach((dist) => {
      const row: any[] = [];
      angles.forEach((ang) => {
        // angleIndex: 0~4, distanceIndex: 0~6
        const angleIdx = angles.indexOf(ang);
        const distIdx = [10, 30, 70, 130, 200, 280, 380].indexOf(dist);
        
        // 1 + angleIdx * 7 + distIdx
        const dataIdx = 1 + angleIdx * 7 + distIdx;
        const cellData = interpolatedWeather[dataIdx];
        row.push(cellData || { distance: dist, azimuthOffset: ang, low: 0, mid: 0, high: 0 });
      });
      matrix.push(row);
    });
    
    return matrix;
  }, [interpolatedWeather]);

  const observerPoint = useMemo(() => {
    return interpolatedWeather?.[0] || { low: 0, mid: 0, high: 0, visibility: 10000, humidity: 50 };
  }, [interpolatedWeather]);

  // 구름 농도에 따른 혼합 컬러 계산 (RGB)
  const getBlendColor = (low: number, mid: number, high: number) => {
    const sum = low + mid + high;
    if (sum === 0) return 'rgba(255, 255, 255, 0.05)';
    
    // 고층운(핑크), 중층운(보라), 저층운(블루) 가중치 혼합
    const r = Math.round((high * 255 + mid * 147 + low * 70) / sum);
    const g = Math.round((high * 105 + mid * 112 + low * 130) / sum);
    const b = Math.round((high * 180 + mid * 219 + low * 180) / sum);
    
    const maxVal = Math.max(low, mid, high);
    const opacity = 0.15 + (maxVal / 100) * 0.75; // 구름량에 따른 투명도 조절
    
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const getAltitudeColor = (val: number, type: 'low' | 'mid' | 'high') => {
    if (val === 0) return 'rgba(255, 255, 255, 0.05)';
    let r = 70, g = 130, b = 180; // low
    if (type === 'mid') {
      r = 147; g = 112; b = 219;
    } else if (type === 'high') {
      r = 255; g = 105; b = 180;
    }
    const opacity = 0.15 + (val / 100) * 0.75;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const getSourceModelName = () => {
    if (weatherSource === 'ultra-short') {
      return language === 'ko' ? 'KMA LDAPS / HRRR (정밀 국지 초단기 모델)' : 'KMA LDAPS / HRRR (Ultra-short local model)';
    }
    if (weatherSource === 'fallback') {
      return language === 'ko' ? '임시 로컬 데이터 (기상 서버 연결 실패)' : 'Temporary Local Data (Failed to connect to weather server)';
    }
    if (weatherSource === 'cache') {
      return language === 'ko' ? '로컬 캐시 데이터 (오프라인/에러 복구)' : 'Local Cache Data (Offline/Error recovery)';
    }
    return language === 'ko' ? 'GFS / ECMWF Global Ensemble (표준 글로벌 모델)' : 'GFS / ECMWF Global Ensemble (Standard global model)';
  };

  const formattedTime = useMemo(() => {
    const localTime = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    return formatLocalTime(localTime, 'yyyy-MM-dd HH:mm');
  }, [currentTime, timezoneOffsetHours]);

  return (
    <>
      <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
        <Animated.View style={[
          styles.modalContent, 
          { 
            backgroundColor: theme.card, 
            borderColor: theme.border,
            transform: [{ translateY: slideAnim }]
          }
        ]}>
          
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerTitleRow}>
              <Globe size={18} color={theme.accent} style={{ marginRight: 6 }} />
              <Text style={[styles.headerTitle, { color: theme.text }]}>기상 정밀 레이더 분석</Text>
              <TouchableOpacity 
                style={{
                  marginLeft: 8,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: '#FFD700',
                  justifyContent: 'center',
                  alignItems: 'center',
                }} 
                onPress={() => setShowInfoModal(true)}
                activeOpacity={0.7}
              >
                <Info size={12} color="#000000" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: theme.border }]} onPress={onClose}>
              <X size={16} color={theme.text} />
            </TouchableOpacity>
          </View>

          {/* Subtitle & Source Info */}
          <View style={styles.sourceMetaCard}>
            <Text style={[styles.metaText, { color: theme.subText }]}>
              {t('obsTime', language)}: <Text style={{ color: theme.text, fontWeight: '700' }}>{formattedTime}</Text>
            </Text>
            <Text style={[styles.metaText, { color: theme.subText, marginTop: 2 }]}>
              {t('forecastModel', language)}: <Text style={{ color: theme.accent, fontWeight: '700' }}>{getSourceModelName()}</Text>
            </Text>
          </View>

          {/* Tab Selector */}
          <View style={[styles.tabContainer, { backgroundColor: theme.border }]}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'grid' && [styles.activeTabButton, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('grid')}
            >
              <Compass size={14} color={activeTab === 'grid' ? theme.accent : theme.subText} style={{ marginRight: 6 }} />
              <Text style={[styles.tabText, { color: activeTab === 'grid' ? theme.text : theme.subText }]}>{t('radarTabGrid', language)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'list' && [styles.activeTabButton, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('list')}
            >
              <Cloud size={14} color={activeTab === 'list' ? theme.accent : theme.subText} style={{ marginRight: 6 }} />
              <Text style={[styles.tabText, { color: activeTab === 'list' ? theme.text : theme.subText }]}>{t('radarTabList', language)}</Text>
            </TouchableOpacity>
          </View>

          {/* Content Body */}
          {activeTab === 'grid' ? (
            <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
              
              {/* Radar Grid Map Visualization */}
              <View style={styles.radarCard}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('radarGridTitle', language)}</Text>
                <Text style={[styles.sectionDesc, { color: theme.subText }]}>
                  {t('radarGridDesc', language)}
                </Text>

                {/* Altitude Filter Tabs */}
                <View style={[styles.altitudeTabContainer, { borderColor: theme.border }]}>
                  {(['all', 'low', 'mid', 'high'] as const).map((alt) => {
                    const label = alt === 'all' ? t('radarFilterAll', language) : alt === 'low' ? t('radarFilterLow', language) : alt === 'mid' ? t('radarFilterMid', language) : t('radarFilterHigh', language);
                    const activeColor = alt === 'low' ? '#4682B4' : alt === 'mid' ? '#9370DB' : alt === 'high' ? '#FF69B4' : theme.accent;
                    const isActive = activeAltitude === alt;
                    return (
                      <TouchableOpacity
                        key={alt}
                        style={[
                          styles.altitudeTabButton,
                          isActive && [styles.activeAltitudeTabButton, { borderBottomColor: activeColor }]
                        ]}
                        onPress={() => setActiveAltitude(alt)}
                      >
                        <Text style={[
                          styles.altitudeTabText,
                          { color: isActive ? theme.text : theme.subText, fontWeight: isActive ? '800' : '500' }
                        ]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 5x7 Heatmap Grid */}
                <View style={styles.gridOuterContainer}>
                   {/* Y-axis Labels (Distance) */}
                   <View style={styles.yAxisLabels}>
                     {distances.map((dist) => (
                       <Text key={dist} style={[styles.yLabel, { color: theme.subText }]}>{dist}k</Text>
                     ))}
                   </View>

                  <View style={styles.gridInnerContainer}>
                    {/* Matrix Grid */}
                    <View style={styles.gridTable}>
                      {gridMatrix.map((row, rIdx) => (
                        <View key={rIdx} style={styles.gridRow}>
                          {row.map((cell, cIdx) => {
                            if (activeAltitude === 'all') {
                              return (
                                <View
                                  key={cIdx}
                                  style={[styles.gridCell, { borderColor: theme.border, height: 32, overflow: 'hidden' }]}
                                >
                                  <View style={styles.splitCellContainer}>
                                    <View style={[styles.splitCellSegment, { backgroundColor: getAltitudeColor(cell.high, 'high') }]} />
                                    <View style={[styles.splitCellSegment, { backgroundColor: getAltitudeColor(cell.mid, 'mid'), borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' }]} />
                                    <View style={[styles.splitCellSegment, { backgroundColor: getAltitudeColor(cell.low, 'low') }]} />
                                  </View>
                                </View>
                              );
                            } else {
                              const cellVal = cell[activeAltitude];
                              const cellColor = getAltitudeColor(cellVal, activeAltitude);
                              return (
                                <View
                                  key={cIdx}
                                  style={[styles.gridCell, { backgroundColor: cellColor, borderColor: theme.border, height: 32, justifyContent: 'center', alignItems: 'center' }]}
                                >
                                  <Text style={styles.cellPercentageText}>
                                    {Math.round(cellVal)}%
                                  </Text>
                                </View>
                              );
                            }
                          })}
                        </View>
                      ))}
                    </View>

                    {/* X-axis Labels (Azimuth Offset) */}
                    <View style={styles.xAxisLabels}>
                      {angles.map((ang) => (
                        <Text key={ang} style={[styles.xLabel, { color: theme.subText }]}>
                          {ang > 0 ? `+${ang}°` : `${ang}°`}
                        </Text>
                      ))}
                    </View>
                  </View>
                </View>

                {/* Observer Dot Indicator */}
                <View style={[styles.observerIndicator, { borderTopColor: theme.border }]}>
                  <View style={[styles.observerDot, { backgroundColor: theme.accent }]} />
                  <Text style={[styles.observerLabelText, { color: theme.text }]}>
                    {t('observerCenter', language)}:
                    <Text style={{ fontWeight: '800' }}>
                      {' '}{language === 'ko' ? '저' : 'L'} {Math.round(observerPoint.low)}% | {language === 'ko' ? '중' : 'M'} {Math.round(observerPoint.mid)}% | {language === 'ko' ? '고' : 'H'} {Math.round(observerPoint.high)}%
                    </Text>
                  </Text>
                </View>
              </View>

              {/* Legends Section */}
              <View style={[styles.legendCard, { backgroundColor: theme.border }]}>
                <View style={styles.legendHeader}>
                  <Info size={13} color={theme.text} style={{ marginRight: 6 }} />
                  <Text style={[styles.legendTitle, { color: theme.text }]}>{t('legendTitle', language)}</Text>
                </View>
                
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendColorBox, { backgroundColor: 'rgba(70, 130, 180, 0.8)' }]} />
                    <View style={styles.legendTextCol}>
                      <Text style={[styles.legendName, { color: theme.text }]}>{t('legendLowTitle', language)}</Text>
                      <Text style={[styles.legendDesc, { color: theme.subText }]}>{t('legendLowDesc', language)}</Text>
                    </View>
                  </View>

                  <View style={styles.legendItem}>
                    <View style={[styles.legendColorBox, { backgroundColor: 'rgba(147, 112, 219, 0.8)' }]} />
                    <View style={styles.legendTextCol}>
                      <Text style={[styles.legendName, { color: theme.text }]}>{t('legendMidTitle', language)}</Text>
                      <Text style={[styles.legendDesc, { color: theme.subText }]}>{t('legendMidDesc', language)}</Text>
                    </View>
                  </View>

                  <View style={styles.legendItem}>
                    <View style={[styles.legendColorBox, { backgroundColor: 'rgba(255, 105, 180, 0.8)' }]} />
                    <View style={styles.legendTextCol}>
                      <Text style={[styles.legendName, { color: theme.text }]}>{t('legendHighTitle', language)}</Text>
                      <Text style={[styles.legendDesc, { color: theme.subText }]}>{t('legendHighDesc', language)}</Text>
                    </View>
                  </View>
                </View>
              </View>

            </ScrollView>
          ) : (
            // Raw list details for all 36 points
            <FlatList
              data={interpolatedWeather}
              keyExtractor={(item, index) => `${index}-${item.distance}-${item.azimuthOffset}`}
              style={styles.scrollBody}
              contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 16 }}
              renderItem={({ item, index }) => {
                const total = Math.round((item.low + item.mid + item.high) / 3);
                return (
                  <View style={[styles.listItem, { borderBottomColor: theme.border }]}>
                    <View style={styles.listItemLeft}>
                      <Text style={[styles.listIndex, { color: theme.subText }]}>#{index}</Text>
                      <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.listTitle, { color: theme.text }]}>
                          {item.distance === 0 ? t('observerPointText', language) : `${item.distance}${t('distPoint', language)}`}
                        </Text>
                        {item.distance > 0 && (
                          <Text style={[styles.listSub, { color: theme.subText }]}>
                            {t('directionOffset', language)}: {item.azimuthOffset > 0 ? `+${item.azimuthOffset}°` : `${item.azimuthOffset}°`}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.listItemRight}>
                      <View style={styles.cloudBadgeRow}>
                        <View style={[styles.cloudMiniBadge, { backgroundColor: 'rgba(70,130,180,0.15)' }]}>
                          <Text style={[styles.cloudMiniText, { color: '#4682B4' }]}>{language === 'ko' ? '저' : 'L'} {Math.round(item.low)}%</Text>
                        </View>
                        <View style={[styles.cloudMiniBadge, { backgroundColor: 'rgba(147,112,219,0.15)' }]}>
                          <Text style={[styles.cloudMiniText, { color: '#9370DB' }]}>{language === 'ko' ? '중' : 'M'} {Math.round(item.mid)}%</Text>
                        </View>
                        <View style={[styles.cloudMiniBadge, { backgroundColor: 'rgba(255,105,180,0.15)' }]}>
                          <Text style={[styles.cloudMiniText, { color: '#FF69B4' }]}>{language === 'ko' ? '고' : 'H'} {Math.round(item.high)}%</Text>
                        </View>
                      </View>
                      <Text style={[styles.listTotalCloud, { color: theme.text }]}>{t('avgLabel', language)} {total}%</Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {/* Footer Controls */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: theme.accent }]} onPress={onClose}>
              <Text style={styles.primaryBtnText}>{t('close', language)}</Text>
            </TouchableOpacity>
          </View>

        </Animated.View>
      </View>
    </Modal>

      {/* Sunset & Cloud Science Info Modal */}
      <Modal
        visible={showInfoModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowInfoModal(false)}
      >
        <View style={styles.infoOverlay}>
          <View style={[styles.infoModalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.infoHeader, { borderBottomColor: theme.border }]}>
              <View style={styles.infoHeaderTitleRow}>
                <Info size={18} color={theme.accent} style={{ marginRight: 6 }} />
                <Text style={[styles.infoHeaderTitle, { color: theme.text }]}>{t('radarGuideTitle', language)}</Text>
              </View>
              <TouchableOpacity 
                style={[styles.infoCloseBtn, { backgroundColor: theme.border }]} 
                onPress={() => setShowInfoModal(false)}
              >
                <X size={14} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Sub Tab Selector */}
            <View style={[styles.subTabContainer, { backgroundColor: theme.border }]}>
              <TouchableOpacity
                style={[styles.subTabButton, guideSubTab === 'basic' && [styles.activeSubTabButton, { backgroundColor: theme.card }]]}
                onPress={() => setGuideSubTab('basic')}
              >
                <Text style={[styles.subTabText, { color: guideSubTab === 'basic' ? theme.text : theme.subText, fontWeight: guideSubTab === 'basic' ? '800' : '600' }]}>
                  {t('tabBasicGuide', language)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabButton, guideSubTab === 'encyclopedia' && [styles.activeSubTabButton, { backgroundColor: theme.card }]]}
                onPress={() => setGuideSubTab('encyclopedia')}
              >
                <Text style={[styles.subTabText, { color: guideSubTab === 'encyclopedia' ? theme.text : theme.subText, fontWeight: guideSubTab === 'encyclopedia' ? '800' : '600' }]}>
                  {t('tabCloudGuide', language)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabButton, guideSubTab === 'portal' && [styles.activeSubTabButton, { backgroundColor: theme.card }]]}
                onPress={() => setGuideSubTab('portal')}
              >
                <Text style={[styles.subTabText, { color: guideSubTab === 'portal' ? theme.text : theme.subText, fontWeight: guideSubTab === 'portal' ? '800' : '600' }]}>
                  {t('tabPortalLinks', language)}
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.infoScrollBody} showsVerticalScrollIndicator={false}>
              {guideSubTab === 'basic' ? (
                <>
                  {/* 1. 구름 종류 가이드 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: theme.accent }]}>☁️ {language === 'ko' ? '구름의 종류와 노을의 상관관계' : 'Cloud Types & Sunset Correlation'}</Text>
                    <Text style={[styles.infoText, { color: theme.text }]}>
                      {language === 'ko' ? '구름은 대기 중 떠 있는 고도에 따라 노을의 색과 형태를 크게 결정합니다.' : 'Clouds largely determine the color and shape of sunsets depending on their altitude.'}
                    </Text>
                    
                    <View style={styles.guideCard}>
                      <View style={styles.guideItem}>
                        <View style={[styles.guideColorIndicator, { backgroundColor: '#FF69B4' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.guideName, { color: theme.text }]}>{t('legendHighTitle', language)}</Text>
                          <Text style={[styles.guideDesc, { color: theme.subText }]}>
                            {language === 'ko' ? '빙결정으로 이루어진 얇은 구름(권운 등)입니다. 지평선 아래로 해가 진 후에도 높은 고도 덕분에 오랜 시간 햇빛을 받아 붉은빛을 넓게 반사하고 증폭시킵니다.' : 'Thin clouds made of ice crystals (e.g. Cirrus). Due to high altitude, they receive sunlight long after the sun goes below the horizon, reflecting and amplifying red light.'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.guideItem}>
                        <View style={[styles.guideColorIndicator, { backgroundColor: '#9370DB' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.guideName, { color: theme.text }]}>{t('legendMidTitle', language)}</Text>
                          <Text style={[styles.guideDesc, { color: theme.subText }]}>
                            {language === 'ko' ? '고적운이나 고층운 등 물방울과 빙결정의 혼합 구름입니다. 하늘에 입체적인 틈새를 만들어 웅장한 하늘 그림자나 드라마틱한 빛내림(Crepuscular rays)을 형성합니다.' : 'Mixed clouds of water droplets and ice crystals (e.g. Altocumulus). Creates spatial gaps in the sky that form majestic cloud shadows or dramatic crepuscular rays.'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.guideItem}>
                        <View style={[styles.guideColorIndicator, { backgroundColor: '#4682B4' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.guideName, { color: theme.text }]}>{t('legendLowTitle', language)}</Text>
                          <Text style={[styles.guideDesc, { color: theme.subText }]}>
                            {language === 'ko' ? '적운, 층운 등 두껍고 지표에 가까운 구름입니다. 밀도가 높아 태양광을 가리기 쉬우며, 지평선 근처에 저층운이 빽빽하게 낄 경우 노을빛을 통째로 흡수해 흐려지게 만듭니다.' : 'Thick, low clouds near the surface (e.g. Cumulus). Easy to block sunlight due to high density, and dense low clouds near the horizon will absorb the sunset glow completely.'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* 2. 시뮬레이션 방법 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: theme.accent }]}>{language === 'ko' ? '🎮 시뮬레이션 활용 방법' : '🎮 How to Use Simulation'}</Text>
                    
                    <View style={styles.instructionStep}>
                      <Text style={[styles.stepNum, { color: theme.accent }]}>1</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.stepText, { color: theme.text }]}>
                          <Text style={{ fontWeight: '800' }}>{t('radarGridGuideText1', language)}</Text> {t('radarGridGuideDesc1', language)}
                        </Text>
                        <RadarGridInfoGraphic theme={theme} />
                      </View>
                    </View>
                    
                    <View style={styles.instructionStep}>
                      <Text style={[styles.stepNum, { color: theme.accent }]}>2</Text>
                      <Text style={[styles.stepText, { color: theme.text }]}>
                        <Text style={{ fontWeight: '800' }}>{t('radarGridGuideText2', language)}</Text> {t('radarGridGuideDesc2', language)}
                      </Text>
                    </View>
                  </View>

                  {/* 3. 노을의 원리와 과학 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: theme.accent }]}>{language === 'ko' ? '🔬 노을의 과학과 색의 변화' : '🔬 Science of Sunsets'}</Text>
                    
                    <View style={[styles.scienceCard, { backgroundColor: theme.border }]}>
                      <Text style={[styles.scienceTitle, { color: theme.text }]}>{t('scienceTitleRayleigh', language)}</Text>
                      <Text style={[styles.scienceText, { color: theme.subText }]}>
                        {t('scienceDescRayleigh', language)}
                      </Text>
                      <RayleighInfoGraphic theme={theme} />
                      
                      <Text style={[styles.scienceTitle, { color: theme.text, marginTop: 16 }]}>{t('scienceTitleMie', language)}</Text>
                      <Text style={[styles.scienceText, { color: theme.subText }]}>
                        {t('scienceDescMie', language)}
                      </Text>
                      <MieInfoGraphic theme={theme} />
                    </View>
                  </View>

                  {/* 4. 시뮬레이션 유의사항 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: '#FFA500' }]}>⚠️ {language === 'ko' ? '시뮬레이션 오차 및 유의사항' : 'Simulation Disclaimer'}</Text>
                    <View style={[styles.scienceCard, { backgroundColor: theme.border, padding: 16 }]}>
                      <Text style={[styles.scienceText, { color: theme.text, fontSize: 12, lineHeight: 18 }]}>
                        {t('simulationLimitNote', language)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : guideSubTab === 'encyclopedia' ? (
                <View style={styles.encyclopediaContainer}>
                  <Text style={[styles.infoSectionTitle, { color: theme.accent, marginBottom: 4 }]}>{t('cloudScienceTitle', language)}</Text>
                  <Text style={[styles.infoText, { color: theme.subText, marginBottom: 16 }]}>
                    {t('cloudScienceDesc', language)}
                  </Text>
                  
                  {(language === 'ko' ? CLOUD_BOOK_DATA_KO : CLOUD_BOOK_DATA_EN).map((cloud) => {
                    const isExpanded = expandedCloud === cloud.name;
                    let viewWidth = 190;
                    let viewHeight = 48;
                    if (cloud.name === 'Cirrus' || cloud.name === 'Stratus') {
                      viewWidth = 220; viewHeight = 15;
                    } else if (cloud.name === 'Cirrostratus' || cloud.name === 'Altostratus' || cloud.name === 'Nimbostratus') {
                      viewWidth = 240; viewHeight = 24;
                    } else if (cloud.name === 'Cumulonimbus') {
                      viewWidth = 160; viewHeight = 100;
                    }
                    
                    const pathStr = CLOUD_TEMPLATES[cloud.name]?.[0] || "";
                    const badgeColor = cloud.altitudeType === 'high' ? '#FF69B4' : cloud.altitudeType === 'mid' ? '#9370DB' : '#4682B4';
                    const badgeText = cloud.altitudeType === 'high' ? t('cloudAltitudeTypeHigh', language) : cloud.altitudeType === 'mid' ? t('cloudAltitudeTypeMid', language) : t('cloudAltitudeTypeLow', language);
                    
                    return (
                      <View key={cloud.name} style={[styles.cloudBookCard, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.01)' }]}>
                        <TouchableOpacity
                          style={styles.cloudBookHeader}
                          activeOpacity={0.7}
                          onPress={() => setExpandedCloud(isExpanded ? null : cloud.name)}
                        >
                          <View style={[styles.miniSvgContainer, { backgroundColor: 'rgba(5, 5, 10, 0.4)', borderColor: theme.border }]}>
                            <Svg width="64" height="36" viewBox={`0 0 ${viewWidth} ${viewHeight}`} style={styles.miniSvg}>
                              <Path d={pathStr} fill="rgba(255,255,255,0.75)" />
                            </Svg>
                          </View>
                          
                          <View style={styles.cloudHeaderInfo}>
                            <View style={styles.cloudTitleRow}>
                              <Text style={[styles.cloudBookTitle, { color: theme.text }]}>{cloud.displayName}</Text>
                              <View style={[styles.altitudeMiniBadge, { backgroundColor: `${badgeColor}20` }]}>
                                <Text style={[styles.altitudeMiniBadgeText, { color: badgeColor }]}>{badgeText}</Text>
                              </View>
                            </View>
                            <Text style={[styles.cloudBookSub, { color: theme.subText }]}>{cloud.name} | {cloud.altitudeRange}</Text>
                          </View>
                        </TouchableOpacity>
                        
                        {isExpanded && (
                          <View style={[styles.cloudBookDetails, { borderTopColor: theme.border }]}>
                            <Text style={[styles.detailDesc, { color: theme.text }]}>
                              💡 <Text style={{ fontWeight: '700' }}>{t('cloudFeature', language)}:</Text> {cloud.summary}
                            </Text>
                            <Text style={[styles.detailDesc, { color: theme.text, marginTop: 6 }]}>
                              💨 <Text style={{ fontWeight: '700' }}>{t('cloudOrigin', language)}:</Text> {cloud.origin}
                            </Text>
                            <Text style={[styles.detailDesc, { color: theme.text, marginTop: 6 }]}>
                              🌇 <Text style={{ fontWeight: '700' }}>{t('cloudSunsetEffect', language)}:</Text> {cloud.sunsetEffect}
                            </Text>
                            
                            <View style={styles.specsRow}>
                              <View style={[styles.specBadge, { backgroundColor: theme.border }]}>
                                <Text style={[styles.specBadgeText, { color: theme.text }]}>{cloud.physics.thickness}</Text>
                              </View>
                              <View style={[styles.specBadge, { backgroundColor: theme.border }]}>
                                <Text style={[styles.specBadgeText, { color: theme.text }]}>{cloud.physics.scattering}</Text>
                              </View>
                              <View style={[styles.specBadge, { backgroundColor: theme.border }]}>
                                <Text style={[styles.specBadgeText, { color: theme.text }]}>{cloud.physics.shadow}</Text>
                              </View>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.portalContainer}>
                  {/* PPLANER Portal */}
                  <View style={[styles.portalMainCard, { borderColor: theme.border, backgroundColor: 'rgba(255, 215, 0, 0.03)' }]}>
                    <View style={styles.portalCardHeader}>
                      <Globe size={20} color={theme.accent} style={{ marginRight: 8 }} />
                      <Text style={[styles.portalCardTitle, { color: theme.text }]}>{t('portalTitle', language)}</Text>
                    </View>
                    <Text style={[styles.portalCardDesc, { color: theme.subText }]}>
                      {t('portalDesc', language)}
                    </Text>
                    <TouchableOpacity 
                      style={[styles.portalLinkBtn, { backgroundColor: theme.accent }]}
                      onPress={() => Linking.openURL('https://pplaner.com')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.portalLinkBtnText}>{t('visitSite', language)}</Text>
                      <ExternalLink size={14} color="#000" style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>

                  {/* Sister Sites Header */}
                  <Text style={[styles.portalSectionHeader, { color: theme.text }]}>
                    🔗 {t('sisterSitesTitle', language)}
                  </Text>

                  {/* JP Rail Planner */}
                  <View style={[styles.portalSubCard, { borderColor: theme.border }]}>
                    <View style={styles.portalCardHeader}>
                      <Compass size={18} color="#FF6347" style={{ marginRight: 8 }} />
                      <Text style={[styles.portalSubCardTitle, { color: theme.text }]}>{t('sisterJpRailTitle', language)}</Text>
                    </View>
                    <Text style={[styles.portalCardDesc, { color: theme.subText }]}>
                      {t('sisterJpRailDesc', language)}
                    </Text>
                    <TouchableOpacity 
                      style={[styles.portalSubLinkBtn, { backgroundColor: theme.border }]}
                      onPress={() => Linking.openURL('https://jprail.pplaner.com')}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.portalSubLinkBtnText, { color: theme.text }]}>{t('visitSite', language)}</Text>
                      <ExternalLink size={12} color={theme.text} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>

                  {/* RG Nevel Planner */}
                  <View style={[styles.portalSubCard, { borderColor: theme.border }]}>
                    <View style={styles.portalCardHeader}>
                      <Cloud size={18} color="#20B2AA" style={{ marginRight: 8 }} />
                      <Text style={[styles.portalSubCardTitle, { color: theme.text }]}>{t('sisterRgNevelTitle', language)}</Text>
                    </View>
                    <Text style={[styles.portalCardDesc, { color: theme.subText }]}>
                      {t('sisterRgNevelDesc', language)}
                    </Text>
                    <TouchableOpacity 
                      style={[styles.portalSubLinkBtn, { backgroundColor: theme.border }]}
                      onPress={() => Linking.openURL('https://rgnevel.pplaner.com')}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.portalSubLinkBtnText, { color: theme.text }]}>{t('visitSite', language)}</Text>
                      <ExternalLink size={12} color={theme.text} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={[styles.infoFooter, { borderTopColor: theme.border }]}>
              <TouchableOpacity 
                style={[styles.infoPrimaryBtn, { backgroundColor: theme.text }]} 
                onPress={() => setShowInfoModal(false)}
              >
                <Text style={[styles.infoPrimaryBtnText, { color: theme.card }]}>{t('close', language)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    height: '84%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceMetaCard: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  metaText: {
    fontSize: 11,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 3,
    borderRadius: 10,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeTabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  radarCard: {
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.01)',
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  sectionDesc: {
    fontSize: 10,
    marginTop: 4,
    lineHeight: 14,
    opacity: 0.6,
  },
  gridOuterContainer: {
    flexDirection: 'row',
    marginTop: 18,
    alignItems: 'flex-start',
  },
  yAxisLabels: {
    width: 32,
    justifyContent: 'space-between',
    height: 252, // Matches grid table height
    paddingVertical: 4,
  },
  yLabel: {
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
    paddingRight: 6,
  },
  gridInnerContainer: {
    flex: 1,
  },
  gridTable: {
    height: 252,
    justifyContent: 'space-between',
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 32,
  },
  gridCell: {
    flex: 1,
    marginHorizontal: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  cellPercentageText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
  xAxisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2.5,
  },
  xLabel: {
    fontSize: 8,
    fontWeight: '700',
    width: 32,
    textAlign: 'center',
  },
  observerIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  observerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  observerLabelText: {
    fontSize: 10,
    fontWeight: '600',
  },
  legendCard: {
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  legendRow: {
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendColorBox: {
    width: 14,
    height: 14,
    borderRadius: 4,
    marginRight: 10,
  },
  legendTextCol: {
    flex: 1,
  },
  legendName: {
    fontSize: 10,
    fontWeight: '800',
  },
  legendDesc: {
    fontSize: 9,
    marginTop: 1.5,
    opacity: 0.7,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  listIndex: {
    fontSize: 10,
    fontWeight: '700',
    width: 24,
  },
  listTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  listSub: {
    fontSize: 9,
    marginTop: 2,
  },
  listItemRight: {
    alignItems: 'flex-end',
  },
  cloudBadgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  cloudMiniBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  cloudMiniText: {
    fontSize: 8,
    fontWeight: '800',
  },
  listTotalCloud: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#000',
  },
  altitudeTabContainer: {
    flexDirection: 'row',
    marginTop: 14,
    marginBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    gap: 4,
  },
  altitudeTabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeAltitudeTabButton: {
    // borderBottomColor will be applied dynamically
  },
  altitudeTabText: {
    fontSize: 11,
  },
  splitCellContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  splitCellSegment: {
    flex: 1,
    width: '100%',
  },
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoModalCard: {
    width: '100%',
    height: '80%',
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  infoHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  infoCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoScrollBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  infoSection: {
    marginBottom: 24,
  },
  infoSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 11,
    lineHeight: 16,
    opacity: 0.85,
  },
  guideCard: {
    marginTop: 10,
    gap: 12,
  },
  guideItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  guideColorIndicator: {
    width: 4,
    height: '90%',
    borderRadius: 2,
    marginTop: 2,
  },
  guideName: {
    fontSize: 11,
    fontWeight: '800',
  },
  guideDesc: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
    opacity: 0.8,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
  },
  stepNum: {
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  stepText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  scienceCard: {
    borderRadius: 16,
    padding: 14,
    marginTop: 6,
  },
  scienceTitle: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  scienceText: {
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.85,
  },
  infoFooter: {
    padding: 20,
    borderTopWidth: 1,
  },
  infoPrimaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoPrimaryBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  subTabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    padding: 3,
    borderRadius: 10,
  },
  subTabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeSubTabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  subTabText: {
    fontSize: 12,
  },
  encyclopediaContainer: {
    paddingBottom: 24,
  },
  cloudBookCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  cloudBookHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  miniSvgContainer: {
    width: 68,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  miniSvg: {
    transform: [{ scale: 0.8 }],
  },
  cloudHeaderInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  cloudTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cloudBookTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  altitudeMiniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  altitudeMiniBadgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  cloudBookSub: {
    fontSize: 10,
    marginTop: 2,
    opacity: 0.6,
  },
  cloudBookDetails: {
    borderTopWidth: 1,
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.005)',
  },
  detailDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  specsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 6,
  },
  specBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  specBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.85,
  },
  artCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  portalContainer: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 16,
  },
  portalMainCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  portalSubCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.005)',
  },
  portalCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  portalCardTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  portalSubCardTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  portalCardDesc: {
    fontSize: 11,
    lineHeight: 16,
    opacity: 0.8,
    marginBottom: 12,
  },
  portalLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  portalLinkBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
  },
  portalSubLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  portalSubLinkBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  portalSectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 2,
    letterSpacing: 0.5,
  },
});

