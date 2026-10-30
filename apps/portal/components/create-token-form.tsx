"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { CopyButton } from "./copy-button";

export interface CreateTokenState {
  status: "idle" | "created" | "error";
  token?: string;
  name?: string;
  message?: string;
}

export const IDLE_TOKEN_STATE: CreateTokenState = { status: "idle" };

interface UserOption {
  id: string;
  name: string;
  role: string;
}

interface ProjectOption {
  id: string;
  key: string;
  name: string;
}

/**
 * The create form for MCP tokens. The server action mints the token and
 * returns the plaintext exactly once; the portal stores only prefix + hash.
 */
export function CreateTokenForm({
  action,
  portalUrl,
  users,
  roles,
  defaultRole,
  projects,
  submitLabel = "Create token",
}: {
  action: (state: CreateTokenState, formData: FormData) => Promise<CreateTokenState>;
  portalUrl: string;
  users?: UserOption[];
  roles: Array<{ value: string; label: string }>;
  defaultRole: string;
  projects: ProjectOption[];
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_TOKEN_STATE);
  const loginCommand = state.token ? `stack login --token ${state.token} --portal ${portalUrl}` : "";

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Token name</legend>
          <input
            name="name"
            className="input input-sm w-full"
            placeholder="Rahul laptop"
            required
          />
        </fieldset>

        {users && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">User</legend>
            <select name="userId" className="select select-sm w-full" required>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.role.toLowerCase()})
                </option>
              ))}
            </select>
          </fieldset>
        )}

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Token role</legend>
          <select name="role" className="select select-sm w-full" defaultValue={defaultRole}>
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Project scope (optional)</legend>
          <select name="projectId" className="select select-sm w-full">
            <option value="">All projects the user can see</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.key} — {project.name}
              </option>
            ))}
          </select>
        </fieldset>

        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            <KeyRound size={16} />
            {pending ? "Creating…" : submitLabel}
          </button>
        </div>
      </form>

      {state.status === "error" && (
        <div className="alert alert-error text-sm">
          <span>{state.message}</span>
        </div>
      )}

      {state.status === "created" && state.token && (
        <div className="alert alert-warning items-start text-left">
          <KeyRound className="mt-1 shrink-0" size={20} />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h3 className="font-semibold">
                Token “{state.name}” created — shown once, never again
              </h3>
              <p className="text-sm">
                The portal stores only a SHA-256 hash and the prefix. Copy it now; nobody, including
                an admin, can recover the full value later.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code min-w-0 flex-1 text-xs">
                <pre>
                  <code>{state.token}</code>
                </pre>
              </div>
              <CopyButton text={state.token} className="btn-sm shrink-0" />
            </div>
            <div className="flex items-start gap-2">
              <div className="mockup-code min-w-0 flex-1 text-xs">
                <pre data-prefix="$">
                  <code>{loginCommand}</code>
                </pre>
              </div>
              <CopyButton text={loginCommand} className="btn-sm shrink-0" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
