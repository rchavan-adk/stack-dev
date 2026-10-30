"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { CopyButton } from "./copy-button";
import type { InviteState } from "./invite-person-form";

/**
 * The per-person control on the People page. A reset link is a live credential
 * for an account that already exists, so it is shown once and never stored in
 * the clear, exactly like an invitation.
 */
export function ResetLinkForm({
  action,
  userId,
  label = "Reset link",
}: {
  action: (state: InviteState, formData: FormData) => Promise<InviteState>;
  userId: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as InviteState);

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <button type="submit" className="btn btn-ghost btn-xs gap-1" disabled={pending}>
          <KeyRound size={14} />
          {pending ? "Working…" : label}
        </button>
      </form>

      {state.status === "error" && (
        <p className="text-xs text-error">{state.message}</p>
      )}

      {state.status === "created" && state.inviteUrl && (
        <div className="w-full space-y-2 rounded-box border border-warning/40 bg-warning/5 p-2">
          <p className="text-xs">{state.message ?? `Link for ${state.name}, expires ${state.expiresAt}.`}</p>
          <div className="flex items-start gap-1">
            <div className="mockup-code min-w-0 flex-1 text-[10px]">
              <pre>
                <code>{state.inviteUrl}</code>
              </pre>
            </div>
            <CopyButton text={state.inviteUrl} className="btn-xs shrink-0" />
          </div>
        </div>
      )}
    </div>
  );
}
