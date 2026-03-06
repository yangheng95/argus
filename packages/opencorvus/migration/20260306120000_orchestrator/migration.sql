CREATE TABLE `orchestrator_task` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`active_plan_version_id` text,
	`active_run_id` text,
	`source` text NOT NULL DEFAULT 'api',
	`title` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL DEFAULT 'queued',
	`priority` text NOT NULL DEFAULT 'normal',
	`blocking_reason` text,
	`error` text,
	`budget` text,
	`metadata` text,
	`time_started` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_task_project_id` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_task_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `orchestrator_task_project_idx` ON `orchestrator_task` (`project_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_task_status_idx` ON `orchestrator_task` (`status`);
--> statement-breakpoint
CREATE TABLE `orchestrator_plan_version` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL DEFAULT 'active',
	`summary` text NOT NULL,
	`prompt` text NOT NULL,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_plan_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `orchestrator_plan_task_idx` ON `orchestrator_plan_version` (`task_id`);
--> statement-breakpoint
CREATE TABLE `orchestrator_goal` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`description` text NOT NULL,
	`criteria` text NOT NULL,
	`priority` text NOT NULL DEFAULT 'blocking',
	`status` text NOT NULL DEFAULT 'pending',
	`order_index` integer NOT NULL DEFAULT 0,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_goal_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_goal_plan_version_id` FOREIGN KEY (`plan_version_id`) REFERENCES `orchestrator_plan_version`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `orchestrator_goal_task_idx` ON `orchestrator_goal` (`task_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_goal_plan_idx` ON `orchestrator_goal` (`plan_version_id`);
--> statement-breakpoint
CREATE TABLE `orchestrator_run` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`plan_version_id` text,
	`session_id` text,
	`executor` text NOT NULL DEFAULT 'opencode',
	`status` text NOT NULL DEFAULT 'queued',
	`phase` text NOT NULL DEFAULT 'execute',
	`blocking_reason` text,
	`error` text,
	`retry_count` integer NOT NULL DEFAULT 0,
	`executor_ref` text,
	`metadata` text,
	`time_started` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_run_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_run_plan_version_id` FOREIGN KEY (`plan_version_id`) REFERENCES `orchestrator_plan_version`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_orchestrator_run_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `orchestrator_run_task_idx` ON `orchestrator_run` (`task_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_run_status_idx` ON `orchestrator_run` (`status`);
--> statement-breakpoint
CREATE TABLE `orchestrator_interaction_request` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text,
	`external_id` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`title` text NOT NULL,
	`body` text NOT NULL,
	`payload` text,
	`response` text,
	`time_resolved` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_interaction_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_interaction_run_id` FOREIGN KEY (`run_id`) REFERENCES `orchestrator_run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_interaction_session_id` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `orchestrator_interaction_run_idx` ON `orchestrator_interaction_request` (`run_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_interaction_external_idx` ON `orchestrator_interaction_request` (`external_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_interaction_status_idx` ON `orchestrator_interaction_request` (`status`);
--> statement-breakpoint
CREATE TABLE `orchestrator_delivery` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'ready',
	`summary` text NOT NULL,
	`result` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_delivery_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_delivery_run_id` FOREIGN KEY (`run_id`) REFERENCES `orchestrator_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `orchestrator_delivery_run_idx` ON `orchestrator_delivery` (`run_id`);
--> statement-breakpoint
CREATE TABLE `orchestrator_artifact` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`delivery_id` text,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`payload` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_artifact_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_artifact_run_id` FOREIGN KEY (`run_id`) REFERENCES `orchestrator_run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_artifact_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `orchestrator_delivery`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `orchestrator_artifact_run_idx` ON `orchestrator_artifact` (`run_id`);
--> statement-breakpoint
CREATE INDEX `orchestrator_artifact_delivery_idx` ON `orchestrator_artifact` (`delivery_id`);
--> statement-breakpoint
CREATE TABLE `orchestrator_evaluation` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`delivery_id` text,
	`status` text NOT NULL DEFAULT 'pending',
	`verdict` text NOT NULL DEFAULT 'inconclusive',
	`summary` text NOT NULL,
	`checks` text,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_evaluation_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_evaluation_run_id` FOREIGN KEY (`run_id`) REFERENCES `orchestrator_run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_orchestrator_evaluation_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `orchestrator_delivery`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `orchestrator_evaluation_run_idx` ON `orchestrator_evaluation` (`run_id`);
--> statement-breakpoint
CREATE TABLE `orchestrator_progress_snapshot` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_progress_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `orchestrator_progress_task_idx` ON `orchestrator_progress_snapshot` (`task_id`);
--> statement-breakpoint
CREATE TABLE `orchestrator_channel_binding` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`platform` text NOT NULL,
	`channel` text NOT NULL,
	`thread` text NOT NULL,
	`payload` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_orchestrator_channel_task_id` FOREIGN KEY (`task_id`) REFERENCES `orchestrator_task`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `orchestrator_channel_task_idx` ON `orchestrator_channel_binding` (`task_id`);
