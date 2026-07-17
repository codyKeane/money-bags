import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import {
  ANNOTATED_EXPORT_HEADER,
  DETAILED_EXPORT_HEADER,
  LEGACY_EXPORT_HEADER,
  type TransactionExportFormat,
} from "@/lib/csv/transaction-export";
import { prepareTransactionExport } from "./transaction-export";

interface AccountFixture {
  id: string;
  name: string;
  currency: string;
}

interface CategoryFixture {
  id: string;
  name: string;
}

interface TransactionFixture {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  accountId: string;
  categoryId?: string | null;
  createdAt?: number;
  notes?: string;
  tagsJson?: string;
}

interface SplitFixture {
  id: string;
  transactionId: string;
  categoryId: string | null;
  amountCents: number;
}

type ReadyExport = Extract<
  Awaited<ReturnType<typeof prepareTransactionExport>>,
  { status: "ready" }
>;

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      output += decoder.decode(result.value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function lines(csv: string): string[] {
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(0, -2).split("\r\n");
}

describe("transaction export service (integration, temp DB)", () => {
  let directory: string;
  let databasePath: string;
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];
  let readyExports: ReadyExport[];

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "moneybags-export-service-"));
    databasePath = path.join(directory, "synthetic.sqlite");
    sqlite = createTestDb(databasePath).sqlite;
    readyExports = [];
  });

  afterEach(async () => {
    for (const result of readyExports) {
      if (!result.isClosed()) {
        await result.stream.cancel().catch(() => undefined);
      }
    }
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function addAccount(fixture: AccountFixture): void {
    sqlite
      .prepare(
        `insert into accounts (
          id, name, type, institution, currency, opening_balance_cents, created_at, updated_at
        ) values (?, ?, 'CHECKING', null, ?, 0, 1, 1)`,
      )
      .run(fixture.id, fixture.name, fixture.currency);
  }

  function addCategory(fixture: CategoryFixture): void {
    sqlite
      .prepare(
        `insert into categories (
          id, name, color, keywords, exclude_from_spending, monthly_budget_cents, created_at
        ) values (?, ?, null, '[]', 0, null, 1)`,
      )
      .run(fixture.id, fixture.name);
  }

  function addTransaction(fixture: TransactionFixture): void {
    const createdAt = fixture.createdAt ?? 1;
    sqlite
      .prepare(
        `insert into transactions (
          id, date, description, amount_cents, account_id, category_id,
          import_hash, batch_id, notes, tags, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?)`,
      )
      .run(
        fixture.id,
        fixture.date,
        fixture.description,
        fixture.amountCents,
        fixture.accountId,
        fixture.categoryId ?? null,
        fixture.notes ?? "",
        fixture.tagsJson ?? "[]",
        createdAt,
        createdAt,
      );
  }

  function addSplit(fixture: SplitFixture): void {
    sqlite
      .prepare(
        `insert into transaction_splits (
          id, transaction_id, category_id, amount_cents
        ) values (?, ?, ?, ?)`,
      )
      .run(
        fixture.id,
        fixture.transactionId,
        fixture.categoryId,
        fixture.amountCents,
      );
  }

  async function prepareReady(
    format: TransactionExportFormat,
    query: Parameters<typeof prepareTransactionExport>[0] = {},
    options: Omit<
      NonNullable<Parameters<typeof prepareTransactionExport>[2]>,
      "databasePath"
    > = {},
  ): Promise<ReadyExport> {
    const result = await prepareTransactionExport(query, format, {
      databasePath,
      ...options,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error(`Expected a ready export, received ${result.status}`);
    }
    readyExports.push(result);
    return result;
  }

  it("streams the exact legacy shape for one normalized selected currency", async () => {
    addAccount({ id: "account-usd", name: "Checking", currency: " usd " });
    addCategory({ id: "groceries", name: "Groceries" });
    addTransaction({
      id: "coffee",
      date: "2026-07-01",
      description: "Coffee",
      amountCents: -1234,
      accountId: "account-usd",
      categoryId: "groceries",
    });

    const result = await prepareReady("legacy", { q: "Coffee" });
    await expect(readStream(result.stream)).resolves.toBe(
      `${LEGACY_EXPORT_HEADER}\r\n` +
        "2026-07-01,Coffee,-12.34,Checking,Groceries\r\n",
    );
    expect(result.isClosed()).toBe(true);
  });

  it("streams only the exact header for an empty selection", async () => {
    const result = await prepareReady("detailed");

    await expect(readStream(result.stream)).resolves.toBe(`${DETAILED_EXPORT_HEADER}\r\n`);
    expect(result.isClosed()).toBe(true);
  });

  it("streams normalized annotations only in the annotated format", async () => {
    addAccount({ id: "account-usd", name: "Checking", currency: "USD" });
    addTransaction({
      id: "annotated",
      date: "2026-07-01",
      description: "Lunch",
      amountCents: -2500,
      accountId: "account-usd",
      notes: "Shared with Rowan",
      tagsJson: '["reimbursable","work"]',
    });

    const result = await prepareReady("annotated", { tag: "work" });
    await expect(readStream(result.stream)).resolves.toBe(
      `${ANNOTATED_EXPORT_HEADER}\r\n` +
        '2026-07-01,Lunch,-25.00,USD,Checking,Uncategorized,,Shared with Rowan,"[""reimbursable"",""work""]"\r\n',
    );
  });

  it("refuses a legacy export selected across normalized currencies before streaming", async () => {
    addAccount({ id: "account-eur", name: "Euro", currency: "EUR" });
    addAccount({ id: "account-usd", name: "Dollar", currency: "USD" });
    addTransaction({
      id: "eur-row",
      date: "2026-07-01",
      description: "Euro row",
      amountCents: -100,
      accountId: "account-eur",
    });
    addTransaction({
      id: "usd-row",
      date: "2026-07-02",
      description: "Dollar row",
      amountCents: -200,
      accountId: "account-usd",
    });

    await expect(
      prepareTransactionExport({}, "legacy", { databasePath }),
    ).resolves.toEqual({ status: "mixed-currency" });
  });

  it("refuses invalid selected currency with safe account identity only", async () => {
    addAccount({ id: "broken", name: "Repair me", currency: "not-a-code" });
    addAccount({ id: "unused", name: "Not selected", currency: "also-invalid" });
    addTransaction({
      id: "broken-row",
      date: "2026-07-01",
      description: "Broken row",
      amountCents: -100,
      accountId: "broken",
    });

    await expect(
      prepareTransactionExport({}, "detailed", { databasePath }),
    ).resolves.toEqual({
      status: "invalid-currency",
      accounts: [{ id: "broken", name: "Repair me" }],
    });
  });

  it("allows detailed mixed-currency rows and emits each normalized currency", async () => {
    addAccount({ id: "account-eur", name: "Euro", currency: " eur " });
    addAccount({ id: "account-usd", name: "Dollar", currency: "usd" });
    addTransaction({
      id: "eur-row",
      date: "2026-07-01",
      description: "Euro row",
      amountCents: -100,
      accountId: "account-eur",
    });
    addTransaction({
      id: "usd-row",
      date: "2026-07-02",
      description: "Dollar row",
      amountCents: -200,
      accountId: "account-usd",
    });

    const result = await prepareReady("detailed");
    expect(lines(await readStream(result.stream))).toEqual([
      DETAILED_EXPORT_HEADER,
      "2026-07-01,Euro row,-1.00,EUR,Euro,Uncategorized,",
      "2026-07-02,Dollar row,-2.00,USD,Dollar,Uncategorized,",
    ]);
  });

  it("uses active split categories to filter while exporting the full parent and all details", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    addCategory({ id: "groceries", name: "Groceries" });
    addCategory({ id: "household", name: "Household" });
    addCategory({ id: "ignored", name: "Ignored parent" });
    sqlite
      .prepare("update categories set exclude_from_spending = 1 where id = 'household'")
      .run();
    addTransaction({
      id: "split-parent",
      date: "2026-07-03",
      description: "Market run",
      amountCents: -1350,
      accountId: "account",
      categoryId: "ignored",
    });
    addSplit({
      id: "household-part",
      transactionId: "split-parent",
      categoryId: "household",
      amountCents: -750,
    });
    addSplit({
      id: "grocery-part",
      transactionId: "split-parent",
      categoryId: "groceries",
      amountCents: -500,
    });
    addSplit({
      id: "uncategorized-part",
      transactionId: "split-parent",
      categoryId: null,
      amountCents: -100,
    });
    addTransaction({
      id: "not-selected",
      date: "2026-07-04",
      description: "Other category",
      amountCents: -99,
      accountId: "account",
      categoryId: "household",
    });

    const result = await prepareReady("detailed", { categoryId: "groceries" });
    expect(await readStream(result.stream)).toBe(
      `${DETAILED_EXPORT_HEADER}\r\n` +
        '2026-07-03,Market run,-13.50,USD,Checking,Split,"' +
        '[{""category"":""Groceries"",""amountCents"":-500},' +
        '{""category"":""Household"",""amountCents"":-750},' +
        '{""category"":null,""amountCents"":-100}]"\r\n',
    );

    const ignoredParent = await prepareReady("detailed", { categoryId: "ignored" });
    await expect(readStream(ignoredParent.stream)).resolves.toBe(
      `${DETAILED_EXPORT_HEADER}\r\n`,
    );

    const uncategorized = await prepareReady("detailed", { categoryId: null });
    expect(await readStream(uncategorized.stream)).toContain(
      "2026-07-03,Market run,-13.50,USD,Checking,Split",
    );

    const hostile = await prepareReady("detailed", {
      categoryId: "groceries' OR 1=1 --",
    });
    await expect(readStream(hostile.stream)).resolves.toBe(`${DETAILED_EXPORT_HEADER}\r\n`);
  });

  it("crosses chunk boundaries in binary (date, createdAt, id) order with bounded queries", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    for (const id of ["z", "a", "é", "Z", "A"]) {
      addTransaction({
        id,
        date: "2026-07-05",
        description: `row ${id}`,
        amountCents: -1,
        accountId: "account",
        createdAt: 100,
      });
      addSplit({
        id: `split-${id}`,
        transactionId: id,
        categoryId: null,
        amountCents: -1,
      });
    }
    const queryCounts = { currency: 0, parents: 0, splits: 0 };

    const result = await prepareReady("legacy", {}, {
      chunkSize: 2,
      onQuery(kind) {
        queryCounts[kind] += 1;
      },
    });
    const output = lines(await readStream(result.stream));

    expect(output.slice(1).map((line) => line.split(",")[1])).toEqual([
      "row A",
      "row Z",
      "row a",
      "row z",
      "row é",
    ]);
    expect(queryCounts).toEqual({ currency: 1, parents: 3, splits: 3 });
    expect(result.isClosed()).toBe(true);
  });

  it("streams more than one thousand parents in three bounded 500-row chunks", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    const insertTransaction = sqlite.prepare(
      `insert into transactions (
        id, date, description, amount_cents, account_id, category_id,
        import_hash, batch_id, created_at, updated_at
      ) values (?, '2026-07-05', ?, -1, 'account', null, null, null, 100, 100)`,
    );
    const insertSplit = sqlite.prepare(
      `insert into transaction_splits (
        id, transaction_id, category_id, amount_cents
      ) values (?, ?, null, -1)`,
    );
    sqlite.transaction(() => {
      for (let index = 0; index < 1_001; index += 1) {
        const id = `row-${String(index).padStart(4, "0")}`;
        insertTransaction.run(id, id);
        insertSplit.run(`split-${id}`, id);
      }
    })();
    const queryCounts = { currency: 0, parents: 0, splits: 0 };

    const result = await prepareReady("legacy", {}, {
      onQuery(kind) {
        queryCounts[kind] += 1;
      },
    });
    const output = lines(await readStream(result.stream));

    expect(output).toHaveLength(1_002);
    expect(output[1]).toContain("row-0000");
    expect(output.at(-1)).toContain("row-1000");
    expect(queryCounts).toEqual({ currency: 1, parents: 3, splits: 3 });
    expect(result.isClosed()).toBe(true);
  });

  it("keeps one WAL snapshot when a writer commits after currency preflight", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    addTransaction({
      id: "before-snapshot",
      date: "2026-07-01",
      description: "Before snapshot",
      amountCents: -100,
      accountId: "account",
    });

    const result = await prepareReady("legacy", {}, { chunkSize: 1 });
    addTransaction({
      id: "after-snapshot",
      date: "2026-07-02",
      description: "After snapshot",
      amountCents: -200,
      accountId: "account",
    });

    expect(lines(await readStream(result.stream))).toEqual([
      LEGACY_EXPORT_HEADER,
      "2026-07-01,Before snapshot,-1.00,Checking,Uncategorized",
    ]);
    expect(result.isClosed()).toBe(true);
  });

  it("rolls back and closes the snapshot connection when the consumer cancels", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    for (let index = 0; index < 3; index += 1) {
      addTransaction({
        id: `row-${index}`,
        date: `2026-07-0${index + 1}`,
        description: `row ${index}`,
        amountCents: -100,
        accountId: "account",
      });
    }

    const result = await prepareReady("legacy", {}, { chunkSize: 1 });
    expect(result.isClosed()).toBe(false);

    const reader = result.stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe(`${LEGACY_EXPORT_HEADER}\r\n`);
    await reader.cancel("test cancellation");

    expect(result.isClosed()).toBe(true);
  });

  it("rejects unsafe historical amounts before creating a stream", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    sqlite.exec(`insert into transactions (
      id, date, description, amount_cents, account_id, category_id,
      import_hash, batch_id, created_at, updated_at
    ) values (
      'unsafe', '2026-07-01', 'Unsafe', 9007199254740992, 'account', null,
      null, null, 1, 1
    )`);

    await expect(
      prepareTransactionExport({}, "detailed", { databasePath }),
    ).resolves.toEqual({ status: "unsafe-data" });
  });

  it.each([
    ["unsafe integer", "9007199254740993"],
    ["non-integer", "1.5"],
  ])("refuses a %s created-at cursor before streaming", async (_case, createdAt) => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    sqlite.exec(`insert into transactions (
      id, date, description, amount_cents, account_id, category_id,
      import_hash, batch_id, created_at, updated_at
    ) values (
      'unsafe-cursor', '2026-07-01', 'Unsafe cursor', -100, 'account', null,
      null, null, ${createdAt}, 1
    )`);

    await expect(
      prepareTransactionExport({}, "detailed", { databasePath, chunkSize: 1 }),
    ).resolves.toEqual({ status: "unsafe-data" });

    expect(() =>
      sqlite
        .prepare("update transactions set description = 'Connection is writable' where id = ?")
        .run("unsafe-cursor"),
    ).not.toThrow();
  });

  it("rolls back and closes when a corrupt date fails during encoding", async () => {
    addAccount({ id: "account", name: "Checking", currency: "USD" });
    addTransaction({
      id: "invalid-date",
      date: "not-an-iso-date",
      description: "Corrupt date",
      amountCents: -100,
      accountId: "account",
    });
    const result = await prepareReady("detailed");

    await expect(readStream(result.stream)).rejects.toThrow("valid ISO date");
    expect(result.isClosed()).toBe(true);
  });
});
