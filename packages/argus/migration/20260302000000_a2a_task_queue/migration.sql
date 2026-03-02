CREATE TABLE `a2a_task_queue` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`prompt` text NOT NULL,
	`priority` text NOT NULL DEFAULT 'normal',
	`status` text NOT NULL DEFAULT 'queued',
	`source` text NOT NULL DEFAULT 'api',
	`retry_count` integer NOT NULL DEFAULT 0,
	`max_retries` integer NOT NULL DEFAULT 3,
	`previous_summary` text,
	`error_message` text,
	`metadata` text NOT NULL DEFAULT '{}',
	`time_started` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_a2a_queue_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `a2a_queue_session_idx` ON `a2a_task_queue` (`session_id`);
--> statement-breakpoint
CREATE INDEX `a2a_queue_status_idx` ON `a2a_task_queue` (`status`);
--> statement-breakpoint
CREATE INDEX `a2a_queue_priority_idx` ON `a2a_task_queue` (`priority`, `status`);
