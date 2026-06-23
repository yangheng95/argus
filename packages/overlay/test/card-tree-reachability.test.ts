import { expect, test } from "bun:test"
import { cardTreeStore, setCardTreeStore, type CardNode } from "../src/store/card-tree"
import { resetWriter } from "../src/services/tree-writer"
import {
  orderedReachableCardIDs,
  parentIDChainForCard,
  reachableCardIDsFromTree,
  topLevelCardIDForCard,
} from "../src/utils/card-tree"

const OVERLAY_ROOT = import.meta.dir.replace(/\\test$/, "")

function node(id: string, childIDs: string[] = []): CardNode {
  return {
    id,
    kind: "agent",
    stage: "requirements",
    status: "running",
    title: id,
    parts: [],
    childIDs,
    time: Date.now(),
  }
}

test("reachableCardIDsFromTree follows top-level order and nested childIDs", () => {
  expect(
    reachableCardIDsFromTree(["parent"], {
      parent: { childIDs: ["child"] },
      child: { childIDs: ["grandchild"] },
      grandchild: { childIDs: [] },
      unreachable: { childIDs: [] },
    }),
  ).toEqual(["parent", "child", "grandchild"])
})

test("orderedReachableCardIDs follows inserted live cards via order instead of Object.keys", () => {
  resetWriter()
  try {
    expect(orderedReachableCardIDs()).toEqual([])

    setCardTreeStore("cards", "requirements:session:one", node("requirements:session:one"))
    expect(orderedReachableCardIDs()).toEqual([])

    setCardTreeStore("order", ["requirements:session:one"])
    expect(orderedReachableCardIDs()).toEqual(["requirements:session:one"])

    setCardTreeStore("cards", "requirements:session:child", node("requirements:session:child"))
    setCardTreeStore("cards", "requirements:session:one", "childIDs", ["requirements:session:child"])
    expect(orderedReachableCardIDs()).toEqual(["requirements:session:one", "requirements:session:child"])
  } finally {
    resetWriter()
  }
})

test("parentID helpers resolve ancestors without scanning child arrays", () => {
  const cards = {
    root: { parentID: undefined },
    parent: { parentID: "root" },
    child: { parentID: "parent" },
    unrelated: {
      get parentID() {
        throw new Error("parent helper enumerated unrelated card")
      },
    },
  }

  expect(parentIDChainForCard("child", cards)).toEqual(["root", "parent"])
  expect(topLevelCardIDForCard("child", ["root"], cards)).toBe("root")
  expect(topLevelCardIDForCard("parent", ["root"], cards)).toBe("root")
  expect(topLevelCardIDForCard("root", ["root"], cards)).toBe("root")
})

test("Board stage-message discovery does not enumerate cardTreeStore.cards keys", async () => {
  const source = await Bun.file(`${OVERLAY_ROOT}/src/components/Board.tsx`).text()
  expect(source).toContain("orderedReachableCardIDs()")
  expect(source).not.toContain("Object.keys(cardTreeStore.cards)")
})

test("tree-writer appends live message parts by replacing the parts array", async () => {
  const source = await Bun.file(`${OVERLAY_ROOT}/src/services/tree-writer.ts`).text()
  expect(source).toContain("function appendSessionPart")
  expect(source).toContain("const next = [...current, part]")
  expect(source).not.toContain("produce((parts: any[]) => {\n      parts.push")
})

test("store-backed conversation renderers use explicit card dereference primitive", async () => {
  const conversation = await Bun.file(`${OVERLAY_ROOT}/src/components/Conversation.tsx`).text()
  const card = await Bun.file(`${OVERLAY_ROOT}/src/components/Card.tsx`).text()
  const chatBubble = await Bun.file(`${OVERLAY_ROOT}/src/components/ChatBubble.tsx`).text()
  const primitive = await Bun.file(`${OVERLAY_ROOT}/src/components/StoreCardNode.tsx`).text()
  const rail = await Bun.file(`${OVERLAY_ROOT}/src/components/ConversationAgentRail.tsx`).text()

  expect(primitive).toContain("export function storeCardNode")
  expect(primitive).toContain("cardTreeStore.cards[id]")
  expect(conversation).toContain("<StoreCardNode id={props.id}>")
  expect(conversation).toContain("topLevelCardIDForCard(cardID, order())")
  expect(conversation).not.toContain("Object.values(cardTreeStore.cards).find")
  expect(rail).toContain("parentIDChainForCard(cardID)")
  expect(rail).not.toContain("Object.values(cardTreeStore.cards).find")
  expect(conversation).toContain(
    "<ErrorBoundary fallback={(error) => <ConversationCardRenderFailure id={props.id} error={error} />}>",
  )
  expect(card).toContain("<StoreCardNode id={id} ownerID={props.node.id}>")
  expect(chatBubble).toContain("storeCardNode(props.childID, props.parentID)")
  expect(conversation).not.toContain("cardTreeStore.cards[id]!")
  expect(card).not.toContain("cardTreeStore.cards[id]!")
})
