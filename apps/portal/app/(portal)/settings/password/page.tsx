import { KeyRound } from "lucide-react";
import { requireSessionUser } from "@/lib/session";
import { PasswordForm } from "@/components/password-form";
import { changeOwnPassword } from "./actions";

export default async function PasswordSettingsPage() {
  const user = await requireSessionUser();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <KeyRound size={22} /> Change your password
        </h1>
        <p className="text-sm text-base-content/60">
          Signed in as <span className="stack-mono">{user.email}</span>. Changing your password
          signs out every other device, including any session you have open elsewhere.
        </p>
      </header>

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body">
          <PasswordForm
            action={changeOwnPassword}
            requireCurrent
            submitLabel="Change password"
          />
        </div>
      </section>

      <div className="alert alert-info items-start text-left">
        <span className="text-sm">
          There is no self-service &ldquo;forgot password&rdquo; link, on purpose: the portal sends
          no email, so a reset link has to come from an administrator. If you are locked out, ask
          one to issue a reset link from the People page.
        </span>
      </div>
    </div>
  );
}
