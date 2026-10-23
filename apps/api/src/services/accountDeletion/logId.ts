/**
 * Keyed account identifier for logs (account-deletion R15.6, R9.7). Logs never carry a user id,
 * email, name, password, grant or phrase: an account appears only as this short keyed hash.
 */

import { createHmac } from 'node:crypto';

export const LOG_ID_DOMAIN = 'account-deletion-log-v1:';

/** First 12 lowercase hex characters of HMAC-SHA256(key = sessionSecret, 'account-deletion-log-v1:' + userId). */
export function accountLogId(userId: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret)
    .update(LOG_ID_DOMAIN + userId)
    .digest('hex')
    .slice(0, 12);
}
