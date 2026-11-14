/**
 * BeamCore canonical cross-engine contracts.
 *
 * These types are the shared contract boundary for INV-01..INV-21.
 * Wire-facing field names intentionally follow the canonical snake_case schema.
 * Do not add engine-specific state or provider details here.
 */

export const ENGINE_IDS = [
  "INV-01",
  "INV-02",
  "INV-03",
  "INV-04",
  "INV-05",
  "INV-06",
  "INV-07",
  "INV-08",
  "INV-09",
  "INV-10",
  "INV-11",
  "INV-12",
  "INV-13",
  "INV-14",
  "INV-15",
  "INV-16",
  "INV-17",
  "INV-18",
  "INV-19",
  "INV-20",
  "INV-21",
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];
export type ID = string;
export type Timestamp = string;
export type RevisionNumber = number;
export type Version = string;

export const SCOPE_KINDS = [
  "PERSONAL",
  "ORGANIZATION",
  "DEPARTMENT",
  "PROJECT",
  "WORK",
  "SYSTEM",
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const PRINCIPAL_KINDS = ["USER", "SERVICE", "AGENT", "SYSTEM"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface ScopeRef {
  scope_id: ID;
  scope_kind: ScopeKind;
  parent_scope_ref?: ScopeRef;
}

export interface PrincipalRef {
  principal_id: ID;
  principal_kind: PrincipalKind;
  home_scope_ref?: ScopeRef;
}

export interface ObjectRef {
  object_kind: string;
  object_id: ID;
  object_version?: Version;
  scope_ref: ScopeRef;
}

export type SourceTrustStatus =
  | "UNASSESSED"
  | "TRUSTED_BY_SOURCE_POLICY"
  | "UNTRUSTED"
  | "QUARANTINED";

export type FreshnessStatus = "CURRENT" | "STALE" | "UNKNOWN";

export interface SourceRef {
  object_ref: ObjectRef;
  source_version?: Version;
  locator?: string;
  digest?: string;
  observed_at?: Timestamp;
  trust_status?: SourceTrustStatus;
  freshness_status?: FreshnessStatus;
}

export interface RequestContext {
  request_id: ID;
  correlation_id: ID;
  actor_ref: PrincipalRef;
  scope_ref: ScopeRef;
  issued_at: Timestamp;
  deadline?: Timestamp;
  idempotency_key?: string;
  expected_version?: Version;
}

/** Canonical cross-engine event envelope; payloads contain references and minimal facts only. */
export interface DomainEventEnvelope<T = unknown> {
  event_id: ID;
  event_type: string;
  schema_version: RevisionNumber;
  occurred_at: Timestamp;
  producer_engine: EngineId;
  object_ref: ObjectRef;
  scope_ref: ScopeRef;
  correlation_id: ID;
  causation_id?: ID;
  actor_ref?: PrincipalRef;
  payload: T;
}

export function isDomainEventEnvelope(value: unknown): value is DomainEventEnvelope {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.event_id) &&
    isNonEmptyString(value.event_type) &&
    isRevisionNumber(value.schema_version) &&
    isTimestamp(value.occurred_at) &&
    typeof value.producer_engine === "string" &&
    (ENGINE_IDS as readonly string[]).includes(value.producer_engine) &&
    isObjectRef(value.object_ref) &&
    isScopeRef(value.scope_ref) &&
    value.object_ref.scope_ref.scope_id === value.scope_ref.scope_id &&
    value.object_ref.scope_ref.scope_kind === value.scope_ref.scope_kind &&
    isNonEmptyString(value.correlation_id) &&
    (value.causation_id === undefined || isNonEmptyString(value.causation_id)) &&
    (value.actor_ref === undefined || isPrincipalRef(value.actor_ref)) &&
    Object.prototype.hasOwnProperty.call(value, "payload")
  );
}

export const OPERATION_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "NOT_FOUND_OR_NOT_VISIBLE",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "DEPENDENCY_UNAVAILABLE",
  "CAPABILITY_UNAVAILABLE",
  "TIMEOUT",
  "RESOURCE_LIMIT",
  "CANCELLED",
  "INTEGRITY_OR_UNTRUSTED_INPUT",
  "PARTIAL_RESULT",
  "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED",
  "INTERNAL_ERROR",
] as const;

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

export interface OperationError {
  code: OperationErrorCode;
  safe_message: string;
  retryable: boolean;
  details_ref?: ObjectRef;
}

/**
 * Provider-neutral persistence and delivery ports.
 * Implementations must enforce tenant scope, optimistic versions and atomicity;
 * domain engines must not depend on a specific database or queue SDK.
 */
export interface VersionedRepository<T> {
  get(context: RequestContext, ref: ObjectRef): Promise<OperationResult<T>>;
  create(context: RequestContext, ref: ObjectRef, value: T): Promise<OperationResult<T>>;
  update(
    context: RequestContext,
    ref: ObjectRef,
    expected_version: Version,
    value: T,
  ): Promise<OperationResult<T>>;
}

export interface AppendOnlyRepository<T> {
  append(context: RequestContext, value: T): Promise<OperationResult<T>>;
  get(context: RequestContext, ref: ObjectRef): Promise<OperationResult<T>>;
}

export interface IdempotencyRecord<T> {
  idempotency_key: string;
  request_fingerprint: string;
  result: OperationResult<T>;
  recorded_at: Timestamp;
}

export interface IdempotencyPort {
  get<T>(context: RequestContext, idempotency_key: string): Promise<OperationResult<IdempotencyRecord<T> | null>>;
  record<T>(context: RequestContext, record: IdempotencyRecord<T>): Promise<OperationResult<IdempotencyRecord<T>>>;
}

export interface EventOutboxPort {
  append(context: RequestContext, event: DomainEventEnvelope): Promise<OperationResult<{ event_id: ID }>>;
}

export interface ClockPort {
  now(): Timestamp;
}

export interface EngineTransaction {
  repository<T>(key: string): VersionedRepository<T>;
  appendOnly<T>(key: string): AppendOnlyRepository<T>;
  idempotency: IdempotencyPort;
  outbox: EventOutboxPort;
}

/**
 * A command runs in one unit of work. The adapter must commit domain writes,
 * idempotency result and outbox append atomically, or commit none of them.
 */
export interface EngineUnitOfWorkPort {
  execute<T>(
    context: RequestContext,
    command: (transaction: EngineTransaction) => Promise<OperationResult<T>>,
  ): Promise<OperationResult<T>>;
}

export interface IdGeneratorPort {
  next(kind: string, scope_ref: ScopeRef): ID;
}

export type OperationStatus = "OK" | "PARTIAL" | "REJECTED" | "UNKNOWN";

export function isOperationStatus(value: unknown): value is OperationStatus {
  return value === "OK" || value === "PARTIAL" || value === "REJECTED" || value === "UNKNOWN";
}

export function isOperationErrorCode(value: unknown): value is OperationErrorCode {
  return typeof value === "string" && (OPERATION_ERROR_CODES as readonly string[]).includes(value);
}

export interface OperationResult<T> {
  status: OperationStatus;
  data?: T;
  errors: OperationError[];
  warnings: string[];
  correlation_id: ID;
  object_version?: Version;
}

export interface OperationResultInput<T> {
  status: OperationStatus;
  correlation_id: ID;
  data?: T;
  errors?: readonly OperationError[];
  warnings?: readonly string[];
  object_version?: Version;
}

/** Creates the canonical operation envelope without changing domain status. */
export function createOperationResult<T>(
  input: OperationResultInput<T>,
): OperationResult<T> {
  const result: OperationResult<T> = {
    status: input.status,
    errors: [...(input.errors ?? [])],
    warnings: [...(input.warnings ?? [])],
    correlation_id: input.correlation_id,
  };

  if (input.data !== undefined) result.data = input.data;
  if (input.object_version !== undefined) {
    result.object_version = input.object_version;
  }

  return result;
}

export function createOperationError(
  code: OperationErrorCode,
  safe_message: string,
  retryable = false,
  details_ref?: ObjectRef,
): OperationError {
  const error: OperationError = { code, safe_message, retryable };
  if (details_ref !== undefined) error.details_ref = details_ref;
  return error;
}

export function isRevisionNumber(value: unknown): value is RevisionNumber {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isVersion(value: unknown): value is Version {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isTimestamp(value: unknown): value is Timestamp {
  if (typeof value !== "string") return false;

  // Parse components explicitly: Date.parse alone accepts some invalid calendar
  // dates by normalising them into the following month.
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (day < 1 || day > daysInMonth) return false;

  if (match[7] !== "Z") {
    const offsetHours = Number(match[9]);
    const offsetMinutes = Number(match[10]);
    if (
      offsetHours > 14 ||
      offsetMinutes > 59 ||
      (offsetHours === 14 && offsetMinutes !== 0)
    ) {
      return false;
    }
  }

  return true;
}

const scopeKindSet = new Set<string>(SCOPE_KINDS);
const principalKindSet = new Set<string>(PRINCIPAL_KINDS);
const sourceTrustStatusSet = new Set<SourceTrustStatus>([
  "UNASSESSED",
  "TRUSTED_BY_SOURCE_POLICY",
  "UNTRUSTED",
  "QUARANTINED",
]);
const freshnessStatusSet = new Set<FreshnessStatus>([
  "CURRENT",
  "STALE",
  "UNKNOWN",
]);

function isScopeRefAt(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): value is ScopeRef {
  if (!isRecord(value) || depth > 32 || ancestors.has(value)) return false;
  if (
    !isNonEmptyString(value.scope_id) ||
    typeof value.scope_kind !== "string" ||
    !scopeKindSet.has(value.scope_kind)
  ) {
    return false;
  }

  if (value.parent_scope_ref === undefined) return true;
  ancestors.add(value);
  const validParent = isScopeRefAt(value.parent_scope_ref, ancestors, depth + 1);
  ancestors.delete(value);
  return validParent;
}

export function isScopeRef(value: unknown): value is ScopeRef {
  return isScopeRefAt(value, new WeakSet<object>(), 0);
}

export function isPrincipalRef(value: unknown): value is PrincipalRef {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.principal_id) ||
    typeof value.principal_kind !== "string" ||
    !principalKindSet.has(value.principal_kind)
  ) {
    return false;
  }
  return (
    value.home_scope_ref === undefined || isScopeRef(value.home_scope_ref)
  );
}

export function isObjectRef(value: unknown): value is ObjectRef {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.object_kind) &&
    isNonEmptyString(value.object_id) &&
    (value.object_version === undefined || isVersion(value.object_version)) &&
    isScopeRef(value.scope_ref)
  );
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!isRecord(value) || !isObjectRef(value.object_ref)) return false;
  if (value.source_version !== undefined && !isVersion(value.source_version)) {
    return false;
  }
  if (value.locator !== undefined && typeof value.locator !== "string") {
    return false;
  }
  if (value.digest !== undefined && !isNonEmptyString(value.digest)) {
    return false;
  }
  if (value.observed_at !== undefined && !isTimestamp(value.observed_at)) {
    return false;
  }
  if (
    value.trust_status !== undefined &&
    !sourceTrustStatusSet.has(value.trust_status as SourceTrustStatus)
  ) {
    return false;
  }
  if (
    value.freshness_status !== undefined &&
    !freshnessStatusSet.has(value.freshness_status as FreshnessStatus)
  ) {
    return false;
  }
  return true;
}

export function isRequestContext(value: unknown): value is RequestContext {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.request_id) ||
    !isNonEmptyString(value.correlation_id) ||
    !isPrincipalRef(value.actor_ref) ||
    !isScopeRef(value.scope_ref) ||
    !isTimestamp(value.issued_at)
  ) {
    return false;
  }
  if (value.deadline !== undefined && !isTimestamp(value.deadline)) {
    return false;
  }
  if (
    value.idempotency_key !== undefined &&
    !isNonEmptyString(value.idempotency_key)
  ) {
    return false;
  }
  if (
    value.expected_version !== undefined &&
    !isVersion(value.expected_version)
  ) {
    return false;
  }
  return true;
}

/**
 * Returns safe, stable validation messages for a canonical request context.
 * Call before any domain mutation or authorization-sensitive operation.
 */
export function validateRequestContext(value: unknown): string[] {
  if (!isRecord(value)) return ["Request context must be an object"];

  const issues: string[] = [];
  if (!isNonEmptyString(value.request_id)) {
    issues.push("request_id is required");
  }
  if (!isNonEmptyString(value.correlation_id)) {
    issues.push("correlation_id is required");
  }
  if (!isPrincipalRef(value.actor_ref)) {
    issues.push("actor_ref is invalid");
  }
  if (!isScopeRef(value.scope_ref)) {
    issues.push("scope_ref is invalid");
  }
  if (!isTimestamp(value.issued_at)) {
    issues.push("issued_at must be an offset-aware RFC 3339 timestamp");
  }
  if (value.deadline !== undefined && !isTimestamp(value.deadline)) {
    issues.push("deadline must be an offset-aware RFC 3339 timestamp");
  } else if (
    value.deadline !== undefined &&
    isTimestamp(value.deadline) &&
    isTimestamp(value.issued_at) &&
    Date.parse(value.deadline) <= Date.parse(value.issued_at)
  ) {
    issues.push("deadline must be later than issued_at");
  }
  if (
    value.idempotency_key !== undefined &&
    !isNonEmptyString(value.idempotency_key)
  ) {
    issues.push("idempotency_key must be a non-empty string when supplied");
  }
  if (
    value.expected_version !== undefined &&
    !isVersion(value.expected_version)
  ) {
    issues.push("expected_version must be a non-empty version token");
  }
  return issues;
}

/**
 * Every mutation requires an idempotency key. Existing-object mutations also
 * require the caller to opt into expected-version enforcement.
 */
export function validateMutationContext(
  value: unknown,
  options: { requireExpectedVersion?: boolean } = {},
): string[] {
  const issues = validateRequestContext(value);
  if (!isRecord(value)) return issues;

  if (!isNonEmptyString(value.idempotency_key)) {
    issues.push("Mutations require idempotency_key");
  }
  if (
    options.requireExpectedVersion &&
    !isVersion(value.expected_version)
  ) {
    issues.push("This mutation requires expected_version");
  }
  return issues;
}

export function sameScopeRef(a: ScopeRef, b: ScopeRef): boolean {
  return a.scope_id === b.scope_id && a.scope_kind === b.scope_kind;
}

export function sameObjectRef(a: ObjectRef, b: ObjectRef): boolean {
  return (
    a.object_kind === b.object_kind &&
    a.object_id === b.object_id &&
    sameScopeRef(a.scope_ref, b.scope_ref)
  );
}

/**
 * TEMPORARY PROTOTYPE COMPATIBILITY BRIDGE.
 *
 * The current INV-01..INV-21 module prototypes still import these camelCase
 * shapes. They are not canonical shared contracts and must not be used by new
 * engine code. Migrate existing engine modules to the canonical types above,
 * then remove this bridge in a separately verified change.
 *
 * @deprecated Use ScopeRef, PrincipalRef, ObjectRef, RequestContext,
 * OperationError and OperationResult instead.
 */
export type Ref = {
  engineId: EngineId;
  kind: string;
  id: string;
  revision?: number;
};
export type Scope = {
  id: string;
  kind: "PERSONAL" | "WORKSPACE" | "ORGANIZATION" | "PROJECT" | "WORK" | "SYSTEM";
};
export type Actor = {
  id: string;
  kind: "HUMAN" | "AGENT" | "SERVICE" | "CONNECTOR" | "SYSTEM";
};
export type Context = {
  requestId: string;
  correlationId: string;
  requestedAt: string;
  actor?: Actor;
  scope: Scope;
  idempotencyKey?: string;
};
export type Issue = {
  code:
    | "VALIDATION_ERROR"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "VERSION_CONFLICT"
    | "INVALID_TRANSITION"
    | "NOT_READY"
    | "UNKNOWN";
  message: string;
  field?: string;
};
export type Result<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; issues: Issue[] };
export type Base = {
  id: string;
  scope: Scope;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: Actor;
};
export const ok = <T>(value: T): Result<T> => ({
  ok: true,
  value,
  warnings: [],
});
export const err = <T = never>(...issues: Issue[]): Result<T> => ({
  ok: false,
  issues,
});
export const problem = (
  code: Issue["code"],
  message: string,
  field?: string,
): Issue => ({ code, message, field });
export const base = (c: Context, id: string, now: string): Base => ({
  id,
  scope: { ...c.scope },
  revision: 1,
  createdAt: now,
  updatedAt: now,
  createdBy: c.actor,
});
export const sameScope = (a: Scope, b: Scope) =>
  a.id === b.id && a.kind === b.kind;
export const revisionOk = (expected: number, actual: number) =>
  expected === actual;
export const validDigest = (s: string) => /^[a-f0-9]{32,128}$/i.test(s);
export interface Repository<T extends Base> {
  get(c: Context, id: string): Promise<Result<T | undefined>>;
  insert(c: Context, r: T): Promise<Result<T>>;
  update(
    c: Context,
    id: string,
    expectedRevision: number,
    patch: Partial<T>,
  ): Promise<Result<T>>;
}
export interface AppendOnly<T> {
  append(c: Context, r: T): Promise<Result<T>>;
}
export interface Outbox {
  enqueue(c: Context, event: DomainEvent): Promise<Result<{ eventId: string }>>;
}
export interface DomainEvent {
  eventId: string;
  schemaVersion: number;
  sourceEngineId: EngineId;
  eventType: string;
  source: Ref;
  sourceRevision: number;
  occurredAt: string;
  recordedAt: string;
  correlationId: string;
  requestId: string;
  scope: Scope;
  payload: unknown;
}
