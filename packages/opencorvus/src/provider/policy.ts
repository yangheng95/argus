const dashscope = {
  coding: "https://coding.dashscope.aliyuncs.com/v1",
  mainland: "https://dashscope.aliyuncs.com/compatible-mode/v1",
}

function dashscopeURL(key: string) {
  if (key.startsWith("sk-sp-")) return dashscope.coding
  if (key.startsWith("sk-")) return dashscope.mainland
  return undefined
}

export function applyProviderPolicy(providerID: string, options: Record<string, any>) {
  if (providerID !== "alibaba-cn") return
  if (typeof options["apiKey"] !== "string") return

  const key = options["apiKey"].trim()
  if (!key) return

  const url = dashscopeURL(key)
  if (url) options["baseURL"] = url
}
