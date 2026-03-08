CREATE TABLE `orchestrator_milestone` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL DEFAULT '',
	`status` text NOT NULL DEFAULT 'pending',
	`order_index` integer NOT NULL DEFAULT 0,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_milestone_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_milestone_plan_version_id` FOREIGN KEY (`plan_version_id`) REFERENCES `orchestrator_plan_version`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `orchestrator_milestone_task_idx` ON `orchestrator_milestone` (`task_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_milestone_plan_idx` ON `orchestrator_milestone` (`plan_version_id`);
--> statement-breakpoint
ALTER TABLE `orchestrator_goal` ADD COLUMN `milestone_id` text REFERENCES `orchestrator_milestone`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `orchestrator_goal_milestone_idx` ON `orchestrator_goal` (`milestone_id`);
