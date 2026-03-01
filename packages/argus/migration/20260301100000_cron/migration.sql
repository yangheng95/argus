CREATE TABLE `cron_job` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`name` text NOT NULL,
	`expression` text NOT NULL,
	`prompt` text NOT NULL,
	`agent` text NOT NULL DEFAULT 'default',
	`enabled` integer NOT NULL DEFAULT 1,
	`one_shot` integer NOT NULL DEFAULT 0,
	`last_run` integer,
	`next_run` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_cron_job_project_id` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_cron_job_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `cron_job_project_idx` ON `cron_job` (`project_id`);
--> statement-breakpoint
CREATE INDEX `cron_job_next_run_idx` ON `cron_job` (`next_run`);
