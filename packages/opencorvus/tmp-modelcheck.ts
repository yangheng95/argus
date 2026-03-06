import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
const dir = process.argv[2]
await Instance.provide({ directory: dir, fn: async () => {
  const def = await Provider.defaultModel()
  console.log(JSON.stringify(def, null, 2))
}})
