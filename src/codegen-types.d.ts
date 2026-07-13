/**
 * The TurboModule spec imports codegen types from the deep path
 * 'react-native/Libraries/Types/CodegenTypes' so it parses on RN 0.79's
 * codegen (which can't resolve the `CodegenTypes.` namespace style added in
 * 0.80). This repo typechecks with the `react-native-strict-api` condition,
 * which blocks deep Libraries/* type resolution — so alias the deep path to
 * the public namespace here. Type-only; erased at build time.
 */
declare module 'react-native/Libraries/Types/CodegenTypes' {
  import type { CodegenTypes } from 'react-native';

  export type EventEmitter<T> = CodegenTypes.EventEmitter<T>;
  export type UnsafeObject = CodegenTypes.UnsafeObject;
  export type Int32 = CodegenTypes.Int32;
  export type Float = CodegenTypes.Float;
  export type Double = CodegenTypes.Double;
  export type WithDefault<T, D> = CodegenTypes.WithDefault<T, D>;
  export type DirectEventHandler<T> = CodegenTypes.DirectEventHandler<T>;
  export type BubblingEventHandler<T> = CodegenTypes.BubblingEventHandler<T>;
}
