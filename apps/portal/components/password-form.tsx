"use client";

import { useActionState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

export interface PasswordState {
  status: "idle" | "error" | "success";
  message?: string;
  /** Changes on every success so the form remounts and the fields clear. */
  resetKey?: number;
}

export const IDLE_PASSWORD_STATE: PasswordState = { status: "idle" };

/**
 * One form for all three password flows: accepting an invitation, resetting with
 * a link, and changing your own password while signed in.
 *
 * `requireCurrent` is what separates them. Changing a password you are already
 * using proves you know it; setting one from a link proves you hold the link
 * instead, so asking for the old password there would be asking for something
 * the person may never have had.
 */
export function PasswordForm({
  action,
  requireCurrent = false,
  submitLabel,
  hidden,
}: {
  action: (state: PasswordState, formData: FormData) => Promise<PasswordState>;
  requireCurrent?: boolean;
  submitLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_PASSWORD_STATE);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4" key={state.resetKey}>
        {hidden &&
          Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

        {requireCurrent && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Current password</legend>
            <input
              name="current"
              type="password"
              className="input input-bordered w-full"
              autoComplete="current-password"
              required
            />
          </fieldset>
        )}

        <fieldset className="fieldset">
          <legend className="fieldset-legend">New password</legend>
          <input
            name="password"
            type="password"
            className="input input-bordered w-full"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <p className="label text-xs">At least 12 characters.</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Confirm new password</legend>
          <input
            name="confirm"
            type="password"
            className="input input-bordered w-full"
            autoComplete="new-password"
            required
          />
        </fieldset>

        <button type="submit" className="btn btn-primary btn-sm gap-1" disabled={pending}>
          {requireCurrent ? <KeyRound size={16} /> : <ShieldCheck size={16} />}
          {pending ? "Saving…" : submitLabel}
        </button>
      </form>

      {state.status === "error" && (
        <div className="alert alert-error text-sm">
          <span>{state.message}</span>
        </div>
      )}

      {state.status === "success" && (
        <div className="alert alert-success text-sm">
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
