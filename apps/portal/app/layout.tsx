import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stack AI · Miracle Software Systems",
  description:
    "Stack AI is the system of record between the planner ecosystem and the developer ecosystem.",
};

// Every page is rendered per request. Two reasons: each one reads the session
// cookie, so none of them can be shared between users; and a container build
// must not need a database connection, which prerendering would require.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="miracle">
      <body className="min-h-screen bg-base-200 text-base-content antialiased">{children}</body>
    </html>
  );
}
