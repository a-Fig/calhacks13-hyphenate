// Module entry. The schema must be the default export; every other export is a reducer or
// lifecycle hook that SpacetimeDB registers. Nothing test-only lives here: see ../../module-test.
export { default } from './schema';
export * from './reducers';
