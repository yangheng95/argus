@echo off
title OPENCORVUS_TUI_BOT
set OPENCORVUS_DISABLE_TERMINAL_TITLE=1
cd /d %~dp0..\..
bun --preload @opentui/solid/preload --conditions=browser --cwd packages/opencorvus src/index.ts %1
