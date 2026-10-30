"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "", label: "Overview" },
  { segment: "waves", label: "Waves" },
  { segment: "issues", label: "Backlog" },
  { segment: "harness", label: "Harness" },
  { segment: "evidence", label: "Evidence" },
];

/** Only a github-provider repository has an app to register. */
const GITHUB_TAB = { segment: "github-setup", label: "GitHub" };

export function ProjectTabs({
  projectKey,
  showGithub = false,
}: {
  projectKey: string;
  showGithub?: boolean;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectKey}`;
  const tabs = showGithub ? [...TABS, GITHUB_TAB] : TABS;

  return (
    <div role="tablist" className="tabs tabs-border">
      {tabs.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment
          ? pathname.startsWith(href)
          : pathname === base || pathname === `${base}/`;
        return (
          <Link
            key={tab.label}
            role="tab"
            href={href}
            className={`tab ${active ? "tab-active font-medium" : ""}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
