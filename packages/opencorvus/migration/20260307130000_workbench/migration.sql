CREATE TABLE `workbench_preference` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`task_id` text,
	`user_id` text,
	`scope` text NOT NULL DEFAULT 'user',
	`key` text NOT NULL,
	`value` text NOT NULL,
	`source` text NOT NULL DEFAULT 'user_message',
	`confidence` integer NOT NULL DEFAULT 100,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_workbench_preference_project_id` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workbench_preference_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `workbench_preference_project_idx` ON `workbench_preference` (`project_id`);
--> statement-breakpoint
CREATE INDEX `workbench_preference_task_idx` ON `workbench_preference` (`task_id`);
--> statement-breakpoint
CREATE INDEX `workbench_preference_user_idx` ON `workbench_preference` (`user_id`);
--> statement-breakpoint
CREATE INDEX `workbench_preference_key_idx` ON `workbench_preference` (`key`);
--> statement-breakpoint
CREATE TABLE `workbench_task_note` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`source` text NOT NULL DEFAULT 'user_message',
	`user_id` text,
	`content` text NOT NULL,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_workbench_task_note_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workbench_task_note_run_id` FOREIGN KEY (`run_id`) REFERENCES `orchestrator_run`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `workbench_task_note_task_idx` ON `workbench_task_note` (`task_id`);
--> statement-breakpoint
CREATE INDEX `workbench_task_note_run_idx` ON `workbench_task_note` (`run_id`);
--> statement-breakpoint
CREATE INDEX `workbench_task_note_kind_idx` ON `workbench_task_note` (`kind`);
--> statement-breakpoint
CREATE TABLE `workbench_brief_snapshot` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`plan_version_id` text,
	`run_id` text,
	`content` text NOT NULL,
	`inputs` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_workbench_brief_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workbench_brief_plan_version_id` FOREIGN KEY (`plan_version_id`) REFERENCES `orchestrator_plan_version`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_workbench_brief_run_id` FOREIGN KEY (`run_id`) REFERENCES `orchestrator_run`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `workbench_brief_task_idx` ON `workbench_brief_snapshot` (`task_id`);
--> statement-breakpoint
CREATE INDEX `workbench_brief_run_idx` ON `workbench_brief_snapshot` (`run_id`);
