"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { CopyButton } from "./copy-button";

export interface InviteState {
  status: "idle" | "created" | "error";
  /** The single-use link, returned exactly once and never stored in the clear. */
  inviteUrl?: string;
  name?: string;
  email?: string;
  expiresAt?: string;
  message?: string;
}

export const IDLE_INVITE_STATE: InviteState = { status: "idle" };

const ROLES = [
  { value: "DEVELOPER", label: "developer — pull work, report status" },
  { value: "LEAD", label: "lead — planner tools, approvals" },
  { value: "CLIENT", label: "client — read-only view" },
  { value: "ADMIN", label: "admin — everything, including people" },
];

/**
 * Invite a person. The portal sends no email, so the link is shown here to be
 * handed over however the team already talks to each other. That is a deliberate
 * limit rather than an oversight: adding an email provider is a separate
 * decision, and this works without one.
 */
export function InvitePersonForm({
  action,
}: {
  action: (state: InviteState, formData: FormData) => Promise<InviteState>;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_INVITE_STATE);

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Name</legend>
          <input name="name" className="input input-sm w-full" placeholder="Meera Iyer" required />
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Email</legend>
          <input
            name="email"
            type="email"
            className="input input-sm w-full"
            placeholder="meera.iyer@miraclesoft.com"
            required
          />
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Role</legend>
          <select name="role" className="select select-sm w-full" defaultValue="DEVELOPER">
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Title (optional)</legend>
          <input name="title" className="input input-sm w-full" placeholder="Senior engineer" />
        </fieldset>

        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary btn-sm gap-1" disabled={pending}>
            <UserPlus size={16} />
            {pending ? "Inviting…" : "Create invitation"}
          </button>
        </div>
      </form>

      {state.status === "error" && (
        <div className="alert alert-error text-sm">
          <span>{state.message}</span>
        </div>
      )}

      {state.status === "created" && state.inviteUrl && (
        <div className="alert alert-warning items-start text-left">
          <UserPlus className="mt-1 shrink-0" size={20} />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h3 className="font-semibold">
                Invitation for {state.name} — hand this link over now
              </h3>
              <p className="text-sm">
                {state.email} cannot sign in until they open it. The portal stores only a hash of
                the token, so the link cannot be shown again; if it is lost, revoke the invitation
                and make a new one. It expires {state.expiresAt}.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code min-w-0 flex-1 text-xs">
                <pre>
                  <code>{state.inviteUrl}</code>
                </pre>
              </div>
              <CopyButton text={state.inviteUrl} className="btn-sm shrink-0" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
