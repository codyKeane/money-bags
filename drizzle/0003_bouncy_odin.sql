CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`filename` text,
	`imported_count` integer NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `batch_id` text REFERENCES import_batches(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `transactions_batch_idx` ON `transactions` (`batch_id`);