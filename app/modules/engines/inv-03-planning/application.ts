import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  isTimestamp,
  type DomainEventEnvelope,
  type EngineTransaction,
  type EngineUnitOfWorkPort,
  type IdempotencyRecord,
  type ObjectRef,
  type OperationErrorCode,
  type OperationResult,
  type RequestContext,
} from "../shared";
import {
  applyGraphValidation,
  createGraphActivationRequest,
  createGraphRevision,
  createPlanRevision,
  transitionPlanRevision,
  validateGraphRevision,
  type GraphActivationRequest,
  type GraphValidationResult,
  type PlanRecord,
  type PlanRevision,
  type PlanRevisionState,
  type WorkGraphRecord,
  type WorkGraphRevision,
  type PlanningIssue,
} from "./domain";

export type SubmitPlanRevisionCommand =
  Parameters<typeof createPlanRevision>[0] & {
    request_fingerprint: string;
    event_ref: ObjectRef;
    expected_plan_version?: string;
  };

export type SubmitGraphRevisionCommand =
  Parameters<typeof createGraphRevision>[0] & {
    request_fingerprint: string;
    event_ref: ObjectRef;
    expected_plan_version: string;
    expected_graph_version?: string;
  };

export interface ReviewPlanRevisionCommand {
  context: RequestContext;
  plan_revision_ref: ObjectRef;
  expected_revision_version: string;
  target_state: PlanRevisionState;
  review_decision_ref?: ObjectRef;
  request_fingerprint: string;
  event_ref: ObjectRef;
  occurred_at: string;
}

export interface ValidateGraphApplicationCommand {
  context: RequestContext;
  graph_revision_ref: ObjectRef;
  expected_graph_version: string;
  validation_ref: ObjectRef;
  validator_version: string;
  max_nodes: number;
  max_edges: number;
  validated_at: string;
  review_decision_ref?: ObjectRef;
  request_fingerprint: string;
  event_ref: ObjectRef;
}

export type GraphValidationApplicationResult = {
  graph_revision: WorkGraphRevision;
  validation_result: GraphValidationResult;
  activation_eligible: boolean;
};

export type RequestGraphActivationCommand =
  Parameters<typeof createGraphActivationRequest>[0] & {
    request_fingerprint: string;
    event_ref: ObjectRef;
    expected_plan_version: string;
    expected_graph_version: string;
  };

export interface GraphActivationRevisionPair {
  plan: PlanRevision;
  graph: WorkGraphRevision;
}
export interface GraphActivationCandidate extends GraphActivationRevisionPair {
  request: GraphActivationRequest;
  plan_record: PlanRecord;
  graph_record: WorkGraphRecord;
}
/** INV-03-owned read boundary for activation and active-binding queries. */
export interface GraphActivationCandidateReaderPort {
  readRevisions(transaction: EngineTransaction, context: RequestContext, plan_revision_ref: ObjectRef, graph_revision_ref: ObjectRef): Promise<OperationResult<GraphActivationRevisionPair>>;
  readCandidate(transaction: EngineTransaction, context: RequestContext, request_ref: ObjectRef): Promise<OperationResult<GraphActivationCandidate>>;
}

function rejected<T>(
  code: OperationErrorCode,
  safe_message: string,
  correlation_id: string,
): OperationResult<T> {
  return createOperationResult({
    status: "REJECTED",
    correlation_id,
    errors: [createOperationError(code, safe_message, false)],
  });
}

function propagateFailure<T>(source: OperationResult<unknown>): OperationResult<T> {
  const isUnexpectedSuccess = source.status === "OK";
  return createOperationResult<T>({
    status: isUnexpectedSuccess ? "UNKNOWN" : source.status,
    correlation_id: source.correlation_id,
    errors: isUnexpectedSuccess
      ? [createOperationError("INTERNAL_ERROR", "A dependency returned success without the required record", false)]
      : source.errors,
    warnings: source.warnings,
    ...(source.object_version !== undefined ? { object_version: source.object_version } : {}),
  });
}

function mapDomainCode(code: PlanningIssue["code"]): OperationErrorCode {
  switch (code) {
    case "VALIDATION_ERROR":
      return "VALIDATION_ERROR";
    case "VERSION_CONFLICT":
      return "VERSION_CONFLICT";
    case "DEPENDENCY_UNAVAILABLE":
      return "DEPENDENCY_UNAVAILABLE";
    case "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED":
      return "OUTCOME_UNKNOWN_OR_RECONCILIATION_REQUIRED";
    case "INVALID_TRANSITION":
      return "VALIDATION_ERROR";
  }
}

function validateEnvelope(
  context: RequestContext,
  request_fingerprint: string,
  event_ref: ObjectRef,
): string | undefined {
  if (!isRequestContext(context)) {
    return "Planning mutation requires a valid canonical request context";
  }
  if (!context.idempotency_key?.trim()) {
    return "Planning mutation requires an idempotency key";
  }
  if (!isObjectRef(event_ref) || event_ref.object_kind !== "DOMAIN_EVENT") {
    return "Planning mutation requires a valid DOMAIN_EVENT reference";
  }
  if (
    event_ref.scope_ref.scope_id !== context.scope_ref.scope_id ||
    event_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind
  ) {
    return "Domain event reference must be in the request scope";
  }
  if (!/^[a-f0-9]{64}$/i.test(request_fingerprint)) {
    return "request_fingerprint must be a SHA-256 hex digest";
  }
  return undefined;
}

function sameRef(a: ObjectRef, b: ObjectRef): boolean {
  return a.object_kind === b.object_kind &&
    a.object_id === b.object_id &&
    a.object_version === b.object_version &&
    a.scope_ref.scope_id === b.scope_ref.scope_id &&
    a.scope_ref.scope_kind === b.scope_ref.scope_kind;
}

async function readPlanGraphRevisions(transaction: EngineTransaction, context: RequestContext, plan_revision_ref: ObjectRef, graph_revision_ref: ObjectRef): Promise<OperationResult<GraphActivationRevisionPair>> {
  if (!isRequestContext(context) || !isObjectRef(plan_revision_ref) || plan_revision_ref.object_kind !== "PLAN_REVISION" ||
      !isObjectRef(graph_revision_ref) || graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
      plan_revision_ref.scope_ref.scope_id !== context.scope_ref.scope_id || plan_revision_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind ||
      graph_revision_ref.scope_ref.scope_id !== context.scope_ref.scope_id || graph_revision_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind) {
    return rejected("VALIDATION_ERROR", "Plan/Graph revision lookup requires exact in-scope revision references", context.correlation_id);
  }
  const plan = await transaction.repository<PlanRevision>("inv-03.plan-revisions").get(context, plan_revision_ref);
  if (plan.status !== "OK" || !plan.data) return propagateFailure<GraphActivationRevisionPair>(plan);
  const graph = await transaction.repository<WorkGraphRevision>("inv-03.graph-revisions").get(context, graph_revision_ref);
  if (graph.status !== "OK" || !graph.data) return propagateFailure<GraphActivationRevisionPair>(graph);
  if (!sameRef(plan.data.plan_revision_ref, plan_revision_ref) || !sameRef(graph.data.graph_revision_ref, graph_revision_ref) ||
      !sameRef(plan.data.work_ref, graph.data.work_ref) || !sameRef(graph.data.source_plan_revision_ref, plan_revision_ref)) {
    return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "INV-03 revisions do not form the exact Plan/Graph pair requested", context.correlation_id);
  }
  return createOperationResult({status:"OK",correlation_id:context.correlation_id,data:{plan:plan.data,graph:graph.data}});
}
export const graphActivationCandidateReader: GraphActivationCandidateReaderPort = {
  readRevisions: readPlanGraphRevisions,
  async readCandidate(transaction, context, request_ref) {
    if (!isRequestContext(context) || !isObjectRef(request_ref) || request_ref.object_kind !== "GRAPH_ACTIVATION_REQUEST" ||
        request_ref.scope_ref.scope_id !== context.scope_ref.scope_id || request_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind) {
      return rejected("VALIDATION_ERROR", "Activation candidate lookup requires an in-scope GRAPH_ACTIVATION_REQUEST reference", context.correlation_id);
    }
    const requestResult = await transaction.appendOnly<GraphActivationRequest>("inv-03.graph-activation-requests").get(context, request_ref);
    if (requestResult.status !== "OK" || !requestResult.data) return propagateFailure<GraphActivationCandidate>(requestResult);
    const request = requestResult.data;
    if (!isObjectRef(request.request_ref) || !sameRef(request.request_ref, request_ref) ||
        !isObjectRef(request.work_ref) || request.work_ref.object_kind !== "WORK" ||
        !isObjectRef(request.plan_revision_ref) || request.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
        !isObjectRef(request.graph_revision_ref) || request.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
        request.work_ref.scope_ref.scope_id !== context.scope_ref.scope_id || request.work_ref.scope_ref.scope_kind !== context.scope_ref.scope_kind) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "INV-03 returned an activation request with invalid identity or scope", context.correlation_id);
    }
    const revisions = await readPlanGraphRevisions(transaction, context, request.plan_revision_ref, request.graph_revision_ref);
    if (revisions.status !== "OK" || !revisions.data) return propagateFailure<GraphActivationCandidate>(revisions);
    const {plan,graph}=revisions.data;
    const plan_record = await transaction.repository<PlanRecord>("inv-03.plans").get(context, plan.plan_ref);
    if (plan_record.status !== "OK" || !plan_record.data) return propagateFailure<GraphActivationCandidate>(plan_record);
    const graph_record = await transaction.repository<WorkGraphRecord>("inv-03.work-graphs").get(context, graph.graph_ref);
    if (graph_record.status !== "OK" || !graph_record.data) return propagateFailure<GraphActivationCandidate>(graph_record);
    return createOperationResult({status:"OK",correlation_id:context.correlation_id,data:{request,plan,plan_record:plan_record.data,graph,graph_record:graph_record.data}});
  },
};

function makeEvent(
  event_ref: ObjectRef,
  event_type: string,
  producer_engine: "INV-03",
  object_ref: ObjectRef,
  scope_ref: RequestContext["scope_ref"],
  context: RequestContext,
  occurred_at: string,
  payload: unknown,
): DomainEventEnvelope {
  return {
    event_id: event_ref.object_id,
    event_type,
    schema_version: 1,
    occurred_at,
    producer_engine,
    object_ref,
    scope_ref,
    correlation_id: context.correlation_id,
    actor_ref: context.actor_ref,
    payload,
  };
}

/**
 * Persists a Plan revision and the Plan's current-revision pointer atomically.
 * A subsequent revision must supersede the exact currently accepted revision.
 */
export async function submitPlanRevision(
  unitOfWork: EngineUnitOfWorkPort,
  command: SubmitPlanRevisionCommand,
): Promise<OperationResult<PlanRevision>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }

  const created = createPlanRevision(command);
  if (!created.ok) {
    return rejected(
      mapDomainCode(created.issues[0].code),
      created.issues.map((issue) => issue.safe_message).join("; "),
      correlation_id,
    );
  }

  const revision = created.value;
  return unitOfWork.execute(command.context, async (transaction) => {
    const priorResult = await transaction.idempotency.get<PlanRevision>(
      command.context,
      command.context.idempotency_key!,
    );
    if (priorResult.status !== "OK") return propagateFailure<PlanRevision>(priorResult);
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Plan revision", correlation_id);
      }
      return priorResult.data.result;
    }

    const plans = transaction.repository<PlanRecord>("inv-03.plans");
    const revisions = transaction.repository<PlanRevision>("inv-03.plan-revisions");

    let planRecordVersion: string | undefined;
    let nextPlanRecord: PlanRecord;

    if (revision.revision_number === 1) {
      nextPlanRecord = {
        plan_ref: revision.plan_ref,
        work_ref: revision.work_ref,
        created_by: command.context.actor_ref,
        created_at: revision.created_at,
        latest_revision_ref: revision.plan_revision_ref,
      };
      const recordCreated = await plans.create(command.context, revision.plan_ref, nextPlanRecord);
      if (recordCreated.status !== "OK" || !recordCreated.data) {
        return propagateFailure<PlanRevision>(recordCreated);
      }
      if (!recordCreated.object_version) {
        return rejected("INTERNAL_ERROR", "Plan repository did not return its initial storage version", correlation_id);
      }
      planRecordVersion = recordCreated.object_version;
    } else {
      if (!command.expected_plan_version || !revision.prior_revision_ref) {
        return rejected("VALIDATION_ERROR", "Updating a Plan requires expected_plan_version and prior_revision_ref", correlation_id);
      }
      const currentPlan = await plans.get(command.context, revision.plan_ref);
      if (currentPlan.status !== "OK" || !currentPlan.data) {
        return propagateFailure<PlanRevision>(currentPlan);
      }
      if (
        !sameRef(currentPlan.data.plan_ref, revision.plan_ref) ||
        !sameRef(currentPlan.data.work_ref, revision.work_ref) ||
        !sameRef(currentPlan.data.latest_revision_ref, revision.prior_revision_ref)
      ) {
        return rejected("VERSION_CONFLICT", "Plan's latest revision pointer changed; reload before submitting a new revision", correlation_id);
      }
      const priorRevision = await revisions.get(command.context, revision.prior_revision_ref);
      if (priorRevision.status !== "OK" || !priorRevision.data) {
        return propagateFailure<PlanRevision>(priorRevision);
      }
      const replaceableStates: readonly PlanRevisionState[] = [
        "ACCEPTED",
        "REJECTED",
        "WITHDRAWN",
      ];
      if (
        !sameRef(priorRevision.data.plan_ref, revision.plan_ref) ||
        !sameRef(priorRevision.data.work_ref, revision.work_ref) ||
        priorRevision.data.revision_number + 1 !== revision.revision_number ||
        !replaceableStates.includes(priorRevision.data.state)
      ) {
        return rejected("VERSION_CONFLICT", "New Plan revision must follow the exact latest accepted, rejected or withdrawn revision", correlation_id);
      }
      if (priorRevision.data.state === "ACCEPTED") {
        const superseded = transitionPlanRevision(priorRevision.data, "SUPERSEDED");
        if (!superseded.ok) {
          return rejected("VALIDATION_ERROR", superseded.issues[0].safe_message, correlation_id);
        }
        if (!priorRevision.object_version) {
          return rejected("INTERNAL_ERROR", "Plan revision repository did not return its current storage version", correlation_id);
        }
        const savedPrior = await revisions.update(
          command.context,
          revision.prior_revision_ref,
          priorRevision.object_version,
          superseded.value,
        );
        if (savedPrior.status !== "OK") return propagateFailure<PlanRevision>(savedPrior);
      }

      nextPlanRecord = {
        ...currentPlan.data,
        latest_revision_ref: revision.plan_revision_ref,
      };
      const savedPlan = await plans.update(
        command.context,
        revision.plan_ref,
        command.expected_plan_version,
        nextPlanRecord,
      );
      if (savedPlan.status !== "OK" || !savedPlan.data) {
        return propagateFailure<PlanRevision>(savedPlan);
      }
      if (!savedPlan.object_version) {
        return rejected("INTERNAL_ERROR", "Plan repository did not return its updated storage version", correlation_id);
      }
      planRecordVersion = savedPlan.object_version;
    }

    const persisted = await revisions.create(
      command.context,
      revision.plan_revision_ref,
      revision,
    );
    if (persisted.status !== "OK" || !persisted.data) {
      return propagateFailure<PlanRevision>(persisted);
    }

    const event = makeEvent(
      command.event_ref,
      "planning.plan_revision_submitted",
      "INV-03",
      revision.plan_revision_ref,
      revision.work_ref.scope_ref,
      command.context,
      revision.created_at,
      {
        plan_ref: revision.plan_ref,
        work_ref: revision.work_ref,
        revision_number: revision.revision_number,
        prior_revision_ref: revision.prior_revision_ref,
      },
    );
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<PlanRevision>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: persisted.data,
      object_version: planRecordVersion,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: revision.created_at,
    } satisfies IdempotencyRecord<PlanRevision>);
    if (recorded.status !== "OK") return propagateFailure<PlanRevision>(recorded);
    return result;
  });
}

/**
 * Persists a Plan review/lifecycle transition with an optimistic storage
 * version. ACCEPTED and REJECTED outcomes require the domain's review decision.
 */
export async function reviewPlanRevision(
  unitOfWork: EngineUnitOfWorkPort,
  command: ReviewPlanRevisionCommand,
): Promise<OperationResult<PlanRevision>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  const allowedTargets: readonly PlanRevisionState[] = [
    "UNDER_REVIEW",
    "ACCEPTED",
    "REJECTED",
    "WITHDRAWN",
  ];
  if (
    !isObjectRef(command.plan_revision_ref) ||
    command.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
    !command.expected_revision_version.trim() ||
    !allowedTargets.includes(command.target_state) ||
    !isTimestamp(command.occurred_at)
  ) {
    return rejected("VALIDATION_ERROR", "Plan review requires a valid revision, expected version and supported target state", correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const priorResult = await transaction.idempotency.get<PlanRevision>(
      command.context,
      command.context.idempotency_key!,
    );
    if (priorResult.status !== "OK") return propagateFailure<PlanRevision>(priorResult);
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Plan review decision", correlation_id);
      }
      return priorResult.data.result;
    }

    const revisions = transaction.repository<PlanRevision>("inv-03.plan-revisions");
    const current = await revisions.get(command.context, command.plan_revision_ref);
    if (current.status !== "OK" || !current.data) {
      return propagateFailure<PlanRevision>(current);
    }
    if (!sameRef(current.data.plan_revision_ref, command.plan_revision_ref)) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository returned a different Plan revision than requested", correlation_id);
    }
    if (
      current.data.work_ref.scope_ref.scope_id !== command.context.scope_ref.scope_id ||
      current.data.work_ref.scope_ref.scope_kind !== command.context.scope_ref.scope_kind
    ) {
      return rejected("FORBIDDEN", "Plan revision is outside the authenticated request scope", correlation_id);
    }
    if (current.object_version !== command.expected_revision_version) {
      return rejected("VERSION_CONFLICT", "Plan revision changed before review; reload before retrying", correlation_id);
    }

    const transitioned = transitionPlanRevision(
      current.data,
      command.target_state,
      command.review_decision_ref,
    );
    if (!transitioned.ok) {
      return rejected(
        mapDomainCode(transitioned.issues[0].code),
        transitioned.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const updated = await revisions.update(
      command.context,
      command.plan_revision_ref,
      command.expected_revision_version,
      transitioned.value,
    );
    if (updated.status !== "OK" || !updated.data) {
      return propagateFailure<PlanRevision>(updated);
    }
    if (!updated.object_version) {
      return rejected("INTERNAL_ERROR", "Plan revision repository did not return its updated storage version", correlation_id);
    }

    const event = makeEvent(
      command.event_ref,
      "planning.plan_revision_state_changed",
      "INV-03",
      updated.data.plan_revision_ref,
      updated.data.work_ref.scope_ref,
      command.context,
      command.occurred_at,
      {
        plan_ref: updated.data.plan_ref,
        prior_state: current.data.state,
        state: updated.data.state,
        review_decision_ref: command.review_decision_ref,
      },
    );
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<PlanRevision>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: updated.data,
      object_version: updated.object_version,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.occurred_at,
    });
    if (recorded.status !== "OK") return propagateFailure<PlanRevision>(recorded);
    return result;
  });
}

/**
 * Persists a Graph revision only when its source Plan revision is the Plan's
 * current accepted revision. Graph, Work and Plan lineage are pinned exactly.
 */
export async function submitGraphRevision(
  unitOfWork: EngineUnitOfWorkPort,
  command: SubmitGraphRevisionCommand,
): Promise<OperationResult<WorkGraphRevision>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  if (!command.expected_plan_version?.trim()) {
    return rejected("VALIDATION_ERROR", "Graph submission requires expected_plan_version", correlation_id);
  }

  const created = createGraphRevision(command);
  if (!created.ok) {
    return rejected(
      mapDomainCode(created.issues[0].code),
      created.issues.map((issue) => issue.safe_message).join("; "),
      correlation_id,
    );
  }
  const revision = created.value;

  return unitOfWork.execute(command.context, async (transaction) => {
    const priorResult = await transaction.idempotency.get<WorkGraphRevision>(
      command.context,
      command.context.idempotency_key!,
    );
    if (priorResult.status !== "OK") return propagateFailure<WorkGraphRevision>(priorResult);
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Graph revision", correlation_id);
      }
      return priorResult.data.result;
    }

    const plan = await transaction.repository<PlanRevision>("inv-03.plan-revisions")
      .get(command.context, revision.source_plan_revision_ref);
    if (plan.status !== "OK" || !plan.data) {
      return propagateFailure<WorkGraphRevision>(plan);
    }
    if (
      !sameRef(plan.data.plan_revision_ref, revision.source_plan_revision_ref) ||
      !sameRef(plan.data.work_ref, revision.work_ref) ||
      plan.data.state !== "ACCEPTED"
    ) {
      return rejected("VALIDATION_ERROR", "Graph revision must reference the exact accepted Plan revision for this Work", correlation_id);
    }

    const plans = await transaction.repository<PlanRecord>("inv-03.plans")
      .get(command.context, plan.data.plan_ref);
    if (plans.status !== "OK" || !plans.data) {
      return propagateFailure<WorkGraphRevision>(plans);
    }
    if (
      plans.object_version !== command.expected_plan_version ||
      !sameRef(plans.data.plan_ref, plan.data.plan_ref) ||
      !sameRef(plans.data.work_ref, revision.work_ref) ||
      !sameRef(plans.data.latest_revision_ref, plan.data.plan_revision_ref)
    ) {
      return rejected("VERSION_CONFLICT", "Graph source Plan is stale or no longer the latest accepted revision", correlation_id);
    }

    const graphRecords = transaction.repository<WorkGraphRecord>("inv-03.work-graphs");
    const graphRevisions = transaction.repository<WorkGraphRevision>("inv-03.graph-revisions");
    let graphRecordVersion: string | undefined;

    if (revision.revision_number === 1) {
      const record: WorkGraphRecord = {
        graph_ref: revision.graph_ref,
        work_ref: revision.work_ref,
        created_by: command.context.actor_ref,
        created_at: revision.created_at,
        latest_revision_ref: revision.graph_revision_ref,
      };
      const savedRecord = await graphRecords.create(command.context, revision.graph_ref, record);
      if (savedRecord.status !== "OK" || !savedRecord.data) {
        return propagateFailure<WorkGraphRevision>(savedRecord);
      }
      if (!savedRecord.object_version) {
        return rejected("INTERNAL_ERROR", "Work Graph repository did not return its initial storage version", correlation_id);
      }
      graphRecordVersion = savedRecord.object_version;
    } else {
      if (!command.expected_graph_version || !revision.prior_revision_ref) {
        return rejected("VALIDATION_ERROR", "Updating a Work Graph requires expected_graph_version and prior_revision_ref", correlation_id);
      }
      const currentRecord = await graphRecords.get(command.context, revision.graph_ref);
      if (currentRecord.status !== "OK" || !currentRecord.data) {
        return propagateFailure<WorkGraphRevision>(currentRecord);
      }
      if (
        !sameRef(currentRecord.data.graph_ref, revision.graph_ref) ||
        !sameRef(currentRecord.data.work_ref, revision.work_ref) ||
        !sameRef(currentRecord.data.latest_revision_ref, revision.prior_revision_ref)
      ) {
        return rejected("VERSION_CONFLICT", "Work Graph's latest revision pointer changed; reload before submitting a new revision", correlation_id);
      }
      const priorGraph = await graphRevisions.get(command.context, revision.prior_revision_ref);
      if (priorGraph.status !== "OK" || !priorGraph.data) {
        return propagateFailure<WorkGraphRevision>(priorGraph);
      }
      if (
        !sameRef(priorGraph.data.graph_ref, revision.graph_ref) ||
        !sameRef(priorGraph.data.work_ref, revision.work_ref) ||
        priorGraph.data.revision_number + 1 !== revision.revision_number ||
        priorGraph.data.state !== "VALIDATED"
      ) {
        return rejected("VERSION_CONFLICT", "New Graph revision must pin the latest validated Graph revision", correlation_id);
      }
      const nextRecord = {
        ...currentRecord.data,
        latest_revision_ref: revision.graph_revision_ref,
      };
      const savedRecord = await graphRecords.update(
        command.context,
        revision.graph_ref,
        command.expected_graph_version,
        nextRecord,
      );
      if (savedRecord.status !== "OK" || !savedRecord.data) {
        return propagateFailure<WorkGraphRevision>(savedRecord);
      }
      if (!savedRecord.object_version) {
        return rejected("INTERNAL_ERROR", "Work Graph repository did not return its updated storage version", correlation_id);
      }
      graphRecordVersion = savedRecord.object_version;
    }

    const persisted = await graphRevisions.create(
      command.context,
      revision.graph_revision_ref,
      revision,
    );
    if (persisted.status !== "OK" || !persisted.data) {
      return propagateFailure<WorkGraphRevision>(persisted);
    }

    const event = makeEvent(
      command.event_ref,
      "planning.graph_revision_submitted",
      "INV-03",
      revision.graph_revision_ref,
      revision.work_ref.scope_ref,
      command.context,
      revision.created_at,
      {
        graph_ref: revision.graph_ref,
        work_ref: revision.work_ref,
        source_plan_revision_ref: revision.source_plan_revision_ref,
        revision_number: revision.revision_number,
        node_count: revision.nodes.length,
        edge_count: revision.edges.length,
      },
    );
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<WorkGraphRevision>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: persisted.data,
      object_version: graphRecordVersion,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: revision.created_at,
    });
    if (recorded.status !== "OK") return propagateFailure<WorkGraphRevision>(recorded);
    return result;
  });
}

/**
 * Validates a persisted Graph revision, stores the validation result and marks
 * the revision VALIDATED only when domain validation and any required review
 * evidence permit it. A failed validation remains available for inspection.
 */
export async function validateAndRecordGraph(
  unitOfWork: EngineUnitOfWorkPort,
  command: ValidateGraphApplicationCommand,
): Promise<OperationResult<GraphValidationApplicationResult>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  if (
    !isObjectRef(command.graph_revision_ref) ||
    command.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION" ||
    !command.expected_graph_version?.trim()
  ) {
    return rejected("VALIDATION_ERROR", "Graph validation requires a graph revision and expected graph version", correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const priorResult = await transaction.idempotency.get<GraphValidationApplicationResult>(
      command.context,
      command.context.idempotency_key!,
    );
    if (priorResult.status !== "OK") return propagateFailure<GraphValidationApplicationResult>(priorResult);
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Graph validation", correlation_id);
      }
      return priorResult.data.result;
    }

    const graphs = transaction.repository<WorkGraphRevision>("inv-03.graph-revisions");
    const current = await graphs.get(command.context, command.graph_revision_ref);
    if (current.status !== "OK" || !current.data) {
      return propagateFailure<GraphValidationApplicationResult>(current);
    }
    if (!sameRef(current.data.graph_revision_ref, command.graph_revision_ref)) {
      return rejected("INTEGRITY_OR_UNTRUSTED_INPUT", "Repository returned a different Graph revision than requested", correlation_id);
    }
    if (current.object_version !== command.expected_graph_version) {
      return rejected("VERSION_CONFLICT", "Graph revision changed before validation; reload before retrying", correlation_id);
    }

    const graphRecord = await transaction.repository<WorkGraphRecord>("inv-03.work-graphs")
      .get(command.context, current.data.graph_ref);
    if (graphRecord.status !== "OK" || !graphRecord.data) {
      return propagateFailure<GraphValidationApplicationResult>(graphRecord);
    }
    if (!sameRef(graphRecord.data.latest_revision_ref, current.data.graph_revision_ref)) {
      return rejected("VERSION_CONFLICT", "Only the current latest Graph revision can be validated", correlation_id);
    }

    const validation = validateGraphRevision({
      revision: current.data,
      validation_ref: command.validation_ref,
      validated_at: command.validated_at,
      validator_version: command.validator_version,
      max_nodes: command.max_nodes,
      max_edges: command.max_edges,
    });
    if (!validation.ok) {
      return rejected(
        mapDomainCode(validation.issues[0].code),
        validation.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const applied = applyGraphValidation(
      current.data,
      validation.value,
      command.review_decision_ref,
    );
    const activation_eligible = applied.ok;
    let nextGraph = current.data;
    if (applied.ok) {
      const updated = await graphs.update(
        command.context,
        command.graph_revision_ref,
        command.expected_graph_version,
        applied.value,
      );
      if (updated.status !== "OK" || !updated.data) {
        return propagateFailure<GraphValidationApplicationResult>(updated);
      }
      nextGraph = updated.data;
    }

    const storedValidation = await transaction.appendOnly<GraphValidationResult>(
      "inv-03.graph-validation-results",
    ).append(command.context, validation.value);
    if (storedValidation.status !== "OK") {
      return propagateFailure<GraphValidationApplicationResult>(storedValidation);
    }

    const event = makeEvent(
      command.event_ref,
      activation_eligible ? "planning.graph_validated" : "planning.graph_validation_blocked",
      "INV-03",
      nextGraph.graph_revision_ref,
      nextGraph.work_ref.scope_ref,
      command.context,
      command.validated_at,
      {
        validation_result_ref: validation.value.validation_ref,
        validation_status: validation.value.status,
        activation_eligible,
        review_decision_ref: command.review_decision_ref,
      },
    );
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<GraphValidationApplicationResult>(emitted);

    const data: GraphValidationApplicationResult = {
      graph_revision: nextGraph,
      validation_result: validation.value,
      activation_eligible,
    };
    const result = createOperationResult({
      status: activation_eligible ? "OK" : "PARTIAL",
      correlation_id,
      data,
      ...(activation_eligible ? {} : {
        errors: [createOperationError(
          "VALIDATION_ERROR",
          applied.ok ? "Graph validation did not permit activation" : applied.issues[0].safe_message,
          false,
        )],
      }),
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.validated_at,
    });
    if (recorded.status !== "OK") return propagateFailure<GraphValidationApplicationResult>(recorded);
    return result;
  });
}

/**
 * Records an activation request and emits an outbox event for INV-02. It does
 * not mutate Work: only INV-02 may accept the binding and return its receipt.
 */
export async function requestGraphActivation(
  unitOfWork: EngineUnitOfWorkPort,
  command: RequestGraphActivationCommand,
): Promise<OperationResult<GraphActivationRequest>> {
  const correlation_id = command.context.correlation_id;
  const envelopeIssue = validateEnvelope(
    command.context,
    command.request_fingerprint,
    command.event_ref,
  );
  if (envelopeIssue) {
    return rejected("VALIDATION_ERROR", envelopeIssue, correlation_id);
  }
  if (
    !command.expected_plan_version?.trim() ||
    !command.expected_graph_version?.trim() ||
    !isObjectRef(command.work_ref) ||
    command.work_ref.object_kind !== "WORK" ||
    !isObjectRef(command.plan_revision.plan_revision_ref) ||
    command.plan_revision.plan_revision_ref.object_kind !== "PLAN_REVISION" ||
    !isObjectRef(command.graph_revision.graph_revision_ref) ||
    command.graph_revision.graph_revision_ref.object_kind !== "WORK_GRAPH_REVISION"
  ) {
    return rejected("VALIDATION_ERROR", "Activation requires valid Work, Plan and Graph references with expected record versions", correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const priorResult = await transaction.idempotency.get<GraphActivationRequest>(
      command.context,
      command.context.idempotency_key!,
    );
    if (priorResult.status !== "OK") return propagateFailure<GraphActivationRequest>(priorResult);
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Graph activation request", correlation_id);
      }
      return priorResult.data.result;
    }

    const plan = await transaction.repository<PlanRevision>("inv-03.plan-revisions")
      .get(command.context, command.plan_revision.plan_revision_ref);
    if (plan.status !== "OK" || !plan.data) {
      return propagateFailure<GraphActivationRequest>(plan);
    }
    const graph = await transaction.repository<WorkGraphRevision>("inv-03.graph-revisions")
      .get(command.context, command.graph_revision.graph_revision_ref);
    if (graph.status !== "OK" || !graph.data) {
      return propagateFailure<GraphActivationRequest>(graph);
    }
    const planRecord = await transaction.repository<PlanRecord>("inv-03.plans")
      .get(command.context, command.plan_revision.plan_ref);
    if (planRecord.status !== "OK" || !planRecord.data) {
      return propagateFailure<GraphActivationRequest>(planRecord);
    }
    const graphRecord = await transaction.repository<WorkGraphRecord>("inv-03.work-graphs")
      .get(command.context, command.graph_revision.graph_ref);
    if (graphRecord.status !== "OK" || !graphRecord.data) {
      return propagateFailure<GraphActivationRequest>(graphRecord);
    }

    if (
      !sameRef(plan.data.plan_revision_ref, command.plan_revision.plan_revision_ref) ||
      !sameRef(graph.data.graph_revision_ref, command.graph_revision.graph_revision_ref) ||
      !sameRef(planRecord.data.plan_ref, plan.data.plan_ref) ||
      !sameRef(planRecord.data.work_ref, command.work_ref) ||
      !sameRef(graphRecord.data.graph_ref, graph.data.graph_ref) ||
      !sameRef(graphRecord.data.work_ref, command.work_ref) ||
      planRecord.object_version !== command.expected_plan_version ||
      graphRecord.object_version !== command.expected_graph_version ||
      !sameRef(planRecord.data.latest_revision_ref, plan.data.plan_revision_ref) ||
      !sameRef(graphRecord.data.latest_revision_ref, graph.data.graph_revision_ref)
    ) {
      return rejected("VERSION_CONFLICT", "Activation must reference the latest persisted Plan and Graph revisions", correlation_id);
    }

    const request = createGraphActivationRequest({
      context: command.context,
      request_ref: command.request_ref,
      work_ref: command.work_ref,
      plan_revision: plan.data,
      graph_revision: graph.data,
      expected_work_revision: command.expected_work_revision,
      approval_refs: command.approval_refs,
      review_decision_ref: command.review_decision_ref,
      requested_at: command.requested_at,
    });
    if (!request.ok) {
      return rejected(
        mapDomainCode(request.issues[0].code),
        request.issues.map((issue) => issue.safe_message).join("; "),
        correlation_id,
      );
    }

    const stored = await transaction.appendOnly<GraphActivationRequest>(
      "inv-03.graph-activation-requests",
    ).append(command.context, request.value);
    if (stored.status !== "OK" || !stored.data) {
      return propagateFailure<GraphActivationRequest>(stored);
    }

    const event = makeEvent(
      command.event_ref,
      "planning.graph_activation_requested",
      "INV-03",
      request.value.request_ref,
      command.work_ref.scope_ref,
      command.context,
      command.requested_at,
      {
        work_ref: request.value.work_ref,
        plan_revision_ref: request.value.plan_revision_ref,
        graph_revision_ref: request.value.graph_revision_ref,
        expected_work_revision: request.value.expected_work_revision,
        approval_refs: request.value.approval_refs,
        review_decision_ref: request.value.review_decision_ref,
      },
    );
    const emitted = await transaction.outbox.append(command.context, event);
    if (emitted.status !== "OK") return propagateFailure<GraphActivationRequest>(emitted);

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: stored.data,
      object_version: stored.data.request_ref.object_version,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: command.requested_at,
    });
    if (recorded.status !== "OK") return propagateFailure<GraphActivationRequest>(recorded);
    return result;
  });
}
