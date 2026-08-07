import { apiJson } from "./api"

export type ComputerIdentity = {
  sessionID: string
  computerID: string
  displayID: string
}

export type ComputerOwnership = {
  ownership: "human" | "agent"
  computerId: string
  displayId: string
  runtimeBundleId: string
  guestPreserved?: true
  freshObservationRequired?: true
}

function request(path: string, identity: ComputerIdentity) {
  return apiJson<ComputerOwnership>(`computer/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identity),
  })
}

export function getComputerOwnership(identity: ComputerIdentity) {
  return request("status", identity)
}

export function takeOverComputer(identity: ComputerIdentity) {
  return request("takeover", identity)
}

export function returnComputerControl(identity: ComputerIdentity) {
  return request("return", identity)
}

export function openComputerViewer(identity: ComputerIdentity) {
  return apiJson<{
    opened: true
    pid: number
    computerId: string
    displayId: string
    runtimeBundleId: string
  }>("computer/viewer/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identity),
  })
}
