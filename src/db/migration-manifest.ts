export interface ReviewedMigration {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
  readonly sha256: string;
}

// COMPATIBILITY LOCK: applied migration SQL is immutable. Never update one of
// these literals merely to make a check pass; append a reviewed migration.
export const REVIEWED_MIGRATIONS: readonly ReviewedMigration[] = Object.freeze([
  Object.freeze({
    idx: 0,
    version: "6",
    when: 1783145819916,
    tag: "0000_hesitant_yellow_claw",
    breakpoints: true,
    sha256: "f6fbc57eab77a346e5c6b8e72d24e1393a15497b4051cde2c4f932648f8dfd31",
  }),
  Object.freeze({
    idx: 1,
    version: "6",
    when: 1783146074376,
    tag: "0001_third_skin",
    breakpoints: true,
    sha256: "083430c4c6a7acbe024293efaa1835dfde96377f3a0bc7d08f9df4564b24eed5",
  }),
  Object.freeze({
    idx: 2,
    version: "6",
    when: 1783354074001,
    tag: "0002_noisy_bill_hollister",
    breakpoints: true,
    sha256: "3fb428f49b2de20b671756014748d9b877f93142cc4cbec7c4daf417dbf60a78",
  }),
  Object.freeze({
    idx: 3,
    version: "6",
    when: 1783392874346,
    tag: "0003_bouncy_odin",
    breakpoints: true,
    sha256: "d16f531ee1e4958c428716fcfdf0ae888b917055a32dc22ec4249bc405ec2de7",
  }),
  Object.freeze({
    idx: 4,
    version: "6",
    when: 1783394978597,
    tag: "0004_right_gamma_corps",
    breakpoints: true,
    sha256: "163081861a670360f47dfc52c8934f70bbed808606a8a85f18ffbf4e61baf0f1",
  }),
  Object.freeze({
    idx: 5,
    version: "6",
    when: 1784189434031,
    tag: "0005_annotations",
    breakpoints: true,
    sha256: "1a259e7d6f3d70fb1a52ec59ea6202224f950feab72237ac3c7f6121c6981bab",
  }),
  Object.freeze({
    idx: 6,
    version: "6",
    when: 1784342938168,
    tag: "0006_ledger_options",
    breakpoints: true,
    sha256: "e81ddd9d35372c6f67a4f223b5176e900eb5a1b592242f7c9a220a11127e0e11",
  }),
]);

export const REVIEWED_MIGRATION_JOURNAL = Object.freeze({
  version: "7",
  dialect: "sqlite",
  entries: REVIEWED_MIGRATIONS,
});
