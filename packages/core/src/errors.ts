/** Base class for every error thrown by OrthoGea packages. */
export class OrthoGeaError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

/** The XML returned by a GetCapabilities request could not be understood. */
export class CapabilitiesParseError extends OrthoGeaError {
  constructor(message: string, cause?: unknown) {
    super("CAPABILITIES_PARSE_ERROR", message, cause);
  }
}

/** The service reported an OGC `ServiceException`. */
export class ServiceExceptionError extends OrthoGeaError {
  readonly exceptions: readonly string[];

  constructor(exceptions: readonly string[], cause?: unknown) {
    super(
      "SERVICE_EXCEPTION",
      exceptions[0] ?? "The service returned a ServiceException report",
      cause
    );
    this.exceptions = exceptions;
  }
}

/** An operation was requested on a service binding that does not support it. */
export class UnsupportedServiceError extends OrthoGeaError {
  constructor(message: string) {
    super("UNSUPPORTED_SERVICE", message);
  }
}

/** The endpoint was unreachable, timed out or answered with an HTTP error. */
export class EndpointUnavailableError extends OrthoGeaError {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super("ENDPOINT_UNAVAILABLE", message, cause);
    this.status = status;
  }
}
