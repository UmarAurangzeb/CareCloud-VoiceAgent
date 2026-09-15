import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  patients: defineTable({
    patient_id: v.string(), // UUID, public identifier used by the REST API / voice agent
    first_name: v.string(),
    last_name: v.string(),
    date_of_birth: v.string(), // ISO "YYYY-MM-DD"
    sex: v.union(
      v.literal("Male"),
      v.literal("Female"),
      v.literal("Other"),
      v.literal("Decline to Answer")
    ),
    phone_number: v.string(), // normalized 10-digit, e.g. "5551234567"
    email: v.optional(v.string()),
    address_line_1: v.string(),
    address_line_2: v.optional(v.string()),
    city: v.string(),
    state: v.string(), // 2-letter abbreviation
    zip_code: v.string(),
    insurance_provider: v.optional(v.string()),
    insurance_member_id: v.optional(v.string()),
    preferred_language: v.optional(v.string()),
    emergency_contact_name: v.optional(v.string()),
    emergency_contact_phone: v.optional(v.string()),
    created_at: v.number(), // ms epoch, UTC
    updated_at: v.number(),
    deleted_at: v.optional(v.number()), // soft delete marker
  })
    .index("by_patient_id", ["patient_id"])
    .index("by_phone_number", ["phone_number"])
    .index("by_last_name", ["last_name"])
    .index("by_date_of_birth", ["date_of_birth"]),
});
