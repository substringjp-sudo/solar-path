import React from 'react';
import { IsochronePoint } from '../../utils/celestial';
import { SunOverlay } from '../../utils/solarGeometry';
import { RadarFrame } from '../../utils/cloudRadar';

export interface MapCanvasProps {
  lat: number;
  lon: number;
  hasLocation: boolean;
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  nightPolygonCoords?: Array<Array<{ latitude: number; longitude: number }>>;
  onRegionChangeComplete?: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void;
  /**
   * 지도가 **처음 뜰 때** 볼 곳과 화면 폭(경도, 도). 구에서 돌아올 때 구가 보던
   * 곳을 이어받습니다. 없으면 사용자 위치·화면 폭 60° 입니다.
   */
  startRegion?: { latitude: number; longitude: number; longitudeDelta: number };
  region?: { latitude: number; longitude: number; longitudeDelta: number };
  theme: any;
  selectedDate?: Date;
  /** 좁은 축척에서만 들어옵니다. null 이면 등치선이 제 일을 하는 구간입니다. */
  sunOverlay?: SunOverlay | null;
  /** 구름 레이더. 축척이 창 밖이거나 자료가 없으면 null 입니다. */
  radar?: RadarFrame | null;
  /** 시뮬레이션 보기(§120 B). 웹 미리보기는 안 그립니다. */
  topView?: import('./useCloudTopView').CloudTopViewImage | null;
  /** 롱프레스 시 해당 위경도 전달 */
  onLongPress?: (coord: { latitude: number; longitude: number }) => void;
  /** 손가락 두 개 줌을 지도가 직접 받을지(기본 켬). 하늘 탭은 줌을 진행도로 몰아 쓰므로 끕니다. */
  zoomEnabled?: boolean;
  /** 길게 눌러 고른(아직 확인 전) 자리 — 핀으로 보입니다. */
  pickPin?: { latitude: number; longitude: number } | null;
}

/** 리렌더 없이 지도를 옮깁니다(웹 미리보기는 고정 도법이라 아무 일도 안 함). */
export interface MapCanvasHandle {
  moveTo: (region: { latitude: number; longitude: number; longitudeDelta: number }, durationMs?: number) => void;
}

export declare const MapCanvas: React.ForwardRefExoticComponent<MapCanvasProps & React.RefAttributes<MapCanvasHandle>>;
