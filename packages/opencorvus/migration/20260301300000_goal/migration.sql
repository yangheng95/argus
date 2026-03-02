CREATE TABLE `goal` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`description` text NOT NULL,
	`criteria` text NOT NULL,
	`verify_cmd` text,
	`status` text NOT NULL DEFAULT 'active',
	`priority` text NOT NULL DEFAULT 'blocking',
	`max_attempts` integer NOT NULL DEFAULT 10,
	`current_attempts` integer NOT NULL DEFAULT 0,
	`progress_log` text NOT NULL DEFAULT '[]',
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_goal_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `goal_session_idx` ON `goal` (`session_id`);
--> statement-breakpoint
CREATE INDEX `goal_status_idx` ON `goal` (`status`);
