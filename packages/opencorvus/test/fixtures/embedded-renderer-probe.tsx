import { createSignal } from "solid-js"
import { testRender, useKeyboard } from "@opentui/solid"

function Probe() {
  const [text, setText] = createSignal("OpenTUI embed probe")
  useKeyboard((event) => {
    if (event.name === "return") {
      setText((current) => `${current} submitted`)
      return
    }
    if (event.key) setText((current) => `${current}${event.key}`)
  }, {})
  return (
    <box flexDirection="column">
      <text fg="#7dd3fc">OpenCorvus renderer</text>
      <text>{text()}</text>
    </box>
  )
}

const setup = await testRender(() => <Probe />, { width: 40, height: 6, kittyKeyboard: true })
try {
  await setup.flush()
  await setup.mockInput.typeText(" tank")
  setup.mockInput.pressEnter()
  await setup.flush()
  const spans = setup.captureSpans()
  const frame = setup.captureCharFrame()
  console.log(
    JSON.stringify({
      title: spans.lines[0]?.spans[0]?.text ?? "",
      titleFg: spans.lines[0]?.spans[0]?.fg.toString() ?? "",
      titleBg: spans.lines[0]?.spans[0]?.bg.toString() ?? "",
      frame,
    }),
  )
} finally {
  setup.renderer.destroy()
}

process.exit(0)
