@echo off
title ARGUS_TUI_BOT
set ARGUS_DISABLE_TERMINAL_TITLE=1
cd /d %~dp0..\..
bun run --cwd packages/argus --conditions=browser src/index.ts %1
