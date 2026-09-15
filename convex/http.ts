import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { validatePatient } from "./validation";
import { handleToolCalls } from "./vapiTools";

const randomUUID = () => crypto.randomUUID();

const http = httpRouter();

// Vapi calls this when the voice agent invokes a tool mid-call.
http.route({
  path: "/vapi/tool-calls",
  method: "POST",
  handler: handleToolCalls,
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
const ok = (data: unknown, status = 200) => json({ data, error: null }, status);
const fail = (error: unknown, status: number) => json({ data: null, error }, status);

// GET /patients?last_name=&date_of_birth=&phone_number=
http.route({
  path: "/patients",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const patients = await ctx.runQuery(api.patients.list, {
      last_name: url.searchParams.get("last_name") ?? undefined,
      date_of_birth: url.searchParams.get("date_of_birth") ?? undefined,
      phone_number: url.searchParams.get("phone_number") ?? undefined,
    });
    return ok(patients);
  }),
});

// POST /patients
http.route({
  path: "/patients",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return fail("invalid JSON body", 400);
    }

    const errors = validatePatient(body, { partial: false });
    if (errors.length > 0) return fail({ message: "validation failed", fields: errors }, 422);

    const created = await ctx.runMutation(api.patients.create, {
      patient_id: randomUUID(),
      first_name: body.first_name as string,
      last_name: body.last_name as string,
      date_of_birth: body.date_of_birth as string,
      sex: body.sex as "Male" | "Female" | "Other" | "Decline to Answer",
      phone_number: body.phone_number as string,
      email: body.email as string | undefined,
      address_line_1: body.address_line_1 as string,
      address_line_2: body.address_line_2 as string | undefined,
      city: body.city as string,
      state: body.state as string,
      zip_code: body.zip_code as string,
      insurance_provider: body.insurance_provider as string | undefined,
      insurance_member_id: body.insurance_member_id as string | undefined,
      preferred_language: body.preferred_language as string | undefined,
      emergency_contact_name: body.emergency_contact_name as string | undefined,
      emergency_contact_phone: body.emergency_contact_phone as string | undefined,
    });
    return ok(created, 201);
  }),
});

// GET /patients/:id
http.route({
  pathPrefix: "/patients/",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const id = new URL(req.url).pathname.split("/").pop()!;
    const patient = await ctx.runQuery(api.patients.getById, { patient_id: id });
    if (!patient) return fail("patient not found", 404);
    return ok(patient);
  }),
});

// PUT /patients/:id
http.route({
  pathPrefix: "/patients/",
  method: "PUT",
  handler: httpAction(async (ctx, req) => {
    const id = new URL(req.url).pathname.split("/").pop()!;
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return fail("invalid JSON body", 400);
    }

    const errors = validatePatient(body, { partial: true });
    if (errors.length > 0) return fail({ message: "validation failed", fields: errors }, 422);

    const updated = await ctx.runMutation(api.patients.update, {
      patient_id: id,
      patch: body,
    });
    if (!updated) return fail("patient not found", 404);
    return ok(updated);
  }),
});

// DELETE /patients/:id  (soft delete)
http.route({
  pathPrefix: "/patients/",
  method: "DELETE",
  handler: httpAction(async (ctx, req) => {
    const id = new URL(req.url).pathname.split("/").pop()!;
    const result = await ctx.runMutation(api.patients.softDelete, { patient_id: id });
    if (!result) return fail("patient not found", 404);
    return ok({ patient_id: id, deleted: true });
  }),
});

// CORS preflight for the dashboard / any browser-based client
const corsPreflight = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
});
http.route({ path: "/patients", method: "OPTIONS", handler: corsPreflight });
http.route({ pathPrefix: "/patients/", method: "OPTIONS", handler: corsPreflight });

export default http;
