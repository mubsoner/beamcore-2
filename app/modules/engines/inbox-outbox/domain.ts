import {
  createOperationError,
  createOperationResult,
  isDomainEventEnvelope,
  isObjectRef,
  isRequestContext,
  isRevisionNumber,
  sameScopeRef,
  type InboxEventEnvelope,
  type OperationResult,
  type RequestContext,
} from "../shared";

function rejected<T>(
  correlation_id: string,
  code: "VALIDATION_ERROR" | "INTEGRITY_OR_UNTRUSTED_INPUT" | "INTERNAL_ERROR",
  safe_message: string,
): OperationResult<T> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id,
    errors: [createOperationError(code, safe_message, false)],
  });
}

/**
 * Validate the trust boundary before calculating a fingerprint or touching
 * the Inbox. The event's tenant/scope is never inferred from its payload.
 */
export function validateInboxEvent(
  context: unknown,
  consumer_id: unknown,
  event: unknown,
): string[] {
  const issues: string[] = [];

  if (!isRequestContext(context)) {
    issues.push("A valid authenticated RequestContext is required");
  }
  if (typeof consumer_id !== "string" || consumer_id.trim().length === 0) {
    issues.push("consumer_id is required");
  }
  if (!isDomainEventEnvelope(event)) {
    issues.push("event must satisfy the canonical DomainEventEnvelope");
    return issues;
  }

  const inboxEvent = event as InboxEventEnvelope;
  if (!isObjectRef(inboxEvent.aggregate_ref)) {
    issues.push("aggregate_ref must be a canonical ObjectRef");
  }
  if (!isRevisionNumber(inboxEvent.aggregate_version)) {
    issues.push("aggregate_version must be a positive integer");
  }

  if (isObjectRef(inboxEvent.aggregate_ref) && isRevisionNumber(inboxEvent.aggregate_version)) {
    if (!sameScopeRef(inboxEvent.aggregate_ref.scope_ref, inboxEvent.scope_ref)) {
      issues.push("aggregate_ref scope must match event scope_ref");
    }
    if (
      inboxEvent.aggregate_ref.object_version !== undefined &&
      inboxEvent.aggregate_ref.object_version !== String(inboxEvent.aggregate_version)
    ) {
      issues.push("aggregate_ref.object_version must match aggregate_version");
    }
  }

  if (
    isRequestContext(context) &&
    !sameScopeRef(context.scope_ref, inboxEvent.scope_ref)
  ) {
    issues.push("event scope_ref must match the authenticated request scope");
  }

  return issues;
}

function canonicalJson(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new TypeError("Payload must contain only JSON-compatible values");
  }

  if (ancestors.has(value)) {
    throw new TypeError("Payload must not contain circular references");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some((key) => typeof key !== "string" || (key !== "length" && (!Number.isSafeInteger(Number(key)) || String(Number(key)) !== key)))
      ) {
        throw new TypeError("Arrays must not contain custom or symbol properties");
      }

      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("Sparse arrays are not valid event payloads");
        }
        parts.push(canonicalJson(value[index], ancestors));
      }
      return `[${parts.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Payload objects must be plain JSON objects");
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Symbol keys are not valid event payload fields");
    }

    const keys = (ownKeys as string[]).sort();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = keys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Payload properties must be enumerable data properties");
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Build the exact semantic material used for Inbox deduplication.
 * event_id and delivery metadata are intentionally excluded: the same fact
 * must fingerprint identically when it is redelivered.
 */
export function buildInboxFingerprintMaterial(
  context: RequestContext,
  consumer_id: string,
  event: InboxEventEnvelope,
): OperationResult<string> {
  const issues = validateInboxEvent(context, consumer_id, event);
  if (issues.length > 0) {
    return rejected(
      context?.correlation_id ?? "",
      "VALIDATION_ERROR",
      issues.join("; "),
    );
  }

  try {
    const material = {
      scope_ref: event.scope_ref,
      aggregate_kind: event.aggregate_ref.object_kind,
      aggregate_id: event.aggregate_ref.object_id,
      aggregate_version: event.aggregate_version,
      event_type: event.event_type,
      payload: event.payload,
    };
    return createOperationResult({
      status: "OK",
      correlation_id: context.correlation_id,
      data: canonicalJson(material),
    });
  } catch (error) {
    return rejected(
      context.correlation_id,
      "INTEGRITY_OR_UNTRUSTED_INPUT",
      error instanceof Error ? error.message : "Event payload is not valid canonical JSON",
    );
  }
}

/**
 * Calculate a SHA-256 fingerprint using the platform Web Crypto API.
 * The platform implementation remains replaceable; no database or broker is
 * selected by this domain helper.
 */
export async function fingerprintInboxEvent(
  context: RequestContext,
  consumer_id: string,
  event: InboxEventEnvelope,
): Promise<OperationResult<string>> {
  const material = buildInboxFingerprintMaterial(context, consumer_id, event);
  if (material.status !== "OK" || material.data === undefined) {
    return material;
  }

  try {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) {
      return rejected(
        context.correlation_id,
        "INTERNAL_ERROR",
        "SHA-256 Web Crypto is unavailable in this runtime",
      );
    }

    const digest = await cryptoApi.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(material.data),
    );
    const fingerprint = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return createOperationResult({
      status: "OK",
      correlation_id: context.correlation_id,
      data: fingerprint,
    });
  } catch {
    return rejected(
      context.correlation_id,
      "INTERNAL_ERROR",
      "Could not calculate the Inbox event fingerprint",
    );
  }
}
