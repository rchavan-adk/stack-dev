/**
 * Seeds the mock Stack AI portal.
 *
 * Tokens are deterministic so the README and the demo script stay valid between
 * reseeds. That is a mock-only convenience; real tokens are random and shown once.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@stack/core/src/password";

const prisma = new PrismaClient();

/** Local-only. A deployment bootstraps its first admin at /setup instead. */
const DEV_PASSWORD = "stack-dev-password";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const PACK_DIR = join(REPO_ROOT, "harness-packs", "miracle-standards");
const MOCK_GITHUB = join(REPO_ROOT, "mock-github");

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const DEMO_TOKENS = {
  admin: "stk_adm_priya_demo_token_0001",
  lead: "stk_lead_akash_demo_token_001",
  dev: "stk_dev_rahul_demo_token_0001",
  dev2: "stk_dev_meera_demo_token_0001",
  dev3: "stk_dev_vikram_demo_token_0001",
  dev4: "stk_dev_sana_demo_token_0001",
};

interface PackManifest {
  name: string;
  version: string;
  description: string;
  components: Array<{ kind: string; path: string; mode: string }>;
}

function loadPackFromDisk(): {
  manifest: PackManifest;
  files: Array<{ kind: string; path: string; mode: string; content: string }>;
} {
  const manifestPath = join(PACK_DIR, "pack.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`pack manifest not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackManifest;
  const files = manifest.components.map((component) => {
    const absolute = join(PACK_DIR, component.path);
    if (!existsSync(absolute)) {
      throw new Error(`pack component missing on disk: ${component.path}`);
    }
    return { ...component, content: readFileSync(absolute, "utf8") };
  });
  // pack.json itself travels with the tarball so the CLI can read the manifest.
  files.push({
    kind: "SYSTEM_PROMPT",
    path: "pack.json",
    mode: "644",
    content: readFileSync(manifestPath, "utf8"),
  });
  return { manifest, files };
}

const ISSUE_TEMPLATE = {
  sections: [
    { id: "context", title: "Context", required: true, minWords: 10, hint: "Why this work exists" },
    { id: "scope", title: "Scope", required: true, hint: "Files, services or screens in scope" },
    {
      id: "acceptance",
      title: "Acceptance criteria",
      required: true,
      hint: "Checklist a person can validate",
    },
    { id: "out-of-scope", title: "Out of scope", required: true, hint: "What this item does not cover" },
    { id: "evidence", title: "Evidence", required: false, hint: "Commands, tests, screenshots" },
  ],
  fields: [
    {
      id: "type",
      label: "Type",
      type: "select",
      required: true,
      options: ["FEATURE", "BUG", "CHORE", "SPIKE"],
    },
    { id: "estimate", label: "Estimate (points)", type: "number", required: true },
    { id: "wave", label: "Wave", type: "text", required: true },
  ],
  rules: {
    minAcceptanceCriteria: 2,
    requireLinkedSpec: false,
    requireWave: true,
    maxTitleLength: 100,
  },
};

const SPEC_TEMPLATE = {
  sections: [
    { id: "problem", title: "Problem", required: true, minWords: 15 },
    { id: "proposal", title: "Proposal", required: true, minWords: 20 },
    { id: "api", title: "Interfaces", required: false },
    { id: "risks", title: "Risks and rollback", required: true },
    { id: "acceptance", title: "Acceptance criteria", required: true },
  ],
  fields: [
    {
      id: "author_role",
      label: "Author role",
      type: "select",
      required: true,
      options: ["LEAD", "ARCHITECT", "PLANNER_AGENT"],
    },
  ],
  rules: {
    minAcceptanceCriteria: 3,
    requireLinkedSpec: false,
    requireWave: false,
    maxTitleLength: 120,
  },
};

const WAVE_TEMPLATE = {
  sections: [
    { id: "goal", title: "Wave goal", required: true, minWords: 8 },
    { id: "slices", title: "Horizontal slices", required: true },
    { id: "exit", title: "Exit criteria", required: true },
    { id: "dependencies", title: "Dependencies", required: false },
  ],
  fields: [
    { id: "duration_weeks", label: "Duration (weeks)", type: "number", required: true },
    {
      id: "shape",
      label: "Slicing shape",
      type: "select",
      required: true,
      options: ["HORIZONTAL", "VERTICAL", "MIXED"],
    },
  ],
  rules: {
    minAcceptanceCriteria: 1,
    requireLinkedSpec: false,
    requireWave: false,
    maxTitleLength: 80,
  },
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
  await prisma.modelCall.deleteMany();
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
      gatewayUrl: "http://localhost:4400",
      budgetUsd: 500,
    },
  });

  const pilot = await prisma.project.create({
    data: {
      key: "MIR",
      name: "Miracle Internal Pilot",
      client: "Miracle Software Systems",
      summary: "Internal pilot that proves the harness and the portal before client rollout.",
      handlePattern: "STACK-[0-9]+",
      gatewayUrl: "http://localhost:4400",
      budgetUsd: 150,
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
    data: [
      {
        kind: "ISSUE",
        name: "Miracle issue template",
        version: "1.2.0",
        definition: JSON.stringify(ISSUE_TEMPLATE),
        active: true,
      },
      {
        kind: "SPEC",
        name: "Miracle spec template",
        version: "1.1.0",
        definition: JSON.stringify(SPEC_TEMPLATE),
        active: true,
      },
      {
        kind: "WAVE",
        name: "Miracle wave template",
        version: "1.0.0",
        definition: JSON.stringify(WAVE_TEMPLATE),
        active: true,
      },
    ],
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

  const checksum = sha256(
    files
      .map((file) => `${file.path}:${sha256(file.content)}`)
      .sort()
      .join("\n"),
  );

  const published = await prisma.harnessVersion.create({
    data: {
      packId: pack.id,
      version: manifest.version,
      status: "PUBLISHED",
      notes: "First Miracle standards pack: commit handle enforcement, gateway-only model calls.",
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
      version: "0.2.0",
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
      version: "0.1.0",
      status: "PUBLISHED",
      notes: "Default harness: item-handle commits and gateway-only model calls before a project pack exists.",
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

  const calls = [
    { handle: "STACK-102", model: "claude-sonnet-5", tokensIn: 18400, tokensOut: 3100, costUsd: 0.92 },
    { handle: "STACK-103", model: "claude-sonnet-5", tokensIn: 24100, tokensOut: 5200, costUsd: 1.37 },
    { handle: "STACK-106", model: "gpt-5.2-mini", tokensIn: 9800, tokensOut: 1400, costUsd: 0.21 },
    { handle: "STACK-104", model: "claude-sonnet-5", tokensIn: 12200, tokensOut: 2600, costUsd: 0.68 },
  ] as const;

  for (const call of calls) {
    await prisma.modelCall.create({
      data: {
        projectId: acme.id,
        issueId: issueRecords[call.handle]?.id ?? null,
        userId: dev.id,
        model: call.model,
        tokensIn: call.tokensIn,
        tokensOut: call.tokensOut,
        costUsd: call.costUsd,
        allowed: true,
      },
    });
  }

  await prisma.modelCall.create({
    data: {
      projectId: acme.id,
      userId: dev.id,
      model: "some-unapproved-model",
      allowed: false,
      reason: "Model not on the engagement allowlist",
    },
  });

  console.log("users      ", await prisma.user.count());
  console.log("projects   ", await prisma.project.count());
  console.log("waves      ", await prisma.wave.count());
  console.log("issues     ", await prisma.issue.count());
  console.log("templates  ", await prisma.template.count());
  console.log("packs      ", await prisma.harnessPack.count());
  console.log("pack       ", `${manifest.name} ${published.version} (${files.length} files)`);
  console.log("default    ", `miracle-default 0.1.0 (${files.length} files)`);
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
