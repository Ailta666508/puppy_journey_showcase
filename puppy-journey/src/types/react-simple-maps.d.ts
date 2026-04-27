declare module "react-simple-maps" {
  import type { ReactNode, CSSProperties } from "react";

  export interface ComposableMapProps {
    projection?: string;
    projectionConfig?: { center?: [number, number]; scale?: number };
    className?: string;
    children?: ReactNode;
  }
  export function ComposableMap(props: ComposableMapProps): JSX.Element;

  export interface GeographiesProps {
    geography: string | object;
    children: (arg: { geographies: any[] }) => ReactNode;
    className?: string;
  }
  export function Geographies(props: GeographiesProps): JSX.Element;

  export interface GeographyProps {
    geography: { rsmKey: string; svgPath: string };
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: Record<string, CSSProperties>;
  }
  export function Geography(props: GeographyProps): JSX.Element;

  export interface MarkerProps {
    coordinates: [number, number];
    children?: ReactNode;
    className?: string;
  }
  export function Marker(props: MarkerProps): JSX.Element;

  export interface LineProps {
    from: [number, number];
    to: [number, number];
    stroke?: string;
    strokeWidth?: number;
    strokeLinecap?: string;
    strokeDasharray?: string;
    className?: string;
  }
  export function Line(props: LineProps): JSX.Element;

  export interface ZoomableGroupProps {
    center?: [number, number];
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    children?: ReactNode;
  }
  export function ZoomableGroup(props: ZoomableGroupProps): JSX.Element;
}
