type Audience = {
  model?: boolean
  ui?: boolean
  acp?: boolean
}

type Text = {
  type?: string
  synthetic?: boolean
  ignored?: boolean
  audience?: Audience
}

function flags(part: Text) {
  if (part.synthetic) {
    return {
      model: true,
      ui: false,
      acp: true,
    }
  }

  if (part.ignored) {
    return {
      model: false,
      ui: true,
      acp: true,
    }
  }

  return {
    model: part.audience?.model ?? true,
    ui: part.audience?.ui ?? true,
    acp: part.audience?.acp ?? true,
  }
}

export function textForModel(part: Text) {
  return flags(part).model
}

export function textForUI(part: Text) {
  return flags(part).ui
}

export function textForACP(part: Text) {
  return flags(part).acp
}

export function textForBoth(part: Text) {
  const val = flags(part)
  return val.model && val.ui
}

export function textAudience(part: Text): "assistant" | "user" | undefined {
  const val = flags(part)
  if (val.model && !val.ui) return "assistant"
  if (!val.model && val.ui) return "user"
  return undefined
}

export function messageControlOnly(parts: Text[]) {
  return parts.every((part) => part.type === "text" && textAudience(part) === "assistant")
}
