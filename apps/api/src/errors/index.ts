/**
 * Public surface of the API's error subsystem.
 *
 * Handlers throw `AppError(code, message, options)`, and `buildServer`
 * wires the global hook by calling `registerErrorHandler(server)`.
 */

export { AppError } from './AppError.js';
export type { AppErrorOptions } from './AppError.js';
export { registerErrorHandler } from './handler.js';
