@echo off
title OPENCORVUS_TUI_BOT
set OPENCORVUS_DISABLE_TERMINAL_TITLE=1
cd /d %~dp0..\..
bun run --cwd packages/opencorvus --conditions=browser src/index.ts %1
