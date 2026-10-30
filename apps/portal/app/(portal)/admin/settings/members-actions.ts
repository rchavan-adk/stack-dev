"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canAdminister, requireSessionUser } from "@/lib/session";
import { addMember, removeMember } from "@/lib/members";

function backTo(projectKey: string, query: string): string {
  return `/admin/settings?project=${encodeURIComponent(projectKey)}&${query}`;
}

/**
 * The settings page only hides the form from non-leads; these actions are the
 * real gate, and they re-check the role before they touch a membership.
 */
export async function addMemberAction(projectId: string, projectKey: string, formData: FormData) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) redirect("/admin/settings");

  const result = await addMember({
    projectId,
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") ?? ""),
    actor: { id: user.id, name: user.name, role: user.role },
  });

  revalidatePath("/admin/settings");
  revalidatePath(`/projects/${projectKey}`);

  if (!result.ok) redirect(backTo(projectKey, `error=${encodeURIComponent(result.reason)}`));
  redirect(backTo(projectKey, "saved=member"));
}

export async function removeMemberAction(
  projectId: string,
  projectKey: string,
  membershipId: string,
) {
  const user = await requireSessionUser();
  if (!canAdminister(user.role)) redirect("/admin/settings");

  const result = await removeMember({
    projectId,
    membershipId,
    actor: { id: user.id, name: user.name, role: user.role },
  });

  revalidatePath("/admin/settings");
  revalidatePath(`/projects/${projectKey}`);

  if (!result.ok) redirect(backTo(projectKey, `error=${encodeURIComponent(result.reason)}`));
  redirect(backTo(projectKey, "saved=member-removed"));
}
