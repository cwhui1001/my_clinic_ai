import "server-only";

import { AuthenticationError, getVerifiedUser } from "@/src/server/auth/user";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { StaffMembershipDto } from "@/src/types/escalation";

export class StaffAccessError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden" | "database_error") {
    super(code);
  }
}

export async function getStaffMemberships(): Promise<StaffMembershipDto[]> {
  try {
    await getVerifiedUser();
  } catch (error) {
    if (error instanceof AuthenticationError) throw new StaffAccessError("unauthenticated");
    throw new StaffAccessError("database_error");
  }

  const supabase = await createSupabaseServerClient();
  const { data: memberships, error } = await supabase
    .from("clinic_memberships")
    .select("id, clinic_id, role")
    .eq("active", true);
  if (error) throw new StaffAccessError("database_error");
  if (!memberships?.length) throw new StaffAccessError("forbidden");

  const admin = createAdminClient();
  const clinicIds = [...new Set(memberships.map((membership) => membership.clinic_id))];
  const { data: clinics, error: clinicError } = await admin
    .from("clinics")
    .select("id, name")
    .in("id", clinicIds);
  if (clinicError) throw new StaffAccessError("database_error");
  const clinicById = new Map((clinics ?? []).map((clinic) => [clinic.id, clinic.name]));

  return memberships.flatMap((membership): StaffMembershipDto[] => {
    const clinicName = clinicById.get(membership.clinic_id);
    return clinicName ? [{
      id: membership.id,
      clinicId: membership.clinic_id,
      clinicName,
      role: membership.role,
    }] : [];
  });
}
