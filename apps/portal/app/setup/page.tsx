import { redirect } from "next/navigation";
import { prisma } from "@stack/db";
import { ShieldCheck } from "lucide-react";
import { BrandOnDark } from "@/components/brand";
import { MIN_PASSWORD_LENGTH } from "@stack/core";
import { createFirstAdmin } from "./actions";

/**
 * Reachable only while this deployment has no users. Once the first
 * administrator exists, every other account is created from the portal.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await prisma.user.count()) redirect("/login");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-200 p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="miracle-gradient rounded-box p-5">
          <BrandOnDark compact />
        </div>

        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-4">
            <div>
              <h1 className="card-title text-xl">
                <ShieldCheck size={20} /> Set up this deployment
              </h1>
              <p className="text-sm text-base-content/60">
                Nobody has an account here yet. Create the first administrator; everyone else is
                invited from the portal afterwards, on the People page.
              </p>
            </div>

            {error && (
              <div className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}

            <form action={createFirstAdmin} className="space-y-3">
              <fieldset className="fieldset">
                <legend className="fieldset-legend text-xs">Name</legend>
                <input name="name" required className="input input-bordered w-full" />
              </fieldset>
              <fieldset className="fieldset">
                <legend className="fieldset-legend text-xs">Email</legend>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="username"
                  className="input input-bordered w-full"
                />
              </fieldset>
              <fieldset className="fieldset">
                <legend className="fieldset-legend text-xs">Password</legend>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  className="input input-bordered w-full"
                />
                <p className="label text-xs">At least {MIN_PASSWORD_LENGTH} characters.</p>
              </fieldset>
              <fieldset className="fieldset">
                <legend className="fieldset-legend text-xs">Confirm password</legend>
                <input
                  type="password"
                  name="confirm"
                  required
                  autoComplete="new-password"
                  className="input input-bordered w-full"
                />
              </fieldset>
              <button type="submit" className="btn btn-primary w-full">
                Create administrator and sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
