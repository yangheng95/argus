import { Hono } from "hono"
import { Plugin } from "@/plugin"

function pluginRequest(input: { request: Request; serviceID: string }) {
  const url = new URL(input.request.url)
  const marker = `/${input.serviceID}`
  const index = url.pathname.indexOf(marker)
  const suffix = index >= 0 ? url.pathname.slice(index + marker.length) : "/"
  url.pathname = suffix || "/"
  return new Request(url, input.request)
}

export function PluginRoutes() {
  return new Hono().all("/:id/*", async (c) => {
    const serviceID = c.req.param("id")
    const registered = await Plugin.services()
    const service = registered.services.get(serviceID)
    if (!service) {
      const diagnostic = registered.diagnostics.find((item) => item.serviceID === serviceID)
      if (diagnostic) {
        throw new Plugin.PluginServiceRegistrationError({
          message: diagnostic.message,
          serviceID,
          specifier: diagnostic.specifier,
        })
      }
      throw new Plugin.PluginServiceNotFoundError({
        message: `Plugin service ${serviceID} is not registered`,
        serviceID,
      })
    }
    return service.app.fetch(pluginRequest({ request: c.req.raw, serviceID }), c.env)
  })
}
