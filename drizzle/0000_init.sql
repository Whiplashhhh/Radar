CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`site_url` text,
	`category` text NOT NULL,
	`adapter` text DEFAULT 'rss' NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`poll_interval_min` integer DEFAULT 30 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_fetch_at` integer,
	`last_success_at` integer,
	`next_fetch_at` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_url_unique` ON `feeds` (`url`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`guid` text NOT NULL,
	`url` text,
	`canonical_url` text,
	`title_key` text,
	`title` text NOT NULL,
	`summary_html` text,
	`content_html` text,
	`author` text,
	`kind` text DEFAULT 'article' NOT NULL,
	`vuln_id` text,
	`published_at` integer NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`severity` text,
	`kev` integer DEFAULT false NOT NULL,
	`techs` text DEFAULT '[]' NOT NULL,
	`vuln_ids` text DEFAULT '[]' NOT NULL,
	`read_at` integer,
	`starred_at` integer,
	`readable_html` text,
	`readable_fetched_at` integer,
	`ai_summary` text,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_feed_guid` ON `items` (`feed_id`,`guid`);--> statement-breakpoint
CREATE INDEX `items_published` ON `items` (`published_at`);--> statement-breakpoint
CREATE INDEX `items_canonical` ON `items` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `items_title_key` ON `items` (`title_key`);--> statement-breakpoint
CREATE INDEX `items_vuln` ON `items` (`vuln_id`);--> statement-breakpoint
CREATE INDEX `items_score` ON `items` (`score`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vuln_id` text,
	`item_id` integer,
	`watch_id` integer NOT NULL,
	`level` text NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`vuln_id`) REFERENCES `vulns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`watch_id`) REFERENCES `watchlist`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `matches_vuln` ON `matches` (`vuln_id`);--> statement-breakpoint
CREATE INDEX `matches_item` ON `matches` (`item_id`);--> statement-breakpoint
CREATE INDEX `matches_watch` ON `matches` (`watch_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`tier` text NOT NULL,
	`critical` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`severity` text,
	`techs` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`not_before` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_status` ON `notifications` (`status`,`tier`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_target` ON `notifications` (`target_type`,`target_id`,`tier`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_success_at` integer,
	`failures` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vuln_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`vuln_id` text NOT NULL,
	FOREIGN KEY (`vuln_id`) REFERENCES `vulns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vuln_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vuln_id` text NOT NULL,
	`feed_id` integer,
	`item_id` integer,
	`url` text NOT NULL,
	`title` text,
	`source_name` text,
	`seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`vuln_id`) REFERENCES `vulns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vuln_sources_unique` ON `vuln_sources` (`vuln_id`,`url`);--> statement-breakpoint
CREATE INDEX `vuln_sources_item` ON `vuln_sources` (`item_id`);--> statement-breakpoint
CREATE TABLE `vulns` (
	`id` text PRIMARY KEY NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`title` text,
	`description` text,
	`cvss_score` real,
	`cvss_vector` text,
	`cvss_version` text,
	`severity` text DEFAULT 'unknown' NOT NULL,
	`epss` real,
	`epss_percentile` real,
	`kev` integer DEFAULT false NOT NULL,
	`kev_added_at` text,
	`kev_due_at` text,
	`kev_ransomware` integer DEFAULT false NOT NULL,
	`affected` text DEFAULT '[]' NOT NULL,
	`cpes` text DEFAULT '[]' NOT NULL,
	`references` text DEFAULT '[]' NOT NULL,
	`published_at` integer,
	`score` integer DEFAULT 0 NOT NULL,
	`match_level` text,
	`nvd_checked_at` integer,
	`epss_checked_at` integer,
	`ai_summary` text,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vulns_score` ON `vulns` (`score`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`cpes` text DEFAULT '[]' NOT NULL,
	`packages` text DEFAULT '[]' NOT NULL,
	`exclude` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
