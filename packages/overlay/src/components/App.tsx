import { AppDialogHost } from "./AppDialogHost"
import { CommandPalette } from "./CommandPalette"
import { ConfigDialogHost } from "./ConfigDialogHost"
import { ConnectionBanner } from "./ConnectionBanner"
import { GoalDialogHost } from "./GoalDialogHost"
import { ImagePreviewHost } from "./ImagePreview"
import { InteractionDialogHost } from "./InteractionDialogHost"
import { SessionDialogHost } from "./SessionDialogHost"
import { WorkspaceOnboardingDialog } from "./WorkspaceOnboardingDialog"

export function App() {
  return (
    <>
      <div id="connectionBannerHost">
        <ConnectionBanner />
      </div>
      <div id="commandPaletteHost">
        <CommandPalette />
      </div>
      <div id="appDialogHost">
        <AppDialogHost />
      </div>
      <div id="configDialogHost">
        <ConfigDialogHost />
      </div>
      <div id="sessionDialogHost">
        <SessionDialogHost />
      </div>
      <div id="interactionDialogHost">
        <InteractionDialogHost />
      </div>
      <div id="goalDialogHost">
        <GoalDialogHost />
      </div>
      <div id="imagePreviewHost">
        <ImagePreviewHost />
      </div>
      <div id="workspaceOnboardingHost">
        <WorkspaceOnboardingDialog />
      </div>
    </>
  )
}

export default App
