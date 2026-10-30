import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { PasswordForm } from "@/components/password-form";
import { lookupInvite } from "@/lib/invites";
import { acceptInvite } from "./actions";

/**
 * Where an invitation or reset link lands.
 *
 * Public by design: the person following the link has no session yet, which is
 * the entire point. The token in the URL is the credential, so nothing else on
 * this page is sensitive, and a dead link says so plainly rather than pretending
 * the page does not exist.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupInvite(token);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div className="flex justify-center">
        <Brand />
      </div>

      {!found.ok ? (
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-3">
            <h1 className="card-title flex items-center gap-2 text-lg">
              <AlertTriangle className="text-warning" size={20} /> This link cannot be used
            </h1>
            <p className="text-sm text-base-content/70">
              {found.reason === "used"
                ? "It has already been used to set a password. If that was not you, ask an administrator to reset the account and sign out everywhere."
                : found.reason === "expired"
                  ? "It has expired. Invitations last seven days and reset links last an hour."
                  : "It is not a valid link. Check that the whole URL was copied, including everything after /invite/."}
            </p>
            <div className="card-actions justify-end">
              <Link href="/login" className="btn btn-ghost btn-sm">
                Go to sign in
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-4">
            <header className="space-y-1">
              <h1 className="card-title flex items-center gap-2 text-lg">
                <ShieldCheck className="text-primary" size={20} />
                {found.invite.kind === "RESET" ? "Choose a new password" : "Set your password"}
              </h1>
              <p className="text-sm text-base-content/70">
                {found.invite.kind === "RESET" ? (
                  <>
                    Setting a new password for{" "}
                    <span className="stack-mono">{found.user.email}</span> signs out every other
                    device.
                  </>
                ) : (
                  <>
                    Welcome, {found.user.name}. You are joining as{" "}
                    <span className="stack-mono">{found.user.role.toLowerCase()}</span>. Choose a
                    password to activate <span className="stack-mono">{found.user.email}</span>.
                  </>
                )}
              </p>
            </header>

            <PasswordForm
              action={acceptInvite}
              submitLabel={found.invite.kind === "RESET" ? "Set new password" : "Activate my account"}
              hidden={{ token }}
            />

            <p className="text-xs text-base-content/50">
              This link works once. After this it cannot be reused, even by you.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
