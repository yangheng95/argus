CREATE TABLE `scratchpad` (
	`session_id` text PRIMARY KEY,
	`content` text NOT NULL DEFAULT '',
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_scratchpad_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_plan` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`parent_id` text,
	`goal` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`priority` integer NOT NULL DEFAULT 0,
	`notes` text,
	`progress_pct` integer NOT NULL DEFAULT 0,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_task_plan_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `task_plan_session_idx` ON `task_plan` (`session_id`);
--> statement-breakpoint
CREATE INDEX `task_plan_parent_idx` ON `task_plan` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `task_plan_status_idx` ON `task_plan` (`status`);
