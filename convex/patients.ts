import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, parseDate } from "./validation";

function canonicalDateOfBirth(raw: string): string {
  const iso = parseDate(raw);
  if (!iso) throw new Error(`invalid date_of_birth: ${raw}`);
  return iso;
}

const patientFields = {
  first_name: v.string(),
  last_name: v.string(),
  date_of_birth: v.string(),
  sex: v.union(
    v.literal("Male"),
    v.literal("Female"),
    v.literal("Other"),
    v.literal("Decline to Answer")
  ),
  phone_number: v.string(),
  email: v.optional(v.string()),
  address_line_1: v.string(),
  address_line_2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  zip_code: v.string(),
  insurance_provider: v.optional(v.string()),
  insurance_member_id: v.optional(v.string()),
  preferred_language: v.optional(v.string()),
  emergency_contact_name: v.optional(v.string()),
  emergency_contact_phone: v.optional(v.string()),
};

export const create = mutation({
  args: { patient_id: v.string(), ...patientFields },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("patients", {
      ...args,
      date_of_birth: canonicalDateOfBirth(args.date_of_birth),
      state: args.state.toUpperCase(),
      phone_number: normalizePhone(args.phone_number),
      emergency_contact_phone: args.emergency_contact_phone
        ? normalizePhone(args.emergency_contact_phone)
        : undefined,
      preferred_language: args.preferred_language ?? "English",
      created_at: now,
      updated_at: now,
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    patient_id: v.string(),
    patch: v.object({
      first_name: v.optional(v.string()),
      last_name: v.optional(v.string()),
      date_of_birth: v.optional(v.string()),
      sex: v.optional(
        v.union(
          v.literal("Male"),
          v.literal("Female"),
          v.literal("Other"),
          v.literal("Decline to Answer")
        )
      ),
      phone_number: v.optional(v.string()),
      email: v.optional(v.string()),
      address_line_1: v.optional(v.string()),
      address_line_2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zip_code: v.optional(v.string()),
      insurance_provider: v.optional(v.string()),
      insurance_member_id: v.optional(v.string()),
      preferred_language: v.optional(v.string()),
      emergency_contact_name: v.optional(v.string()),
      emergency_contact_phone: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { patient_id, patch }) => {
    const existing = await ctx.db
      .query("patients")
      .withIndex("by_patient_id", (q) => q.eq("patient_id", patient_id))
      .unique();
    if (!existing || existing.deleted_at) return null;

    const normalizedPatch = { ...patch } as Record<string, unknown>;
    if (patch.phone_number) normalizedPatch.phone_number = normalizePhone(patch.phone_number);
    if (patch.emergency_contact_phone)
      normalizedPatch.emergency_contact_phone = normalizePhone(patch.emergency_contact_phone);
    if (patch.state) normalizedPatch.state = patch.state.toUpperCase();
    if (patch.date_of_birth) normalizedPatch.date_of_birth = canonicalDateOfBirth(patch.date_of_birth);

    await ctx.db.patch(existing._id, { ...normalizedPatch, updated_at: Date.now() });
    return await ctx.db.get(existing._id);
  },
});

export const softDelete = mutation({
  args: { patient_id: v.string() },
  handler: async (ctx, { patient_id }) => {
    const existing = await ctx.db
      .query("patients")
      .withIndex("by_patient_id", (q) => q.eq("patient_id", patient_id))
      .unique();
    if (!existing || existing.deleted_at) return null;
    await ctx.db.patch(existing._id, { deleted_at: Date.now(), updated_at: Date.now() });
    return true;
  },
});

export const getById = query({
  args: { patient_id: v.string() },
  handler: async (ctx, { patient_id }) => {
    const p = await ctx.db
      .query("patients")
      .withIndex("by_patient_id", (q) => q.eq("patient_id", patient_id))
      .unique();
    if (!p || p.deleted_at) return null;
    return p;
  },
});

export const getByPhone = query({
  args: { phone_number: v.string() },
  handler: async (ctx, { phone_number }) => {
    const normalized = normalizePhone(phone_number);
    const p = await ctx.db
      .query("patients")
      .withIndex("by_phone_number", (q) => q.eq("phone_number", normalized))
      .filter((q) => q.eq(q.field("deleted_at"), undefined))
      .first();
    return p;
  },
});

export const list = query({
  args: {
    last_name: v.optional(v.string()),
    date_of_birth: v.optional(v.string()),
    phone_number: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let results;
    if (args.phone_number) {
      const normalized = normalizePhone(args.phone_number);
      results = await ctx.db
        .query("patients")
        .withIndex("by_phone_number", (q) => q.eq("phone_number", normalized))
        .collect();
    } else if (args.last_name) {
      results = await ctx.db
        .query("patients")
        .withIndex("by_last_name", (q) => q.eq("last_name", args.last_name!))
        .collect();
    } else if (args.date_of_birth) {
      results = await ctx.db
        .query("patients")
        .withIndex("by_date_of_birth", (q) =>
          q.eq("date_of_birth", parseDate(args.date_of_birth!) ?? args.date_of_birth!)
        )
        .collect();
    } else {
      results = await ctx.db.query("patients").collect();
    }
    return results.filter((p) => !p.deleted_at);
  },
});
