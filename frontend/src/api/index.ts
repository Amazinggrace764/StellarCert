export * from './types';
export * from './tokens';
export * from './socket';
export * from './endpoints';

// `VITE_USE_DUMMY_DATA` must be referenced directly as `import.meta.env.*`
// so Vite can statically replace it and tree-shake dummy data branches.
export const USE_DUMMY_DATA: boolean =
  import.meta.env.VITE_USE_DUMMY_DATA === 'true';
