// The test module: everything in the real module, plus reducers and policy rules that exist only
// to exercise failure paths and the policy gate. Published as the database "norn-test" (see
// `npm run test-db:publish`); the real database never gets these.
export { default } from '../../module/src/schema';
export * from '../../module/src/reducers';
export * from './failing';
import './rules';
