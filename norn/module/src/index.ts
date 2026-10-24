// Module entry. The schema must be the default export; every other export is a reducer or
// lifecycle hook that SpacetimeDB registers.
export { default } from './schema';
export * from './reducers';
export * from './spike';
