// Auto-generated from packages/opencorvus/src/skill/builtin/bot
// Keep this in sync when bot skill files change.

import f0 from "./bot/opencorvus-bot-config-wizard/agents/openai.yaml" with { type: "text" }
import f1 from "./bot/opencorvus-bot-config-wizard/references/channel-matrix.md" with { type: "text" }
import f2 from "./bot/opencorvus-bot-config-wizard/SKILL.md" with { type: "text" }
import f3 from "./bot/opencorvus-dingtalk-bot-config/agents/openai.yaml" with { type: "text" }
import f4 from "./bot/opencorvus-dingtalk-bot-config/SKILL.md" with { type: "text" }
import f5 from "./bot/opencorvus-feishu-bot-config/agents/openai.yaml" with { type: "text" }
import f6 from "./bot/opencorvus-feishu-bot-config/SKILL.md" with { type: "text" }
import f7 from "./bot/opencorvus-googlechat-bot-config/agents/openai.yaml" with { type: "text" }
import f8 from "./bot/opencorvus-googlechat-bot-config/SKILL.md" with { type: "text" }
import f9 from "./bot/opencorvus-line-bot-config/agents/openai.yaml" with { type: "text" }
import f10 from "./bot/opencorvus-line-bot-config/SKILL.md" with { type: "text" }
import f11 from "./bot/opencorvus-matrix-bot-config/agents/openai.yaml" with { type: "text" }
import f12 from "./bot/opencorvus-matrix-bot-config/SKILL.md" with { type: "text" }
import f13 from "./bot/opencorvus-mattermost-bot-config/agents/openai.yaml" with { type: "text" }
import f14 from "./bot/opencorvus-mattermost-bot-config/SKILL.md" with { type: "text" }
import f15 from "./bot/opencorvus-msteams-bot-config/agents/openai.yaml" with { type: "text" }
import f16 from "./bot/opencorvus-msteams-bot-config/SKILL.md" with { type: "text" }
import f17 from "./bot/opencorvus-signal-bot-config/agents/openai.yaml" with { type: "text" }
import f18 from "./bot/opencorvus-signal-bot-config/SKILL.md" with { type: "text" }
import f19 from "./bot/opencorvus-slack-bot-config/agents/openai.yaml" with { type: "text" }
import f20 from "./bot/opencorvus-slack-bot-config/SKILL.md" with { type: "text" }
import f21 from "./bot/opencorvus-telegram-bot-config/agents/openai.yaml" with { type: "text" }
import f22 from "./bot/opencorvus-telegram-bot-config/SKILL.md" with { type: "text" }
import f23 from "./bot/opencorvus-wecom-bot-config/agents/openai.yaml" with { type: "text" }
import f24 from "./bot/opencorvus-wecom-bot-config/SKILL.md" with { type: "text" }
import f25 from "./bot/opencorvus-whatsapp-bot-config/agents/openai.yaml" with { type: "text" }
import f26 from "./bot/opencorvus-whatsapp-bot-config/SKILL.md" with { type: "text" }

export const botBundles = [
  {
    id: "opencorvus-bot-config-wizard",
    skill: f2,
    files: {
      "agents/openai.yaml": f0,
      "references/channel-matrix.md": f1,
    },
  },
  {
    id: "opencorvus-dingtalk-bot-config",
    skill: f4,
    files: {
      "agents/openai.yaml": f3,
    },
  },
  {
    id: "opencorvus-feishu-bot-config",
    skill: f6,
    files: {
      "agents/openai.yaml": f5,
    },
  },
  {
    id: "opencorvus-googlechat-bot-config",
    skill: f8,
    files: {
      "agents/openai.yaml": f7,
    },
  },
  {
    id: "opencorvus-line-bot-config",
    skill: f10,
    files: {
      "agents/openai.yaml": f9,
    },
  },
  {
    id: "opencorvus-matrix-bot-config",
    skill: f12,
    files: {
      "agents/openai.yaml": f11,
    },
  },
  {
    id: "opencorvus-mattermost-bot-config",
    skill: f14,
    files: {
      "agents/openai.yaml": f13,
    },
  },
  {
    id: "opencorvus-msteams-bot-config",
    skill: f16,
    files: {
      "agents/openai.yaml": f15,
    },
  },
  {
    id: "opencorvus-signal-bot-config",
    skill: f18,
    files: {
      "agents/openai.yaml": f17,
    },
  },
  {
    id: "opencorvus-slack-bot-config",
    skill: f20,
    files: {
      "agents/openai.yaml": f19,
    },
  },
  {
    id: "opencorvus-telegram-bot-config",
    skill: f22,
    files: {
      "agents/openai.yaml": f21,
    },
  },
  {
    id: "opencorvus-wecom-bot-config",
    skill: f24,
    files: {
      "agents/openai.yaml": f23,
    },
  },
  {
    id: "opencorvus-whatsapp-bot-config",
    skill: f26,
    files: {
      "agents/openai.yaml": f25,
    },
  },
] as const
