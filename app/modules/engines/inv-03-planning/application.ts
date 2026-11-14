import {
  createOperationError,
  createOperationResult,
  isObjectRef,
  isRequestContext,
  type DomainEventEnvelope,
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
    expected_graph_version?: string;
  };

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
    if (priorResult.status !== "OK") return priorResult as OperationResult<PlanRevision>;
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
        return recordCreated as OperationResult<PlanRevision>;
      }
      planRecordVersion = recordCreated.object_version;
    } else {
      if (!command.expected_plan_version || !revision.prior_revision_ref) {
        return rejected("VALIDATION_ERROR", "Updating a Plan requires expected_plan_version and prior_revision_ref", correlation_id);
      }
      const currentPlan = await plans.get(command.context, revision.plan_ref);
      if (currentPlan.status !== "OK" || !currentPlan.data) {
        return currentPlan as OperationResult<PlanRevision>;
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
        return priorRevision as OperationResult<PlanRevision>;
      }
      if (
        !sameRef(priorRevision.data.plan_ref, revision.plan_ref) ||
        !sameRef(priorRevision.data.work_ref, revision.work_ref) ||
        priorRevision.data.revision_number + 1 !== revision.revision_number ||
        priorRevision.data.state !== "ACCEPTED"
      ) {
        return rejected("VERSION_CONFLICT", "New Plan revision must supersede the exact latest accepted revision", correlation_id);
      }
      const superseded = transitionPlanRevision(priorRevision.data, "SUPERSEDED");
      if (!superseded.ok) {
        return rejected("VALIDATION_ERROR", superseded.issues[0].safe_message, correlation_id);
      }
      const savedPrior = await revisions.update(
        command.context,
        revision.prior_revision_ref,
        revision.prior_revision_ref.object_version ?? String(priorRevision.data.revision_number),
        superseded.value,
      );
      if (savedPrior.status !== "OK") return savedPrior as OperationResult<PlanRevision>;

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
        return savedPlan as OperationResult<PlanRevision>;
      }
      planRecordVersion = savedPlan.object_version;
    }

    const persisted = await revisions.create(
      command.context,
      revision.plan_revision_ref,
      revision,
    );
    if (persisted.status !== "OK" || !persisted.data) {
      return persisted as OperationResult<PlanRevision>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<PlanRevision>;

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: persisted.data,
      object_version: planRecordVersion ?? persisted.object_version,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: revision.created_at,
    } satisfies IdempotencyRecord<PlanRevision>);
    if (recorded.status !== "OK") return recorded as OperationResult<PlanRevision>;
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
    if (priorResult.status !== "OK") return priorResult as OperationResult<WorkGraphRevision>;
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Graph revision", correlation_id);
      }
      return priorResult.data.result;
    }

    const plan = await transaction.repository<PlanRevision>("inv-03.plan-revisions")
      .get(command.context, revision.source_plan_revision_ref);
    if (plan.status !== "OK" || !plan.data) {
      return plan as OperationResult<WorkGraphRevision>;
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
      return plans as OperationResult<WorkGraphRevision>;
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
        return savedRecord as OperationResult<WorkGraphRevision>;
      }
      graphRecordVersion = savedRecord.object_version;
    } else {
      if (!command.expected_graph_version || !revision.prior_revision_ref) {
        return rejected("VALIDATION_ERROR", "Updating a Work Graph requires expected_graph_version and prior_revision_ref", correlation_id);
      }
      const currentRecord = await graphRecords.get(command.context, revision.graph_ref);
      if (currentRecord.status !== "OK" || !currentRecord.data) {
        return currentRecord as OperationResult<WorkGraphRevision>;
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
        return priorGraph as OperationResult<WorkGraphRevision>;
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
        return savedRecord as OperationResult<WorkGraphRevision>;
      }
      graphRecordVersion = savedRecord.object_version;
    }

    const persisted = await graphRevisions.create(
      command.context,
      revision.graph_revision_ref,
      revision,
    );
    if (persisted.status !== "OK" || !persisted.data) {
      return persisted as OperationResult<WorkGraphRevision>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<WorkGraphRevision>;

    const result = createOperationResult({
      status: "OK",
      correlation_id,
      data: persisted.data,
      object_version: graphRecordVersion ?? persisted.object_version,
    });
    const recorded = await transaction.idempotency.record(command.context, {
      idempotency_key: command.context.idempotency_key!,
      request_fingerprint: command.request_fingerprint,
      result,
      recorded_at: revision.created_at,
    });
    if (recorded.status !== "OK") return recorded as OperationResult<WorkGraphRevision>;
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
    if (priorResult.status !== "OK") return priorResult as OperationResult<GraphValidationApplicationResult>;
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Graph validation", correlation_id);
      }
      return priorResult.data.result;
    }

    const graphs = transaction.repository<WorkGraphRevision>("inv-03.graph-revisions");
    const current = await graphs.get(command.context, command.graph_revision_ref);
    if (current.status !== "OK" || !current.data) {
      return current as OperationResult<GraphValidationApplicationResult>;
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
      return graphRecord as OperationResult<GraphValidationApplicationResult>;
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
        return updated as OperationResult<GraphValidationApplicationResult>;
      }
      nextGraph = updated.data;
    }

    const storedValidation = await transaction.appendOnly<GraphValidationResult>(
      "inv-03.graph-validation-results",
    ).append(command.context, validation.value);
    if (storedValidation.status !== "OK") {
      return storedValidation as OperationResult<GraphValidationApplicationResult>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<GraphValidationApplicationResult>;

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
    if (recorded.status !== "OK") return recorded as OperationResult<GraphValidationApplicationResult>;
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
  if (!command.expected_plan_version?.trim() || !command.expected_graph_version?.trim()) {
    return rejected("VALIDATION_ERROR", "Graph activation requires expected Plan and Graph versions", correlation_id);
  }

  return unitOfWork.execute(command.context, async (transaction) => {
    const priorResult = await transaction.idempotency.get<GraphActivationRequest>(
      command.context,
      command.context.idempotency_key!,
    );
    if (priorResult.status !== "OK") return priorResult as OperationResult<GraphActivationRequest>;
    if (priorResult.data) {
      if (priorResult.data.request_fingerprint !== command.request_fingerprint) {
        return rejected("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different Graph activation request", correlation_id);
      }
      return priorResult.data.result;
    }

    const plan = await transaction.repository<PlanRevision>("inv-03.plan-revisions")
      .get(command.context, command.plan_revision.plan_revision_ref);
    if (plan.status !== "OK" || !plan.data) {
      return plan as OperationResult<GraphActivationRequest>;
    }
    const graph = await transaction.repository<WorkGraphRevision>("inv-03.graph-revisions")
      .get(command.context, command.graph_revision.graph_revision_ref);
    if (graph.status !== "OK" || !graph.data) {
      return graph as OperationResult<GraphActivationRequest>;
    }
    const planRecord = await transaction.repository<PlanRecord>("inv-03.plans")
      .get(command.context, command.plan_revision.plan_ref);
    if (planRecord.status !== "OK" || !planRecord.data) {
      return planRecord as OperationResult<GraphActivationRequest>;
    }
    const graphRecord = await transaction.repository<WorkGraphRecord>("inv-03.work-graphs")
      .get(command.context, command.graph_revision.graph_ref);
    if (graphRecord.status !== "OK" || !graphRecord.data) {
      return graphRecord as OperationResult<GraphActivationRequest>;
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
      return stored as OperationResult<GraphActivationRequest>;
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
    if (emitted.status !== "OK") return emitted as OperationResult<GraphActivationRequest>;

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
    if (recorded.status !== "OK") return recorded as OperationResult<GraphActivationRequest>;
    return result;
  });
}
