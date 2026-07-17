import React from 'react';
import { IsochronePoint } from '../../utils/celestial';

export interface MapCanvasProps {
  lat: number;
  lon: number;
  hasLocation: boolean;
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  theme: any;
}

export declare const MapCanvas: React.FC<MapCanvasProps>;
