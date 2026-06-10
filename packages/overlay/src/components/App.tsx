import { createSignal, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { AppDialogHost } from "./AppDialogHost"
import { CommandPalette } from "./CommandPalette"
import { ConnectionBadge } from "./ConnectionBadge"
import { ConfigDialogHost } from "./ConfigDialogHost"
import { ConnectionBanner } from "./ConnectionBanner"
import { GoalDialogHost } from "./GoalDialogHost"
import { ImagePreviewHost } from "./ImagePreview"
import { InteractionDialogHost } from "./InteractionDialogHost"
import { SessionDialogHost } from "./SessionDialogHost"
import { ProjectDirectoryBar } from "./TaskDirBar"
import { TaskStatusHeader } from "./TaskStatusHeader"
import { TitlebarMenubar } from "./titlebar/TitlebarMenubar"
import { WindowControls } from "./WindowControls"
import { WorkspaceOnboardingDialog } from "./WorkspaceOnboardingDialog"

function StaticMountPortal(props: { id: string; children: JSX.Element }) {
  const [mount, setMount] = createSignal<HTMLElement | null>(null)

  onMount(() => {
    setMount(document.getElementById(props.id))
  })

  return (
    <Show when={mount()} keyed>
      {(el) => <Portal mount={el}>{props.children}</Portal>}
    </Show>
  )
}

export function App() {
  return (
    <>
      <StaticMountPortal id="solidTitlebarMenu">
        <TitlebarMenubar />
      </StaticMountPortal>
      <StaticMountPortal id="solidWindowControls">
        <WindowControls />
      </StaticMountPortal>
      <StaticMountPortal id="solidConnBadge">
        <ConnectionBadge />
      </StaticMountPortal>
      <StaticMountPortal id="solidProjectDirectoryBarMount">
        <ProjectDirectoryBar />
      </StaticMountPortal>
      <StaticMountPortal id="solidTaskStatusMount">
        <TaskStatusHeader />
      </StaticMountPortal>
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
