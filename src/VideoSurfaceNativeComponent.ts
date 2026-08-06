import { codegenNativeComponent, type ViewProps } from 'react-native';

export interface NativeProps extends ViewProps {
  /** Unique id this surface registers under in the native surface registry. */
  surfaceId: string;
}

export default codegenNativeComponent<NativeProps>('AuVideoSurfaceView');
