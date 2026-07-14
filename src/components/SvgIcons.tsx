import Svg, { G, Path } from 'react-native-svg';

const SvgIcons = ({
  icon,
  type,
  fill,
  size = 24,
}: {
  icon: string;
  type?: string;
  fill?: string;
  size?: number;
}) => {
  switch (icon) {
    case 'fullScreen':
      return type === 'full' ? (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <G id="SVGRepo_bgCarrier" strokeWidth={0} />
          <G
            id="SVGRepo_tracerCarrier"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <G id="SVGRepo_iconCarrier">
            <Path
              d="M4 1.5C2.61929 1.5 1.5 2.61929 1.5 4V8.5C1.5 9.05228 1.94772 9.5 2.5 9.5H3.5C4.05228 9.5 4.5 9.05228 4.5 8.5V4.5H8.5C9.05228 4.5 9.5 4.05228 9.5 3.5V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H4Z"
              fill={fill || '#fff'}
            />
            <Path
              d="M20 1.5C21.3807 1.5 22.5 2.61929 22.5 4V8.5C22.5 9.05228 22.0523 9.5 21.5 9.5H20.5C19.9477 9.5 19.5 9.05228 19.5 8.5V4.5H15.5C14.9477 4.5 14.5 4.05228 14.5 3.5V2.5C14.5 1.94772 14.9477 1.5 15.5 1.5H20Z"
              fill={fill || '#fff'}
            />
            <Path
              d="M20 22.5C21.3807 22.5 22.5 21.3807 22.5 20V15.5C22.5 14.9477 22.0523 14.5 21.5 14.5H20.5C19.9477 14.5 19.5 14.9477 19.5 15.5V19.5H15.5C14.9477 19.5 14.5 19.9477 14.5 20.5V21.5C14.5 22.0523 14.9477 22.5 15.5 22.5H20Z"
              fill={fill || '#fff'}
            />
            <Path
              d="M1.5 20C1.5 21.3807 2.61929 22.5 4 22.5H8.5C9.05228 22.5 9.5 22.0523 9.5 21.5V20.5C9.5 19.9477 9.05228 19.5 8.5 19.5H4.5V15.5C4.5 14.9477 4.05228 14.5 3.5 14.5H2.5C1.94772 14.5 1.5 14.9477 1.5 15.5V20Z"
              fill={fill || '#fff'}
            />
          </G>
        </Svg>
      ) : (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <G id="SVGRepo_bgCarrier" strokeWidth={0} />
          <G
            id="SVGRepo_tracerCarrier"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <G id="SVGRepo_iconCarrier">
            <Path
              d="M7 9.5C8.38071 9.5 9.5 8.38071 9.5 7V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H7.5C6.94772 1.5 6.5 1.94772 6.5 2.5V6.5H2.5C1.94772 6.5 1.5 6.94772 1.5 7.5V8.5C1.5 9.05228 1.94772 9.5 2.5 9.5H7Z"
              fill={fill || '#fff'}
            />
            <Path
              d="M17 9.5C15.6193 9.5 14.5 8.38071 14.5 7V2.5C14.5 1.94772 14.9477 1.5 15.5 1.5H16.5C17.0523 1.5 17.5 1.94772 17.5 2.5V6.5H21.5C22.0523 6.5 22.5 6.94772 22.5 7.5V8.5C22.5 9.05228 22.0523 9.5 21.5 9.5H17Z"
              fill={fill || '#fff'}
            />
            <Path
              d="M17 14.5C15.6193 14.5 14.5 15.6193 14.5 17V21.5C14.5 22.0523 14.9477 22.5 15.5 22.5H16.5C17.0523 22.5 17.5 22.0523 17.5 21.5V17.5H21.5C22.0523 17.5 22.5 17.0523 22.5 16.5V15.5C22.5 14.9477 22.0523 14.5 21.5 14.5H17Z"
              fill={fill || '#fff'}
            />
            <Path
              d="M9.5 17C9.5 15.6193 8.38071 14.5 7 14.5H2.5C1.94772 14.5 1.5 14.9477 1.5 15.5V16.5C1.5 17.0523 1.94772 17.5 2.5 17.5H6.5V21.5C6.5 22.0523 6.94772 22.5 7.5 22.5H8.5C9.05228 22.5 9.5 22.0523 9.5 21.5V17Z"
              fill={fill || '#fff'}
            />
          </G>
        </Svg>
      );

    case 'muteUnmute':
      return type === 'mute' ? (
        <Svg
          fill={fill || '#000000'}
          viewBox="0 0 24 24"
          width={size || 24}
          height={size || 24}
        >
          <G id="SVGRepo_bgCarrier" strokeWidth={0} />
          <G
            id="SVGRepo_tracerCarrier"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <G id="SVGRepo_iconCarrier">
            <Path
              fillRule="evenodd"
              d="M11.553 3.064A.75.75 0 0112 3.75v16.5a.75.75 0 01-1.255.555L5.46 16H2.75A1.75 1.75 0 011 14.25v-4.5C1 8.784 1.784 8 2.75 8h2.71l5.285-4.805a.75.75 0 01.808-.13zM10.5 5.445l-4.245 3.86a.75.75 0 01-.505.195h-3a.25.25 0 00-.25.25v4.5c0 .138.112.25.25.25h3a.75.75 0 01.505.195l4.245 3.86V5.445z"
            />
            <Path d="M18.718 4.222a.75.75 0 011.06 0c4.296 4.296 4.296 11.26 0 15.556a.75.75 0 01-1.06-1.06 9.5 9.5 0 000-13.436.75.75 0 010-1.06z" />
            <Path d="M16.243 7.757a.75.75 0 10-1.061 1.061 4.5 4.5 0 010 6.364.75.75 0 001.06 1.06 6 6 0 000-8.485z" />
          </G>
        </Svg>
      ) : (
        <Svg
          fill={fill || '#000000'}
          viewBox="0 0 16 16"
          width={size || 16}
          height={size || 16}
        >
          <G id="SVGRepo_bgCarrier" strokeWidth={0} />
          <G
            id="SVGRepo_tracerCarrier"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <G id="SVGRepo_iconCarrier">
            <Path
              d="M14.266 1.264l-13 13 .47.472 3.239-3.238L8 14.666V8.473l2.312-2.313c.467.542.737 1.227.737 1.947 0 .796-.316 1.559-.88 2.122l-.353.353.707.707.354-.353a4 4 0 0 0 1.172-2.829c0-.985-.377-1.923-1.03-2.654l1.422-1.422a5.994 5.994 0 0 1 1.608 4.076 5.999 5.999 0 0 1-1.758 4.243l-.354.353.707.707.354-.353a7 7 0 0 0 2.05-4.95 6.994 6.994 0 0 0-1.9-4.783l1.588-1.588zM8 1.334L4.5 5H1.871S1 5.894 1 8.002C1 10.11 1.871 11 1.871 11h1.422L8 6.293z"
              opacity={1}
              fill={fill || 'white'}
            />
          </G>
        </Svg>
      );

    case 'playPause':
      return type === 'play' ? (
        <Svg
          viewBox="0 0 24 24"
          fill="none"
          width={size || 24}
          height={size || 24}
        >
          <G id="SVGRepo_bgCarrier" strokeWidth={0} />
          <G
            id="SVGRepo_tracerCarrier"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <G id="SVGRepo_iconCarrier">
            <Path
              d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z"
              fill={fill || '#1C274C'}
            />
          </G>
        </Svg>
      ) : (
        <Svg
          viewBox="0 0 24 24"
          fill="none"
          width={size || 24}
          height={size || 24}
        >
          <G id="SVGRepo_bgCarrier" strokeWidth={0} />
          <G
            id="SVGRepo_tracerCarrier"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <G id="SVGRepo_iconCarrier">
            <Path
              d="M2 6C2 4.11438 2 3.17157 2.58579 2.58579C3.17157 2 4.11438 2 6 2C7.88562 2 8.82843 2 9.41421 2.58579C10 3.17157 10 4.11438 10 6V18C10 19.8856 10 20.8284 9.41421 21.4142C8.82843 22 7.88562 22 6 22C4.11438 22 3.17157 22 2.58579 21.4142C2 20.8284 2 19.8856 2 18V6Z"
              fill={fill || '#1C274C'}
            />
            <Path
              d="M14 6C14 4.11438 14 3.17157 14.5858 2.58579C15.1716 2 16.1144 2 18 2C19.8856 2 20.8284 2 21.4142 2.58579C22 3.17157 22 4.11438 22 6V18C22 19.8856 22 20.8284 21.4142 21.4142C20.8284 22 19.8856 22 18 22C16.1144 22 15.1716 22 14.5858 21.4142C14 20.8284 14 19.8856 14 18V6Z"
              fill={fill || '#1C274C'}
            />
          </G>
        </Svg>
      );
    default:
      return null;
  }
};

export default SvgIcons;
