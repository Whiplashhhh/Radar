CREATE TABLE `briefings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`item_count` integer NOT NULL,
	`summary` text NOT NULL,
	`sections` text DEFAULT '[]' NOT NULL,
	`model` text,
	`error` text,
	`read_at` integer
);
