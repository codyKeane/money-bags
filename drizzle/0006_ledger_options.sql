CREATE TABLE `import_duplicate_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`import_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_duplicate_overrides_transaction_id_unique` ON `import_duplicate_overrides` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_duplicate_source_unique` ON `import_duplicate_overrides` (`account_id`,`source_fingerprint`,`source_row_number`);--> statement-breakpoint
CREATE INDEX `import_duplicate_hash_idx` ON `import_duplicate_overrides` (`account_id`,`import_hash`);--> statement-breakpoint
CREATE TABLE `refund_links` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_transaction_id` text NOT NULL,
	`original_transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`refund_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_links_refund_transaction_id_unique` ON `refund_links` (`refund_transaction_id`);--> statement-breakpoint
CREATE INDEX `refund_links_original_idx` ON `refund_links` (`original_transaction_id`);--> statement-breakpoint
CREATE TABLE `transfer_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_transaction_id` text NOT NULL,
	`destination_transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_pairs_source_unique` ON `transfer_pairs` (`source_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_pairs_destination_unique` ON `transfer_pairs` (`destination_transaction_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `opening_balance_date` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `cleared` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `exclude_from_spending` integer DEFAULT false NOT NULL;