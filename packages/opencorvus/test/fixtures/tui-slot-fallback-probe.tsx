import { testRender } from "@opentui/solid"
import { Slot } from "../../src/cli/cmd/tui/plugin/slots"

function Probe() {
  return (
    <box flexDirection="column">
      <Slot name="home_logo" mode="replace">
        <text>slot fallback visible</text>
      </Slot>
    </box>
  )
}

const setup = await testRender(() => <Probe />, { width: 40, height: 4, kittyKeyboard: true })
try {
  await setup.flush()
  console.log(JSON.stringify({ frame: setup.captureCharFrame() }))
} finally {
  setup.renderer.destroy()
}

process.exit(0)
