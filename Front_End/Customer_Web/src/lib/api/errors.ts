export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export interface ValidationProblemDetails extends ProblemDetails {
  errors: Record<string, string[]>;
}

/** The API base URL is missing or malformed; no request was attempted. */
export class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigError";
  }
}

/** The request could not reach the server (offline, DNS, timeout, aborted transport). */
export class ApiNetworkError extends Error {
  constructor(message = "The request could not reach the server.") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

/** The server responded with a non-2xx status, normalized to RFC 7807 Problem Details. */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiHttpError";
    this.status = status;
    this.problem = problem;
  }
}

/** An HTTP failure whose body was a validation ProblemDetails (has field-level errors). */
export class ApiValidationError extends ApiHttpError {
  readonly errors: Record<string, string[]>;

  constructor(status: number, problem: ValidationProblemDetails) {
    super(status, problem);
    this.name = "ApiValidationError";
    this.errors = problem.errors;
  }
}
