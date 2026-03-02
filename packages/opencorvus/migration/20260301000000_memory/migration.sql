CREATE TABLE `memory_file` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_file_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_chunk` (
	`id` text PRIMARY KEY,
	`file_id` text NOT NULL,
	`project_id` text NOT NULL,
	`content` text NOT NULL,
	`token_count` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_chunk_file_id_memory_file_id_fk` FOREIGN KEY (`file_id`) REFERENCES `memory_file`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_chunk_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_embedding` (
	`chunk_id` text PRIMARY KEY,
	`embedding` blob NOT NULL,
	`model` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_embedding_chunk_id_memory_chunk_id_fk` FOREIGN KEY (`chunk_id`) REFERENCES `memory_chunk`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_file_project_idx` ON `memory_file` (`project_id`);
--> statement-breakpoint
CREATE INDEX `memory_chunk_file_idx` ON `memory_chunk` (`file_id`);
--> statement-breakpoint
CREATE INDEX `memory_chunk_project_idx` ON `memory_chunk` (`project_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `memory_fts` USING fts5(
	content,
	chunk_id UNINDEXED,
	project_id UNINDEXED
);
