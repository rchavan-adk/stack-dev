import { ShieldAlert } from "lucide-react";
import type { SessionUser } from "@/lib/session";

/**
 * Admin pages never crash or redirect for non-admins; they explain.
 * The layout already signs the user in, so this is purely a role check.
 */
export function AdminDenied({ user }: { user: SessionUser }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="alert alert-warning items-start text-left">
        <ShieldAlert className="mt-1 shrink-0" size={20} />
        <div>
          <h2 className="font-semibold">Administration needs lead or admin rights</h2>
          <p className="text-sm">
            You are signed in as {user.name} ({user.role.toLowerCase()}). Sign out and pick a lead or
            admin persona on the login screen, or ask an admin to raise your role.
          </p>
        </div>
      </div>
    </div>
  );
}
