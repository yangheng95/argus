ALTER TABLE `cron_job` ADD COLUMN `failure_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `cron_job` ADD COLUMN `last_error` text;
--> statement-breakpoint
ALTER TABLE `cron_job` ADD COLUMN `lease_until` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `cron_job` ADD COLUMN `lease_owner` text;
--> statement-breakpoint
CREATE INDEX `cron_job_lease_until_idx` ON `cron_job` (`lease_until`);
--> statement-breakpoint
CREATE TABLE `event_job` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`name` text NOT NULL,
	`event_type` text NOT NULL,
	`match_json` text,
	`prompt` text NOT NULL,
	`agent` text NOT NULL DEFAULT 'default',
	`enabled` integer NOT NULL DEFAULT 1,
	`one_shot` integer NOT NULL DEFAULT 0,
	`cooldown_ms` integer NOT NULL DEFAULT 0,
	`last_run` integer,
	`last_event` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_event_job_project_id` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_job_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `event_job_project_idx` ON `event_job` (`project_id`);
--> statement-breakpoint
CREATE INDEX `event_job_type_idx` ON `event_job` (`event_type`);
--> statement-breakpoint
CREATE INDEX `event_job_enabled_idx` ON `event_job` (`enabled`);
