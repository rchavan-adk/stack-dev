/**
 * Seeds the mock Stack AI portal.
 *
 * Tokens are deterministic so the README and the demo script stay valid between
 * reseeds. That is a mock-only convenience; real tokens are random and shown once.
 */
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@stack/core/src/password";
import { DEFAULT_TEMPLATES, loadPackFromDisk, packChecksum } from "./defaults";

const prisma = new PrismaClient();

/** Local-only. A deployment bootstraps its first admin at /setup instead. */
const DEV_PASSWORD = "stack-dev-password";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const MOCK_GITHUB = join(REPO_ROOT, "mock-github");

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const DEMO_TOKENS = {
  admin: "stk_adm_priya_demo_token_0001",
  lead: "stk_lead_akash_demo_token_001",
  dev: "stk_dev_rahul_demo_token_0001",
  dev2: "stk_dev_meera_demo_token_0001",
  dev3: "stk_dev_vikram_demo_token_0001",
  dev4: "stk_dev_sana_demo_token_0001",
};

const issueBody = (context: string, scope: string, acceptance: string[], outOfScope: string) =>
  [
    "## Context",
    "",
    context,
    "",
    "## Scope",
    "",
    scope,
    "",
    "## Acceptance criteria",
    "",
    ...acceptance.map((item) => `- [ ] ${item}`),
    "",
    "## Out of scope",
    "",
    outOfScope,
    "",
  ].join("\n");

async function main() {
  console.log("seeding Stack AI portal\n");

  // Clean in dependency order so reseeding is safe.
  await prisma.event.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.harnessComponent.deleteMany();
  await prisma.harnessVersion.deleteMany();
  await prisma.harnessPack.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.wave.deleteMany();
  await prisma.repo.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.template.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: {
      email: "priya.nair@miraclesoft.com",
      name: "Priya Nair",
      role: "ADMIN",
      title: "Delivery platform lead",
    },
  });
  const lead = await prisma.user.create({
    data: {
      email: "akash.rao@miraclesoft.com",
      name: "Akash Rao",
      role: "LEAD",
      title: "Engagement lead",
    },
  });
  const dev = await prisma.user.create({
    data: {
      email: "rahul.chavan@miraclesoft.com",
      name: "Rahul Chavan",
      role: "DEVELOPER",
      title: "Senior engineer",
    },
  });
  const dev2 = await prisma.user.create({
    data: {
      email: "meera.iyer@miraclesoft.com",
      name: "Meera Iyer",
      role: "DEVELOPER",
      title: "Engineer",
    },
  });
  const client = await prisma.user.create({
    data: {
      email: "dan.whitfield@acmeretail.com",
      name: "Dan Whitfield",
      role: "CLIENT",
      title: "Acme Retail, VP Engineering",
    },
  });
  // Spare developers with no memberships yet; a lead adds them to a project later.
  const dev3 = await prisma.user.create({
    data: {
      email: "vikram.rao@miraclesoft.com",
      name: "Vikram Rao",
      role: "DEVELOPER",
      title: "Engineer",
    },
  });
  const dev4 = await prisma.user.create({
    data: {
      email: "sana.kulkarni@miraclesoft.com",
      name: "Sana Kulkarni",
      role: "DEVELOPER",
      title: "Engineer",
    },
  });

  // Seeded accounts get a real password hash, so local development exercises
  // the same login path as a deployment instead of a persona shortcut. The
  // login page shows these addresses outside production.
  const devPasswordHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.updateMany({ data: { passwordHash: devPasswordHash } });

  const acme = await prisma.project.create({
    data: {
      key: "ACME",
      name: "Acme Checkout Modernisation",
      client: "Acme Retail",
      summary:
        "Replace the legacy checkout service with a modular order pipeline, fixed bid, three waves.",
      handlePattern: "STACK-[0-9]+",
    },
  });

  const pilot = await prisma.project.create({
    data: {
      key: "MIR",
      name: "Miracle Internal Pilot",
      client: "Miracle Software Systems",
      summary: "Internal pilot that proves the harness and the portal before client rollout.",
      handlePattern: "STACK-[0-9]+",
    },
  });

  for (const [user, role] of [
    [admin, "ADMIN"],
    [lead, "LEAD"],
    [dev, "DEVELOPER"],
    [dev2, "DEVELOPER"],
    [client, "CLIENT"],
  ] as const) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: acme.id, role },
    });
  }
  await prisma.membership.create({ data: { userId: admin.id, projectId: pilot.id, role: "ADMIN" } });
  await prisma.membership.create({ data: { userId: dev.id, projectId: pilot.id, role: "DEVELOPER" } });

  await prisma.repo.create({
    data: {
      projectId: acme.id,
      name: "acme/checkout",
      provider: "mock-github",
      remotePath: join(MOCK_GITHUB, "acme-checkout.git"),
      defaultBranch: "main",
    },
  });

  const wave1 = await prisma.wave.create({
    data: {
      projectId: acme.id,
      number: 1,
      name: "Foundations",
      goal: "Stand up the order service skeleton, CI and the harness on every developer machine.",
      status: "DONE",
      startsOn: new Date("2026-09-01"),
      endsOn: new Date("2026-09-26"),
    },
  });
  const wave2 = await prisma.wave.create({
    data: {
      projectId: acme.id,
      number: 2,
      name: "Checkout core",
      goal: "Order totals, tax and discounts correct to the penny, with acceptance tests per rule.",
      status: "ACTIVE",
      startsOn: new Date("2026-09-29"),
      endsOn: new Date("2026-10-31"),
    },
  });
  const wave3 = await prisma.wave.create({
    data: {
      projectId: acme.id,
      number: 3,
      name: "Payments and receipts",
      goal: "Payment capture, refunds and receipt delivery behind a feature flag.",
      status: "PLANNED",
      startsOn: new Date("2026-11-03"),
      endsOn: new Date("2026-12-12"),
    },
  });
  await prisma.wave.create({
    data: {
      projectId: pilot.id,
      number: 1,
      name: "Harness pilot",
      goal: "Run the Miracle harness on an internal project and measure against the old baseline.",
      status: "ACTIVE",
    },
  });

  const issues = [
    {
      handle: "STACK-100",
      title: "Seed checkout service skeleton",
      wave: wave1,
      status: "DONE",
      assignee: dev,
      type: "CHORE",
      estimate: 2,
      context: "The engagement starts from an empty repository and needs a service skeleton.",
      scope: "src/order.js, tests/run.sh, package.json",
      acceptance: ["Repository builds", "Test runner executes"],
      outOfScope: "Business rules",
    },
    {
      handle: "STACK-101",
      title: "Install the Miracle harness on every developer machine",
      wave: wave1,
      status: "DONE",
      assignee: dev2,
      type: "CHORE",
      estimate: 1,
      context: "Every developer must run the same versioned harness pack on this engagement.",
      scope: "stack.toml, .stack/pack, git hooks",
      acceptance: ["stack doctor passes", "commit without a handle is rejected"],
      outOfScope: "Autonomous agents",
    },
    {
      handle: "STACK-102",
      title: "Order total rounds to two decimals",
      wave: wave2,
      status: "AWAITING_VALIDATION",
      assignee: dev2,
      type: "BUG",
      estimate: 2,
      context:
        "Legacy totals carry floating point noise, so receipts disagree with the payment captured.",
      scope: "src/order.js calculateTotal",
      acceptance: [
        "Total is rounded half up to two decimals",
        "Existing tests still pass",
        "A regression test covers 0.005 boundaries",
      ],
      outOfScope: "Currency conversion",
      prNumber: 41,
      branch: "stack/STACK-102-round-total",
    },
    {
      handle: "STACK-103",
      title: "Apply tax after discounts",
      wave: wave2,
      status: "IN_REVIEW",
      assignee: dev2,
      type: "BUG",
      estimate: 3,
      context: "Tax is currently applied before discounts, which overcharges every promotion.",
      scope: "src/order.js, tests",
      acceptance: [
        "Tax is calculated on the discounted subtotal",
        "Promotion tests cover stacked discounts",
      ],
      outOfScope: "Tax jurisdiction lookup",
      prNumber: 42,
      branch: "stack/STACK-103-tax-after-discount",
    },
    {
      handle: "STACK-104",
      title: "Add line-item tax breakdown to the order total",
      wave: wave2,
      status: "APPROVED",
      assignee: dev,
      type: "FEATURE",
      estimate: 3,
      context:
        "Finance cannot reconcile receipts without a per-line tax breakdown on the order total response.",
      scope: "src/order.js calculateTotal and its tests",
      acceptance: [
        "calculateTotal returns a lines array with per-line tax",
        "Sum of line tax equals the order tax to the penny",
        "tests/run.sh covers a two-line order with mixed tax rates",
      ],
      outOfScope: "Receipt rendering and PDF export",
    },
    {
      handle: "STACK-105",
      title: "Reject negative quantities at the order boundary",
      wave: wave2,
      status: "APPROVED",
      assignee: dev,
      type: "BUG",
      estimate: 1,
      context: "A negative quantity currently produces a credit, which the payment provider rejects.",
      scope: "src/order.js validation",
      acceptance: ["Negative quantity throws a validation error", "Zero quantity is allowed"],
      outOfScope: "Refund flows",
    },
    {
      handle: "STACK-106",
      title: "Discount codes are case insensitive",
      wave: wave2,
      status: "IN_PROGRESS",
      assignee: dev,
      type: "FEATURE",
      estimate: 2,
      context: "Support spends time on tickets caused by lowercase discount codes failing silently.",
      scope: "src/order.js discount lookup",
      acceptance: ["Codes match case insensitively", "Unknown codes still raise a clear error"],
      outOfScope: "Discount administration UI",
    },
    {
      handle: "STACK-107",
      title: "Split shipping from the taxable subtotal",
      wave: wave2,
      status: "BACKLOG",
      assignee: null,
      type: "FEATURE",
      estimate: 3,
      context: "Shipping is taxed in some states and not others, and today it is always taxable.",
      scope: "src/order.js, configuration",
      acceptance: ["Shipping taxability is configurable", "Default keeps current behaviour"],
      outOfScope: "Carrier integration",
    },
    {
      handle: "STACK-108",
      title: "Capture payment intent on checkout",
      wave: wave3,
      status: "BACKLOG",
      assignee: null,
      type: "FEATURE",
      estimate: 5,
      context: "Payments are still handled by the legacy service and must move behind a flag.",
      scope: "src/payment.js, feature flag",
      acceptance: ["Intent is created", "Failures are retried once", "Flag defaults to off"],
      outOfScope: "Refunds",
    },
    {
      handle: "STACK-109",
      title: "Email receipt after capture",
      wave: wave3,
      status: "BACKLOG",
      assignee: null,
      type: "FEATURE",
      estimate: 3,
      context: "Customers need a receipt immediately after a successful capture.",
      scope: "src/receipt.js",
      acceptance: ["Receipt is sent once per capture", "Template passes brand review"],
      outOfScope: "SMS receipts",
    },
  ] as const;

  const issueRecords: Record<string, { id: string; handle: string }> = {};
  for (const item of issues) {
    const created = await prisma.issue.create({
      data: {
        projectId: acme.id,
        waveId: item.wave.id,
        handle: item.handle,
        title: item.title,
        body: issueBody(item.context, item.scope, [...item.acceptance], item.outOfScope),
        type: item.type,
        status: item.status,
        assigneeId: item.assignee?.id ?? null,
        estimate: item.estimate,
        acceptance: JSON.stringify(item.acceptance),
        branch: "branch" in item ? (item as { branch?: string }).branch ?? null : null,
        prNumber: "prNumber" in item ? (item as { prNumber?: number }).prNumber ?? null : null,
      },
    });
    issueRecords[item.handle] = { id: created.id, handle: created.handle };
  }

  await prisma.issue.create({
    data: {
      projectId: pilot.id,
      handle: "STACK-200",
      title: "Measure harness effect on PR review time",
      body: issueBody(
        "The pilot must produce numbers we can compare with the pre-harness baseline.",
        "Reporting scripts",
        ["Baseline captured", "Post-harness numbers captured"],
        "Client engagements",
      ),
      type: "SPIKE",
      status: "APPROVED",
      assigneeId: dev.id,
      estimate: 2,
      acceptance: JSON.stringify(["Baseline captured", "Post-harness numbers captured"]),
    },
  });

  await prisma.spec.create({
    data: {
      projectId: acme.id,
      issueId: issueRecords["STACK-104"].id,
      title: "Line-item tax breakdown",
      status: "APPROVED",
      approvedById: lead.id,
      body: [
        "## Problem",
        "",
        "Finance reconciles receipts line by line, and the order response only carries a single tax total, so any mismatch has to be recomputed by hand.",
        "",
        "## Proposal",
        "",
        "Return a lines array from calculateTotal, each entry carrying quantity, unit price, discounted line subtotal and the tax charged on that line. The order level tax becomes the sum of line tax, computed with half-up rounding at two decimals.",
        "",
        "## Interfaces",
        "",
        "`calculateTotal(order) -> { subtotal, discount, tax, total, lines: [{ sku, quantity, unitPrice, lineSubtotal, taxRate, lineTax }] }`",
        "",
        "## Risks and rollback",
        "",
        "Rounding per line can drift from rounding the order total. Mitigated by asserting the sum equals the order tax. Rollback is removing the lines array, which no client depends on yet.",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] lines array present for every order",
        "- [ ] sum of line tax equals order tax",
        "- [ ] mixed tax rate order covered by a test",
        "",
      ].join("\n"),
    },
  });

  await prisma.template.createMany({
    data: DEFAULT_TEMPLATES.map((template) => ({
      kind: template.kind,
      name: template.name,
      version: template.version,
      definition: JSON.stringify(template.definition),
      active: true,
    })),
  });

  // Harness pack, imported from the source of truth on disk.
  const { manifest, files } = loadPackFromDisk();
  const pack = await prisma.harnessPack.create({
    data: {
      projectId: acme.id,
      name: manifest.name,
      description: manifest.description,
    },
  });

  const checksum = packChecksum(files);

  const published = await prisma.harnessVersion.create({
    data: {
      packId: pack.id,
      version: manifest.version,
      status: "PUBLISHED",
      notes: "First Miracle standards pack: commit handle enforcement.",
      checksum,
      publishedAt: new Date("2026-10-18T09:30:00Z"),
      publishedById: lead.id,
      components: {
        create: files.map((file) => ({
          kind: file.kind,
          path: file.path,
          content: file.content,
          mode: file.mode,
        })),
      },
    },
  });

  // A draft the lead is working on, so the admin builder has something to edit.
  await prisma.harnessVersion.create({
    data: {
      packId: pack.id,
      version: "0.3.0",
      status: "DRAFT",
      notes: "Adds a wave-awareness skill and a stricter PR evidence section.",
      components: {
        create: files.map((file) => ({
          kind: file.kind,
          path: file.path,
          content: file.content,
          mode: file.mode,
        })),
      },
    },
  });

  // Org-level default pack (no project): what a developer installs before a
  // lead publishes a project pack. Same files and checksum as the project pack.
  const defaultPack = await prisma.harnessPack.create({
    data: {
      projectId: null,
      name: "miracle-default",
      description:
        "The Miracle default harness every developer starts with before joining a project.",
    },
  });

  await prisma.harnessVersion.create({
    data: {
      packId: defaultPack.id,
      version: manifest.version,
      status: "PUBLISHED",
      notes: "Default harness: item-handle commits before a project pack exists.",
      checksum,
      publishedAt: new Date("2026-10-17T09:30:00Z"),
      publishedById: lead.id,
      components: {
        create: files.map((file) => ({
          kind: file.kind,
          path: file.path,
          content: file.content,
          mode: file.mode,
        })),
      },
    },
  });

  const tokens = [
    { user: admin, role: "ADMIN", token: DEMO_TOKENS.admin, name: "Priya admin token", project: null },
    { user: lead, role: "LEAD", token: DEMO_TOKENS.lead, name: "Akash planner token", project: acme },
    { user: dev, role: "DEVELOPER", token: DEMO_TOKENS.dev, name: "Rahul laptop", project: acme },
    { user: dev2, role: "DEVELOPER", token: DEMO_TOKENS.dev2, name: "Meera laptop", project: acme },
    { user: dev3, role: "DEVELOPER", token: DEMO_TOKENS.dev3, name: "Vikram laptop", project: null },
    { user: dev4, role: "DEVELOPER", token: DEMO_TOKENS.dev4, name: "Sana laptop", project: null },
  ] as const;

  for (const entry of tokens) {
    await prisma.apiToken.create({
      data: {
        name: entry.name,
        userId: entry.user.id,
        projectId: entry.project?.id ?? null,
        role: entry.role,
        prefix: entry.token.slice(0, 12),
        tokenHash: hashToken(entry.token),
      },
    });
  }

  const evidence = [
    {
      handle: "STACK-100",
      kind: "COMMIT",
      actor: "Rahul Chavan",
      summary: "STACK-100: seed checkout service",
    },
    { handle: "STACK-100", kind: "PR_OPENED", actor: "github-app", summary: "PR #38 opened" },
    { handle: "STACK-100", kind: "PR_MERGED", actor: "github-app", summary: "PR #38 merged to main" },
    { handle: "STACK-100", kind: "VALIDATED", actor: "Akash Rao", summary: "Validated by Akash Rao" },
    {
      handle: "STACK-101",
      kind: "HARNESS_INSTALLED",
      actor: "Meera Iyer",
      summary: "miracle-standards 0.1.0 installed in acme/checkout",
    },
    {
      handle: "STACK-102",
      kind: "PR_MERGED",
      actor: "github-app",
      summary: "PR #41 merged to main, awaiting human validation",
    },
    { handle: "STACK-103", kind: "PR_OPENED", actor: "github-app", summary: "PR #42 opened" },
    {
      handle: "STACK-106",
      kind: "CLAIMED",
      actor: "Rahul Chavan",
      summary: "Claimed through the developer MCP",
    },
  ] as const;

  for (const entry of evidence) {
    await prisma.event.create({
      data: {
        projectId: acme.id,
        issueId: issueRecords[entry.handle]?.id ?? null,
        kind: entry.kind,
        actor: entry.actor,
        summary: entry.summary,
      },
    });
  }

  console.log("users      ", await prisma.user.count());
  console.log("projects   ", await prisma.project.count());
  console.log("waves      ", await prisma.wave.count());
  console.log("issues     ", await prisma.issue.count());
  console.log("templates  ", await prisma.template.count());
  console.log("packs      ", await prisma.harnessPack.count());
  console.log("pack       ", `${manifest.name} ${published.version} (${files.length} files)`);
  console.log("default    ", `miracle-default ${manifest.version} (${files.length} files)`);
  console.log("checksum   ", checksum.slice(0, 16));
  console.log("\ndemo API tokens (mock only, deterministic for the docs):");
  for (const entry of tokens) {
    console.log(`  ${entry.role.padEnd(9)} ${entry.user.name.padEnd(14)} ${entry.token}`);
  }
  console.log("\nportal: http://localhost:4200   mcp: http://localhost:4300/mcp");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
