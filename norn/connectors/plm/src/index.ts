// Norn's PLM connector. Everything company-specific is in the options; see options.ts.
//
//   readChangeRequest(opts, 'ECR-0417')      -> { change, record, modified }
//   listEcrs(opts, { since })                -> the ECRs modified after `since`
//   watchEcrs(opts, onChange, { intervalMs })  a poller with a high-water mark, reporting a change only when what an assessment is made from changed
//   verifyWebhook / createWebhookHandler       the PLM's signed webhooks
//   writeImpact(opts, 'ECR-0417', fields)    -> the seven impact fields, nothing else
//   postComment(opts, 'ECR-0417', html)
export type { ChangeRequest } from '../../../checks/src/types.ts';
export type {
  PlmOptions, PlmSettings, PlmConnection, Priority, CompanyClass, FaaClass,
} from './options.ts';
export type { EcrRecord, ImpactState, PlmChangeRequest, ReadResult } from './map.ts';
export type { EcrListing } from './read.ts';
export type { EcrChangeHandler, WatchOptions } from './watch.ts';
export type { WebhookEvent, WebhookHandlerOptions } from './webhook.ts';
export type { ImpactFields } from './write.ts';
export type { ImpactField, PlmDoc } from './schema.ts';
export { PlmError } from './client.ts';
export { connectionFromEnv, loadEnvFile, webhookSecretFromEnv } from './env.ts';
export { PlmMappingError, inputsHash, mapEcr, parseFieldValue, parseNumericValue } from './map.ts';
export { listEcrs, readChangeRequest } from './read.ts';
export { EcrWatcher, shiftStamp, watchEcrs } from './watch.ts';
export { SIGNATURE_HEADER, createWebhookHandler, verifyWebhook } from './webhook.ts';
export { IMPACT_FIELDS } from './schema.ts';
export { postComment, writeImpact } from './write.ts';
