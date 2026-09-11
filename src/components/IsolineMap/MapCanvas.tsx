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
  theme: any;
  selectedDate?: Date;
  /** 좁은 축척에서만 들어옵니다. null 이면 등치선이 제 일을 하는 구간입니다. */
  sunOverlay?: SunOverlay | null;
  /** 구름 레이더. 축척이 창 밖이거나 자료가 없으면 null 입니다. */
  radar?: RadarFrame | null;
}

export declare const MapCanvas: React.FC<MapCanvasProps>;
