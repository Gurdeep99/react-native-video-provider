import Svg, {
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  Polygon,
  Rect,
} from 'react-native-svg';

interface IconProps {
  size: number;
  color: string;
}

export function PlayIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Polygon points="6 3 20 12 6 21 6 3" />
    </Svg>
  );
}

export function PauseIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x="6" y="4" width="4" height="16" />
      <Rect x="14" y="4" width="4" height="16" />
    </Svg>
  );
}

export function CloseIcon({ size, color }: IconProps) {
  return (
    <Svg width={size || 20} height={size || 21} viewBox="0 0 20 21" fill="none">
      <G clipPath="url(#clip0_25_6005)">
        <Path
          d="M12.5 16.3069L6.25 10.0569L12.5 3.80688"
          stroke={color || '#000000'}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
      <Defs>
        <ClipPath id="clip0_25_6005">
          <Rect
            width={size || 20}
            height={size || 21}
            fill="white"
            transform="translate(0 0.0568848)"
          />
        </ClipPath>
      </Defs>
    </Svg>
  );
}

export function BackIcon({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    >
      <Line x1="18" y1="6" x2="6" y2="18" />
      <Line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function VolumeOnIcon({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Svg>
  );
}

export function VolumeOffIcon({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
      <Line x1="23" y1="9" x2="17" y2="15" />
      <Line x1="17" y1="9" x2="23" y2="15" />
    </Svg>
  );
}

export function EnterFullscreenIcon({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <Path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <Path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <Path d="M3 16v3a2 2 0 0 0 2 2h3" />
    </Svg>
  );
}

export function ExitFullscreenIcon({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <Path d="M16 3v3a2 2 0 0 0 2 2h3" />
      <Path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <Path d="M3 16h3a2 2 0 0 1 2 2v3" />
    </Svg>
  );
}
