// Webhook that Vapi calls when the assistant invokes a tool (function) mid-call.
// This is the "Voice Agent <-> Database" bridge from the architecture diagram:
// it dispatches directly into the same mutations/queries the REST API uses,
// rather than looping the call back through our own HTTP API.
import { httpAction, ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { validatePatient } from "./validation";

const randomUUID = () => crypto.randomUUID();

type VapiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: Record<string, unknown> };
};

type Sex = "Male" | "Female" | "Other" | "Decline to Answer";
const str = (v: unknown) => v as string;
const optStr = (v: unknown) => v as string | undefined;

async function handleCreatePatient(ctx: ActionCtx, args: Record<string, unknown>) {
  const errors = validatePatient(args, { partial: false });
  if (errors.length > 0) {
    return { ok: false, message: "validation_failed", fields: errors };
  }
  const created = await ctx.runMutation(api.patients.create, {
    patient_id: randomUUID(),
    first_name: str(args.first_name),
    last_name: str(args.last_name),
    date_of_birth: str(args.date_of_birth),
    sex: str(args.sex) as Sex,
    phone_number: str(args.phone_number),
    email: optStr(args.email),
    address_line_1: str(args.address_line_1),
    address_line_2: optStr(args.address_line_2),
    city: str(args.city),
    state: str(args.state),
    zip_code: str(args.zip_code),
    insurance_provider: optStr(args.insurance_provider),
    insurance_member_id: optStr(args.insurance_member_id),
    preferred_language: optStr(args.preferred_language),
    emergency_contact_name: optStr(args.emergency_contact_name),
    emergency_contact_phone: optStr(args.emergency_contact_phone),
  });
  return { ok: true, patient: created };
}

async function handleUpdatePatient(ctx: ActionCtx, args: Record<string, unknown>) {
  const { patient_id, ...rawPatch } = args;
  if (!patient_id) return { ok: false, message: "patient_id is required" };
  const errors = validatePatient(rawPatch, { partial: true });
  if (errors.length > 0) {
    return { ok: false, message: "validation_failed", fields: errors };
  }
  const patch: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(rawPatch)) {
    if (value !== undefined) patch[key] = value as string;
  }
  const updated = await ctx.runMutation(api.patients.update, {
    patient_id: str(patient_id),
    patch,
  });
  if (!updated) return { ok: false, message: "patient_not_found" };
  return { ok: true, patient: updated };
}

async function handleLookupByPhone(ctx: ActionCtx, args: Record<string, unknown>) {
  const phone = args.phone_number as string | undefined;
  if (!phone) return { ok: false, message: "phone_number is required" };
  const patient = await ctx.runQuery(api.patients.getByPhone, { phone_number: phone });
  return { ok: true, found: !!patient, patient: patient ?? null };
}

export const handleToolCalls = httpAction(async (ctx, req) => {
  const body = await req.json();
  const toolCalls: VapiToolCall[] = body?.message?.toolCalls ?? [];

  const results = await Promise.all(
    toolCalls.map(async (call) => {
      let result: unknown;
      try {
        switch (call.function.name) {
          case "lookup_patient_by_phone":
            result = await handleLookupByPhone(ctx, call.function.arguments);
            break;
          case "create_patient":
            result = await handleCreatePatient(ctx, call.function.arguments);
            break;
          case "update_patient":
            result = await handleUpdatePatient(ctx, call.function.arguments);
            break;
          default:
            result = { ok: false, message: `unknown tool: ${call.function.name}` };
        }
      } catch (err) {
        result = { ok: false, message: err instanceof Error ? err.message : "internal_error" };
      }
      // Observability: every tool call & outcome logged to stdout (captured by Convex logs).
      console.log("[vapi tool-call]", call.function.name, JSON.stringify(call.function.arguments), "->", JSON.stringify(result));
      return { toolCallId: call.id, result: JSON.stringify(result) };
    })
  );

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
