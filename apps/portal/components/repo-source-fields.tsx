"use client";

import { useState } from "react";
import { Github, Radio } from "lucide-react";
import { parseGithubRemoteUrl } from "@/lib/github-url";

/**
 * The repository half of the registration form. A github.com remote switches the
 * flow into the GitHub App wizard: the provider becomes "github" and the lead must
 * give the public webhook base URL the tunnel is exposing, because the manifest and
 * the webhook URL are built from it.
 */
export function RepoSourceFields({
  defaultRepoUrl,
  defaultBranch,
}: {
  defaultRepoUrl: string;
  defaultBranch: string;
}) {
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrl);
  const github = parseGithubRemoteUrl(repoUrl);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Git remote</legend>
          <input
            name="repoUrl"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/owner/repo.git"
            className="input input-bordered w-full stack-mono text-sm"
          />
          <p className="label text-xs">The portal reads events only, never the code</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Default branch</legend>
          <input
            name="defaultBranch"
            defaultValue={defaultBranch}
            className="input input-bordered w-full stack-mono"
          />
        </fieldset>
      </div>

      {github && (
        <>
          {/* The wizard declares the provider; the server re-derives it from the URL. */}
          <input type="hidden" name="provider" value="github" />

          <div className="rounded-box border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Github size={18} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium">
                    GitHub repository detected:{" "}
                    <span className="stack-mono">{github.fullName}</span>
                  </p>
                  <p className="text-xs text-base-content/60">
                    The portal registers this repo with provider{" "}
                    <span className="stack-mono">github</span>, generates a webhook secret, and takes
                    you to the GitHub App wizard.
                  </p>
                </div>

                <fieldset className="fieldset">
                  <legend className="fieldset-legend flex items-center gap-2">
                    <Radio size={14} /> Public webhook base URL
                  </legend>
                  <input
                    name="webhookBaseUrl"
                    type="url"
                    required
                    placeholder="https://xxxx.ngrok.app"
                    className="input input-bordered w-full stack-mono text-sm"
                  />
                  <p className="label text-xs">
                    The tunnel that exposes this portal to GitHub — no trailing slash. GitHub posts
                    deliveries to{" "}
                    <span className="stack-mono">&lt;base&gt;/api/git/webhooks/github</span>.
                  </p>
                </fieldset>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
