import * as Tooltip from "@kobalte/core/tooltip"

import { OPENCORVUS_VERSION_LABEL } from "../utils/version"

const AUTHOR_EMAIL = "yangheng@myhexin.com"

export function SidebarVersionLabel() {
  return (
    <Tooltip.Root openDelay={0} closeDelay={0} placement="top-start" gutter={6}>
      <Tooltip.Trigger as="span" id="chatVersion" class="chat-version-copy" tabIndex={0} aria-label={AUTHOR_EMAIL}>
        {OPENCORVUS_VERSION_LABEL}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="card-meta-tooltip">{AUTHOR_EMAIL}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
