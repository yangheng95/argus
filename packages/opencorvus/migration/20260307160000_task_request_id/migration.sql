ALTER TABLE orchestrator_task ADD COLUMN request_id text;

CREATE UNIQUE INDEX orchestrator_task_project_request_idx
ON orchestrator_task (project_id, request_id);
